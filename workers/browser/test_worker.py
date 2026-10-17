import unittest
from uuid import uuid4

from worker import Request, WorkerError, authorize


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


if __name__ == "__main__":
    unittest.main()
