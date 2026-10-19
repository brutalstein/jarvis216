import json
import sys
import types
import unittest
from pathlib import Path
from typing import Any
from uuid import uuid4

from worker import Request, WorkerError, authorize, encode, stream

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


if __name__ == "__main__":
    unittest.main()
