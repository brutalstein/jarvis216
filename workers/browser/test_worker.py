import http.client
import json
import sys
import threading
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from uuid import uuid4

from worker import Request, WorkerError, authorize, build_server, encode, stream

# Shared with tests/browser-contract.test.ts: both sides must accept the same wire shapes.
CONTRACT = json.loads(
    (Path(__file__).parents[2] / "tests" / "fixtures" / "browser-extract.json").read_text()
)


class BoundaryTests(unittest.TestCase):
    def payload(self) -> dict[str, object]:
        return {
            "taskId": str(uuid4()),
            "url": "https://example.com/",
            "expectedText": "Example",
            "timeoutMs": 1000,
        }

    def test_rejects_unregistered_url_including_query_mutation(self) -> None:
        payload = self.payload()
        payload["url"] = "https://example.com/?delete=all"
        with self.assertRaises(WorkerError):
            Request.parse(payload, frozenset({"https://example.com/"}))

    def test_rejects_untrusted_browser_options_and_oversized_timeout(self) -> None:
        for changes in (
            {"cdp_url": "http://localhost:9222"},
            {"timeoutMs": 60001},
            {"timeoutMs": True},
        ):
            with self.subTest(changes=changes), self.assertRaises(WorkerError):
                Request.parse({**self.payload(), **changes}, frozenset({"https://example.com/"}))

    def test_exact_public_url_is_accepted(self) -> None:
        request = Request.parse(self.payload(), frozenset({"https://example.com/"}))
        self.assertEqual(request.url, "https://example.com/")

    def test_multi_page_payload_is_accepted(self) -> None:
        payload = {
            "taskId": str(uuid4()),
            "pages": [
                {"url": "https://example.com/", "expectedText": "Example"},
                {"url": "https://example.com/", "expectedText": "Domain"},
            ],
            "timeoutMs": 5000,
        }
        request = Request.parse(payload, frozenset({"https://example.com/"}))
        self.assertEqual(len(request.pages), 2)

    def test_multi_page_rejects_unlisted_url(self) -> None:
        payload = {
            "taskId": str(uuid4()),
            "pages": [{"url": "https://example.com/other", "expectedText": "x"}],
            "timeoutMs": 1000,
        }
        with self.assertRaises(WorkerError):
            Request.parse(payload, frozenset({"https://example.com/"}))

    def test_missing_or_incorrect_credentials_fail_closed(self) -> None:
        for token in (None, "Bearer bad", "Bearer " + "x" * 32):
            self.assertFalse(authorize(token, "a" * 32))
        self.assertTrue(authorize("Bearer " + "a" * 32, "a" * 32))

    def test_accepts_the_exact_request_core_sends(self) -> None:
        payload = CONTRACT["request"]
        request = Request.parse(payload, frozenset({payload["url"]}))
        self.assertEqual(request.task_id, payload["taskId"])
        self.assertEqual(request.timeout_ms, payload["timeoutMs"])

    def test_response_keys_match_core_result_contract(self) -> None:
        # extract() returns exactly these keys; Core's strict ResultSchema rejects extras.
        self.assertEqual(set(CONTRACT["response"]), {"text", "source", "externalId"})

    def test_non_ascii_pages_stay_within_core_response_cap(self) -> None:
        body = encode({"text": "ğ" * 30000, "source": "s", "externalId": "e"})
        self.assertIn("ğ".encode(), body)
        self.assertLess(len(body), 128_000)


class FakePage:
    def __init__(self, url: str, text: str) -> None:
        self.url, self.text = url, text

    async def evaluate(self, script: str) -> str:
        return json.dumps({"url": self.url, "text": self.text})


class FakeBrowser:
    pages: dict[str, str] = {}

    def __init__(self, **options: Any) -> None:
        self.current: FakePage | None = None

    async def start(self) -> None:
        pass

    async def navigate_to(self, url: str) -> None:
        self.current = FakePage(url, self.pages[url])

    async def get_current_page(self) -> FakePage | None:
        return self.current

    async def kill(self) -> None:
        pass


