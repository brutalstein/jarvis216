import json
import unittest
from pathlib import Path
from uuid import uuid4

from worker import Request, WorkerError, authorize

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


if __name__ == "__main__":
    unittest.main()
