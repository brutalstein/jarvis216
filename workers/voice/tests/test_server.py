import tempfile
import unittest
from pathlib import Path

import numpy as np
from aiohttp.test_utils import TestClient, TestServer

from jarvis_voice.server import create_app
from jarvis_voice.stt_gated import Enrollment


class ServerTest(unittest.IsolatedAsyncioTestCase):
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
