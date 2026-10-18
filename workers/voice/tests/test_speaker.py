import tempfile
import unittest
from pathlib import Path

import numpy as np

from jarvis_voice.speaker import SpeakerGate


class SpeakerGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.store = Path(self.dir.name)
        self.gate = SpeakerGate(self.store, threshold=0.6)
        self.voice = np.array([3.0, 4.0, 0.0])

    def tearDown(self) -> None:
        self.dir.cleanup()

    def test_rejects_everyone_before_enrollment(self) -> None:
        self.assertFalse(self.gate.enrolled())
        self.assertFalse(self.gate.accepts(self.voice))

    def test_accepts_the_enrolled_voice_only(self) -> None:
        self.gate.enroll([self.voice, self.voice * 2])
        self.assertTrue((self.store / "operator.npy").exists())
        self.assertTrue(SpeakerGate(self.store, threshold=0.6).accepts(self.voice))
        self.assertFalse(self.gate.accepts(np.array([0.0, 0.0, 1.0])))

    def test_delete_forgets_the_voice(self) -> None:
        self.gate.enroll([self.voice])
        self.gate.delete()
        self.assertFalse((self.store / "operator.npy").exists())
        self.assertFalse(self.gate.enrolled())
        self.assertFalse(self.gate.accepts(self.voice))


if __name__ == "__main__":
    unittest.main()
