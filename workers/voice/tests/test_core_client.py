import json
import unittest

import httpx

from jarvis_voice.core_client import CoreClient, Turn

REPLY = {
    "id": "t1",
    "taskId": "k1",
    "addressed": True,
    "say": "Buradayım, efendim.",
    "lang": "tr",
    "display": [{"type": "text", "body": "x"}],
    "provider": "gemini-live",
    "latencyMs": 1200,
}


class CoreClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_posts_the_utterance_with_the_operator_token(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json=REPLY)

        client = CoreClient("http://127.0.0.1:2161", "secret", httpx.MockTransport(handler))
        turn = await client.turn("Jarvis, orada mısın?", follow_up=True)
        self.assertEqual(turn, Turn(**REPLY))
        request = seen[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/v1/conversation/turns")
        self.assertEqual(request.headers["authorization"], "Bearer secret")
        self.assertEqual(
            json.loads(request.content), {"utterance": "Jarvis, orada mısın?", "followUp": True}
        )
        await client.turn("Jarvis spotifiyi aç", follow_up=False, uncertain=True)
        self.assertEqual(
            json.loads(seen[1].content),
            {"utterance": "Jarvis spotifiyi aç", "followUp": False, "uncertain": True},
        )

    async def test_timeout_reply_is_none(self) -> None:
        client = CoreClient(
            "http://127.0.0.1:2161",
            "secret",
            httpx.MockTransport(lambda _: httpx.Response(504, json={"error": "TURN_TIMEOUT"})),
        )
        self.assertIsNone(await client.turn("Jarvis?", follow_up=False))

    async def test_connection_error_is_none(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        client = CoreClient("http://127.0.0.1:2161", "secret", httpx.MockTransport(refuse))
        self.assertIsNone(await client.turn("Jarvis?", follow_up=False))

    async def test_malformed_reply_is_none(self) -> None:
        for response in (
            httpx.Response(200, text="not json"),
            httpx.Response(200, json={"say": "eksik alanlar"}),
            httpx.Response(200, json=["liste"]),
        ):
            client = CoreClient(
                "http://127.0.0.1:2161",
                "secret",
                httpx.MockTransport(lambda _, reply=response: reply),
            )
            self.assertIsNone(await client.turn("Jarvis?", follow_up=False))


if __name__ == "__main__":
    unittest.main()
