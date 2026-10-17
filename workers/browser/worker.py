"""Authenticated, bounded Browser Use Actor worker. No LLM or arbitrary browser tools."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID


class WorkerError(Exception):
    pass


def authorize(header: str | None, token: str) -> bool:
    return len(token) >= 32 and hmac.compare_digest(
        (header or "").encode(), f"Bearer {token}".encode()
    )


@dataclass(frozen=True)
class Request:
    task_id: str
    url: str
    expected_text: str
    timeout_ms: int

    @classmethod
    def parse(cls, payload: object, allowed: frozenset[str]) -> Request:
        if not isinstance(payload, dict) or set(payload) != {
            "taskId",
            "url",
            "expectedText",
            "timeoutMs",
        }:
            raise WorkerError("INVALID_REQUEST")
        task_id, url, text, timeout = (
            payload[k] for k in ("taskId", "url", "expectedText", "timeoutMs")
        )
        if not all(isinstance(value, str) for value in (task_id, url, text)):
            raise WorkerError("INVALID_REQUEST")
        try:
            UUID(task_id)
            parsed = urlsplit(url)
        except ValueError as error:
            raise WorkerError("INVALID_REQUEST") from error
        if (
            url not in allowed
            or parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise WorkerError("URL_NOT_ALLOWED")
        if not text or len(text) > 4096 or type(timeout) is not int or not 100 <= timeout <= 60000:
            raise WorkerError("INVALID_BUDGET")
        return cls(task_id, url, text, timeout)


async def extract(request: Request) -> dict[str, str]:
    # Lazy import keeps auth/schema checks independent of a browser installation.
    from browser_use import Browser

    browser = Browser(
        headless=True,
        allowed_domains=[urlsplit(request.url).hostname or ""],
        user_data_dir=None,
        permissions=[],
        accept_downloads=False,
        auto_download_pdfs=False,
        enable_default_extensions=False,
        chromium_sandbox=True,
    )
    try:
        async with asyncio.timeout(request.timeout_ms / 1000):
            await browser.start()
            # Actor Page.goto returns before document readiness. The supported session
            # navigation path waits for lifecycle events and enforces domain policy.
            await browser.navigate_to(request.url)
            page = await browser.get_current_page()
            if page is None:
                raise WorkerError("NO_BROWSER_PAGE")
            # This is application-owned fixed code. Never execute scripts from a task/model.
            raw = await page.evaluate(
                "() => JSON.stringify({url:location.href,"
                "text:(document.body?.innerText || '').slice(0,30000)})"
            )
            data: dict[str, Any] = json.loads(raw)
            if data.get("url") != request.url or request.expected_text not in data.get("text", ""):
                raise WorkerError("READBACK_VERIFICATION_FAILED")
            return {
                "text": str(data["text"]),
                "source": "browser-use:dom-readback",
                "externalId": request.task_id,
            }
    finally:
        await asyncio.wait_for(browser.kill(), timeout=10)


def encode(payload: dict[str, str]) -> bytes:
    # Raw UTF-8: ASCII escaping would inflate non-ASCII pages up to 6x past Core's 128 KB cap.
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def main() -> None:
    token = os.environ.get("BROWSER_WORKER_TOKEN", "")
    if len(token) < 32 or os.environ.get("BROWSER_EGRESS_VERIFIED") != "true":
        raise SystemExit("Strong worker token and verified network egress isolation required")
    raw_allowlist = json.loads(os.environ.get("BROWSER_ALLOWED_URLS", "[]"))
    if (
        not isinstance(raw_allowlist, list)
        or not raw_allowlist
        or not all(isinstance(url, str) for url in raw_allowlist)
    ):
        raise SystemExit(
            "BROWSER_ALLOWED_URLS must be a nonempty JSON array of exact public HTTPS URLs"
        )
    allowed = frozenset(raw_allowlist)
    # Immediate backpressure. No unbounded browser queue or shared profile.
    slot = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            pass  # URLs, headers and browser exceptions never enter ordinary logs.

        def respond(self, status: int, payload: dict[str, str]) -> None:
            body = encode(payload)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_GET(self) -> None:
            self.respond(200 if self.path == "/healthz" else 404, {"status": "alive"})

        def do_POST(self) -> None:
            self.connection.settimeout(10)
            if not authorize(self.headers.get("Authorization"), token):
                self.respond(401, {"error": "UNAUTHORIZED"})
                return
            if self.path != "/v1/extract":
                self.respond(404, {"error": "NOT_FOUND"})
                return
            if not slot.acquire(blocking=False):
                self.respond(429, {"error": "BROWSER_BUSY"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= 16384 or self.headers.get("Transfer-Encoding"):
                    raise WorkerError("INVALID_BODY")
                request = Request.parse(json.loads(self.rfile.read(size)), allowed)
                result = asyncio.run(extract(request))
                self.respond(200, result)
            except (WorkerError, ValueError):
                self.respond(400, {"error": "REQUEST_OR_VERIFICATION_FAILED"})
            except Exception:
                # Core treats transport/browser failures as uncertain. No retries here.
                self.respond(503, {"error": "BROWSER_EXECUTION_FAILED"})
            finally:
                slot.release()

    host = "0.0.0.0" if os.environ.get("JARVIS_CONTAINER") == "true" else "127.0.0.1"
    server = ThreadingHTTPServer((host, 8765), Handler)
    server.request_queue_size = 4
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
