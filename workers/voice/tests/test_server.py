import asyncio
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import numpy as np
from aiohttp.test_utils import TestClient, TestServer
from pipecat.frames.frames import TTSSpeakFrame

from jarvis_voice.brain import Brain
from jarvis_voice.enrollment import Enrollment
from jarvis_voice.server import create_app


class FakeConnection:
    def __init__(self, **kwargs: Any) -> None:
        self.pc_id = "connection"
        self.handlers: dict[str, Any] = {}

    async def initialize(self, sdp: str, kind: str) -> None:
        pass

    def event_handler(self, name: str) -> Callable[[Any], Any]:
        def register(handler: Any) -> Any:
            self.handlers[name] = handler
            return handler

        return register

    def get_answer(self) -> dict[str, str]:
        return {"pc_id": self.pc_id, "sdp": "answer", "type": "answer"}

    def send_app_message(self, message: dict) -> None:
        pass

    async def disconnect(self) -> None:
        await self.handlers["closed"](self)


class ServerTest(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_ice_candidates_never_reach_peer(self) -> None:
        async def session(*args: Any) -> None:
            await asyncio.Event().wait()

        add = AsyncMock()
        with (
            patch("jarvis_voice.server.run_session", session),
            patch(
                "pipecat.transports.smallwebrtc.connection.SmallWebRTCConnection", FakeConnection
            ),
            patch.object(FakeConnection, "add_ice_candidate", add, create=True),
        ):
            headers = {"authorization": "Bearer secret"}
            await self.client.post(
                "/offer", json={"sdp": "offer", "type": "offer"}, headers=headers
            )
            for candidates in [
                None,
                {},
                [None],
                [7],
                [{"candidate": 1}],
                [{"candidate": "bad"}],
                [{"candidate": "1 1 udp 1 127.0.0.1 9 typ host", "sdp_mid": []}],
                [{"candidate": "1 1 udp 1 127.0.0.1 9 typ host", "sdp_mline_index": True}],
                [{"candidate": ""}] * 33,
            ]:
                with self.subTest(candidates=candidates):
                    response = await self.client.patch(
                        "/offer",
                        json={"pc_id": "connection", "candidates": candidates},
                        headers=headers,
                    )
                    self.assertEqual(response.status, 400)
            add.assert_not_awaited()
            response = await self.client.patch(
                "/offer",
                json={"pc_id": "connection", "candidates": [{"candidate": ""}]},
                headers=headers,
            )
            self.assertEqual(response.status, 200)
            add.assert_awaited_once_with(None)

    async def test_failed_pipeline_releases_peer_for_retry(self) -> None:
        async def fail(*args: Any) -> None:
            raise RuntimeError("test pipeline failure")

        with (
            patch("jarvis_voice.server.run_session", fail),
            patch(
                "pipecat.transports.smallwebrtc.connection.SmallWebRTCConnection", FakeConnection
            ),
        ):
            headers = {"authorization": "Bearer secret"}
            for _ in range(2):
                response = await self.client.post(
                    "/offer", json={"sdp": "offer", "type": "offer"}, headers=headers
                )
                self.assertEqual(response.status, 200)
                await asyncio.sleep(0.03)

    async def test_concurrent_offers_do_not_create_two_sessions(self) -> None:
        class SlowConnection(FakeConnection):
            async def initialize(self, sdp: str, kind: str) -> None:
                await asyncio.sleep(0.03)

        async def session(*args: Any) -> None:
            await asyncio.Event().wait()

        with (
            patch("jarvis_voice.server.run_session", session),
            patch(
                "pipecat.transports.smallwebrtc.connection.SmallWebRTCConnection", SlowConnection
            ),
        ):
            responses = await asyncio.gather(
                *[
                    self.client.post(
                        "/offer",
                        json={"sdp": "offer", "type": "offer"},
                        headers={"authorization": "Bearer secret"},
                    )
                    for _ in range(2)
                ]
            )
            self.assertEqual(sorted(response.status for response in responses), [200, 409])

    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.enrollment = Enrollment(Path(self.temp.name), 0.7)
        self.client = TestClient(TestServer(create_app("secret", self.enrollment)))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        self.temp.cleanup()

    async def test_all_endpoints_require_the_launch_token(self) -> None:
        for method, path in [
            ("GET", "/health"),
            ("POST", "/offer"),
            ("POST", "/announce"),
            ("POST", "/enroll/start"),
            ("POST", "/enroll/finish"),
            ("POST", "/enroll/cancel"),
            ("DELETE", "/enroll"),
        ]:
            response = await self.client.request(method, path)
            self.assertEqual(response.status, 401, path)

    async def test_authenticated_malformed_offer_is_rejected(self) -> None:
        response = await self.client.post(
            "/offer", json={"sdp": 5}, headers={"authorization": "Bearer secret"}
        )
        self.assertEqual(response.status, 400)

    async def test_announcement_without_a_session_returns_conflict(self) -> None:
        response = await self.client.post(
            "/announce",
            json={"text": "Spotify açıldı.", "lang": "tr"},
            headers={"authorization": "Bearer secret"},
        )
        self.assertEqual(response.status, 409)
        self.assertEqual(await response.json(), {"error": "NO_SESSION"})

    async def test_announcement_rejects_invalid_payloads(self) -> None:
        for data in [
            [],
            {},
            {"text": "", "lang": "tr"},
            {"text": " ", "lang": "tr"},
            {"text": "x" * 601, "lang": "tr"},
            {"text": 1, "lang": "tr"},
            {"text": "Done.", "lang": "de"},
            {"text": "Done.", "lang": []},
            {"text": "Done.", "lang": "tr", "kind": "chatter"},
            {"text": "Done.", "lang": "tr", "planId": 7},
            {"text": "Done.", "lang": "tr", "planId": "x" * 65},
        ]:
            with self.subTest(data=data):
                response = await self.client.post(
                    "/announce", json=data, headers={"authorization": "Bearer secret"}
                )
                self.assertEqual(response.status, 400)
                self.assertEqual(await response.json(), {"error": "INVALID_ANNOUNCEMENT"})
        response = await self.client.post(
            "/announce", data="{", headers={"authorization": "Bearer secret"}
        )
        self.assertEqual(response.status, 400)

    async def test_announcement_uses_active_brain_and_clears_after_session_end(self) -> None:
        for ending in ["finished", "failed", "disconnected", "transport_disconnected"]:
            with self.subTest(ending=ending):
                await self.exercise_announcement_session(ending)

    async def exercise_announcement_session(self, ending: str) -> None:
        ready = asyncio.Event()
        stop = asyncio.Event()
        disconnected = asyncio.Event()
        release = asyncio.Event()
        messages: list[dict] = []
        frames: list[Any] = []

        async def send(message: dict) -> None:
            messages.append(message)

        # No Core calls or audio/model startup are needed for announcements.
        brain = Brain(AsyncMock(), send, lambda: True)

        async def session(connection: Any, enrollment: Enrollment, set_brain: Callable) -> None:
            set_brain(brain)
            ready.set()
            await stop.wait()
            if ending == "failed":
                raise RuntimeError("private failure details")
            if ending == "disconnected":
                await connection.disconnect()
                # A late startup callback must not revive a closed session.
                set_brain(brain)
            if ending == "transport_disconnected":
                set_brain(None)
                set_brain(brain)
                disconnected.set()
                await release.wait()

        client = TestClient(TestServer(create_app("secret", self.enrollment)))
        with (
            patch("jarvis_voice.server.run_session", session),
            patch(
                "pipecat.transports.smallwebrtc.connection.SmallWebRTCConnection",
                FakeConnection,
            ),
            patch.object(brain, "push_frame", side_effect=frames.append),
        ):
            await client.start_server()
            try:
                headers = {"authorization": "Bearer secret"}
                response = await client.post(
                    "/offer", json={"sdp": "offer", "type": "offer"}, headers=headers
                )
                self.assertEqual(response.status, 200)
                await asyncio.wait_for(ready.wait(), timeout=1)
                response = await client.post(
                    "/announce", json={"text": "x" * 600, "lang": "en"}, headers=headers
                )
                self.assertEqual(response.status, 204)
                self.assertIn({"type": "caption", "role": "jarvis", "text": "x" * 600}, messages)
                self.assertIsInstance(frames[0], TTSSpeakFrame)
                self.assertEqual(frames[0].metadata["lang"], "en")
                with patch.object(brain, "announce", side_effect=RuntimeError("private details")):
                    response = await client.post(
                        "/announce", json={"text": "Done.", "lang": "en"}, headers=headers
                    )
                    self.assertEqual(response.status, 503)
                    self.assertEqual(await response.json(), {"error": "ANNOUNCEMENT_FAILED"})
                stop.set()
                if ending == "transport_disconnected":
                    await asyncio.wait_for(disconnected.wait(), timeout=1)
                response = await client.post(
                    "/announce", json={"text": "Done.", "lang": "en"}, headers=headers
                )
                self.assertEqual(response.status, 409)
                self.assertEqual(await response.json(), {"error": "NO_SESSION"})
            finally:
                stop.set()
                release.set()
                await client.close()

    async def test_enrollment_requires_speech_and_can_be_deleted(self) -> None:
        headers = {"authorization": "Bearer secret"}
        await self.client.post("/enroll/start", headers=headers)
        response = await self.client.post("/enroll/finish", headers=headers)
        self.assertEqual(response.status, 409)
        self.enrollment.embeddings = [np.array([1.0, 0.0])] * 3
        self.enrollment.seconds = 30
        response = await self.client.post("/enroll/finish", headers=headers)
        self.assertEqual(await response.json(), {"enrolled": True})
        response = await self.client.get("/health", headers=headers)
        self.assertTrue((await response.json())["enrolled"])
        await self.client.delete("/enroll", headers=headers)
        self.assertFalse(self.enrollment.gate.enrolled())

    async def test_cancelled_enrollment_keeps_the_existing_print(self) -> None:
        # An abandoned enrollment must not leave the service collecting instead of transcribing.
        headers = {"authorization": "Bearer secret"}
        self.enrollment.gate.enroll([np.array([1.0, 0.0])])
        await self.client.post("/enroll/start", headers=headers)
        self.enrollment.embeddings = [np.array([0.0, 1.0])]
        self.enrollment.seconds = 12
        response = await self.client.post("/enroll/cancel", headers=headers)
        self.assertEqual(await response.json(), {"enrolled": True})
        self.assertFalse(self.enrollment.active)
        self.assertEqual(self.enrollment.embeddings, [])
        self.assertEqual(self.enrollment.seconds, 0)
        self.assertTrue(self.enrollment.gate.enrolled())


if __name__ == "__main__":
    unittest.main()