class StreamTests(unittest.TestCase):
    def setUp(self) -> None:
        module = types.ModuleType("browser_use")
        module.Browser = FakeBrowser  # type: ignore[attr-defined]
        sys.modules["browser_use"] = module
        self.addCleanup(sys.modules.pop, "browser_use", None)
        FakeBrowser.pages = {
            "https://example.com/": "Example Domain",
            "https://news.example.org/": "Headlines today",
        }

    def request(self, second_text: str) -> Request:
        payload = {
            "taskId": str(uuid4()),
            "pages": [
                {"url": "https://example.com/", "expectedText": "Example"},
                {"url": "https://news.example.org/", "expectedText": second_text},
            ],
            "timeoutMs": 5000,
        }
        return Request.parse(payload, frozenset(FakeBrowser.pages))

    def lines(self, request: Request) -> list[dict[str, Any]]:
        chunks: list[bytes] = []
        stream(request, chunks.append)
        return [json.loads(chunk) for chunk in b"".join(chunks).splitlines()]

    def test_streams_where_it_looks_then_the_result(self) -> None:
        lines = self.lines(self.request("Headlines"))
        self.assertEqual(
            [line.get("progress") for line in lines[:-1]],
            [
                {"index": 1, "total": 2, "host": "example.com", "state": "reading"},
                {"index": 1, "total": 2, "host": "example.com", "state": "read"},
                {"index": 2, "total": 2, "host": "news.example.org", "state": "reading"},
                {"index": 2, "total": 2, "host": "news.example.org", "state": "read"},
            ],
        )
        self.assertEqual(set(lines[-1]["result"]), {"text", "source", "externalId"})
        self.assertIn("Headlines today", lines[-1]["result"]["text"])

    def test_a_failed_readback_ends_with_an_in_band_error(self) -> None:
        lines = self.lines(self.request("Missing phrase"))
        self.assertEqual(lines[-1], {"error": "REQUEST_OR_VERIFICATION_FAILED", "status": 400})
        self.assertNotIn("result", lines[-1])


class ServerTests(unittest.TestCase):
    """The real HTTP server on a free port, as Core reaches it."""

    token = "t" * 40

    def setUp(self) -> None:
        module = types.ModuleType("browser_use")
        module.Browser = FakeBrowser  # type: ignore[attr-defined]
        sys.modules["browser_use"] = module
        self.addCleanup(sys.modules.pop, "browser_use", None)
        FakeBrowser.pages = {"https://example.com/": "Example Domain"}
        self.server = build_server(self.token, frozenset(FakeBrowser.pages), "127.0.0.1", 0)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def post(
        self, body: object, headers: dict[str, str] | None = None, path: str = "/v1/extract"
    ) -> tuple[int, str, str]:
        data = json.dumps(body).encode()
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.headers["Content-Type"], response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.headers["Content-Type"], error.read().decode()

    def payload(self, text: str = "Example") -> dict[str, object]:
        return {
            "taskId": str(uuid4()),
            "url": "https://example.com/",
            "expectedText": text,
            "timeoutMs": 5000,
        }

    def test_health_is_open_and_extract_needs_the_token(self) -> None:
        with urllib.request.urlopen(self.base + "/healthz", timeout=5) as response:
            self.assertEqual(response.status, 200)
        status, _, body = self.post(self.payload(), {"Authorization": "Bearer wrong"})
        self.assertEqual((status, json.loads(body)), (401, {"error": "UNAUTHORIZED"}))
        self.assertEqual(self.post(self.payload(), path="/v1/other")[0], 404)

    def test_reads_the_page_as_json_or_streams_it_as_ndjson(self) -> None:
        status, kind, body = self.post(self.payload())
        self.assertEqual(status, 200)
        self.assertIn("application/json", kind)
        self.assertIn("Example Domain", json.loads(body)["text"])
        status, kind, body = self.post(self.payload(), {"Accept": "application/x-ndjson"})
        lines = [json.loads(line) for line in body.splitlines()]
        self.assertEqual((status, "application/x-ndjson" in kind), (200, True))
        self.assertEqual(
            [line.get("progress", {}).get("state") for line in lines[:-1]], ["reading", "read"]
        )
        self.assertIn("result", lines[-1])

    def test_refuses_invalid_requests_and_failed_readback(self) -> None:
        bad = self.payload()
        bad["url"] = "https://example.com/?x=1"
        self.assertEqual(self.post(bad)[0], 400)
        self.assertEqual(self.post(self.payload("not on the page"))[0], 400)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.putrequest("POST", "/v1/extract")
            connection.putheader("Authorization", f"Bearer {self.token}")
            connection.putheader("Content-Length", "1")
            connection.putheader("Transfer-Encoding", "chunked")
            # The server rejects these headers before reading a body; sending chunks races closure.
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(
                json.loads(response.read()), {"error": "REQUEST_OR_VERIFICATION_FAILED"}
            )
        finally:
            connection.close()

    def test_one_browser_at_a_time(self) -> None:
        entered, release = threading.Event(), threading.Event()
        navigate = FakeBrowser.navigate_to

        async def slow(browser: FakeBrowser, url: str) -> None:
            entered.set()
            await __import__("asyncio").to_thread(release.wait, 10)
            await navigate(browser, url)

        FakeBrowser.navigate_to = slow  # type: ignore[method-assign]
        self.addCleanup(setattr, FakeBrowser, "navigate_to", navigate)
        first: list[int] = []
        thread = threading.Thread(target=lambda: first.append(self.post(self.payload())[0]))
        thread.start()
        self.assertTrue(entered.wait(10))
        status, _, body = self.post(self.payload())
        self.assertEqual((status, json.loads(body)), (429, {"error": "BROWSER_BUSY"}))
        release.set()
        thread.join(10)
        self.assertEqual(first, [200])


if __name__ == "__main__":
    unittest.main()
