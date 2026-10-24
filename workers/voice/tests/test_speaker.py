import tempfile
import unittest
from pathlib import Path

import numpy as np

from jarvis_voice.speaker import DEFAULT_THRESHOLD, SpeakerGate


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

    def test_default_accepts_the_operator_saying_only_the_name(self) -> None:
        # Measured ECAPA cosine: the enrolled speaker's own 0.8-1.2 s clips scored 0.29-0.82,
        # other voices 0.04-0.17 on average. 0.7 turned the operator away after enrollment.
        gate = SpeakerGate(self.store, threshold=DEFAULT_THRESHOLD)
        gate.enroll([np.array([1.0, 0.0])])
        self.assertTrue(gate.accepts(np.array([0.3, 0.954])))
        self.assertFalse(gate.accepts(np.array([0.1, 0.995])))

    def test_the_operators_own_turns_adapt_the_print_to_the_current_microphone(self) -> None:
        # A Bluetooth headset put the operator's follow-ups at 0.21-0.25 against a print made
        # on another microphone; their own named turns on that headset match them far better.
        gate = SpeakerGate(self.store, threshold=DEFAULT_THRESHOLD)
        gate.enroll([np.array([1.0, 0.0, 0.0])])
        headset = np.array([0.22, 0.9, 0.38])
        self.assertFalse(gate.accepts(headset))
        gate.adapt(np.array([0.3, 0.85, 0.43]))
        self.assertTrue(gate.accepts(headset))
        self.assertFalse(gate.accepts(np.array([0.0, -0.6, 0.8])))
        # Learned for good: a restart still knows the headset; a new print starts over.
        self.assertTrue(SpeakerGate(self.store, DEFAULT_THRESHOLD).accepts(headset))
        gate.enroll([np.array([1.0, 0.0, 0.0])])
        self.assertFalse(gate.accepts(headset))
        self.assertFalse(SpeakerGate(self.store, DEFAULT_THRESHOLD).accepts(headset))

    def test_each_microphone_gets_its_own_channel_and_the_rarest_makes_room(self) -> None:
        gate = SpeakerGate(self.store, threshold=DEFAULT_THRESHOLD)
        gate.enroll([np.array([1.0, 0.0, 0.0, 0.0, 0.0, 0.0])])
        same = np.array([0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
        gate.adapt(same)
        gate.adapt(same + np.array([0.0, 0.0, 0.3, 0.0, 0.0, 0.0]))
        self.assertEqual(gate.counts, [2])
        for axis in (2, 3, 4):
            gate.adapt(np.eye(6)[axis])
        self.assertEqual(gate.counts, [2, 1, 1, 1])
        gate.adapt(np.eye(6)[5])
        self.assertEqual(len(gate.channels), 4)
        self.assertEqual(gate.counts[0], 2)
        self.assertTrue(gate.accepts(np.eye(6)[5]))

    def test_delete_forgets_the_channels_too(self) -> None:
        gate = SpeakerGate(self.store, threshold=DEFAULT_THRESHOLD)
        gate.enroll([np.array([1.0, 0.0])])
        gate.adapt(np.array([0.0, 1.0]))
        gate.delete()
        self.assertFalse((self.store / "operator-channels.npz").exists())
        self.assertEqual(gate.channels, [])

    def test_delete_forgets_the_voice(self) -> None:
        self.gate.enroll([self.voice])
        self.gate.delete()
        self.assertFalse((self.store / "operator.npy").exists())
        self.assertFalse(self.gate.enrolled())
        self.assertFalse(self.gate.accepts(self.voice))


if __name__ == "__main__":
    unittest.main()
