import asyncio
import unittest

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.tests.utils import SleepFrame, run_test

from jarvis_voice.brain import Brain
from jarvis_voice.core_client import FALLBACK, Turn


def transcript(text: str) -> TranscriptionFrame:
    return TranscriptionFrame(text, "operator", "now")


class FakeCore:
    def __init__(self, *, addressed: bool = True, fail: bool = False) -> None:
        self.calls: list[tuple[str, bool]] = []
        self.addressed = addressed
        self.fail = fail

    async def turn(self, utterance: str, follow_up: bool) -> Turn | None:
        self.calls.append((utterance, follow_up))
        await asyncio.sleep(0.08 if "ilk" in utterance else 0)
        if self.fail:
            return None
        return Turn("t", "k", self.addressed, utterance, "tr", [], "fake", 1)


class BrainTest(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, core: FakeCore, texts: list[str]) -> tuple[Brain, list[object]]:
        messages: list[dict] = []

        async def send(message: dict) -> None:
            messages.append(message)

        brain = Brain(core, send, lambda: True)
        frames = []
        for text in texts:
            frames.extend([transcript(text), UserStoppedSpeakingFrame(), SleepFrame(0.02)])
        frames.extend([SleepFrame(0.12), BotStoppedSpeakingFrame()])
        down, _ = await run_test(brain, frames_to_send=frames)
        self.messages = messages
        return brain, [f for f in down if isinstance(f, TTSSpeakFrame)]

    async def test_named_turn_speaks_and_shows_reply(self) -> None:
        core = FakeCore()
        brain, speech = await self.exercise(core, ["Jarvis merhaba"])
        self.assertEqual([f.text for f in speech], ["Jarvis merhaba"])
        self.assertEqual(core.calls, [("Jarvis merhaba", False)])
        self.assertIn({"type": "display", "blocks": []}, self.messages)
        self.assertIn(
            {"type": "caption", "role": "jarvis", "text": "Jarvis merhaba"}, self.messages
        )
        self.assertTrue(brain.window.is_open())

    async def test_unnamed_closed_window_is_ignored(self) -> None:
        core = FakeCore()
        _, speech = await self.exercise(core, ["televizyonda konuşma"])
        self.assertEqual(core.calls, [])
        self.assertEqual(speech, [])

    async def test_follow_up_false_address_stays_silent(self) -> None:
        core = FakeCore(addressed=False)
        brain = Brain(core, self.discard, lambda: True)
        brain.window.open()
        down, _ = await run_test(
            brain,
            frames_to_send=[transcript("akşam yemeği hazır"), UserStoppedSpeakingFrame()],
        )
        self.assertEqual(core.calls, [("akşam yemeği hazır", True)])
        self.assertFalse(any(isinstance(f, TTSSpeakFrame) for f in down))

    async def test_follow_up_needs_a_voice_print(self) -> None:
        core = FakeCore()
        brain = Brain(core, self.discard, lambda: False)
        brain.window.open()
        await run_test(
            brain,
            frames_to_send=[transcript("akşam yemeği hazır"), UserStoppedSpeakingFrame()],
        )
        self.assertEqual(core.calls, [])

    async def discard(self, message: dict) -> None:
        pass

    async def test_core_failure_speaks_fixed_apology(self) -> None:
        _, speech = await self.exercise(FakeCore(fail=True), ["Jarvis?"])
        self.assertEqual([f.text for f in speech], [FALLBACK["tr"]])

    async def test_english_core_failure_uses_an_english_apology(self) -> None:
        brain = Brain(FakeCore(fail=True), self.discard, lambda: True)
        frame = TranscriptionFrame("Jarvis, are you there?", "operator", "now", language="en")
        down, _ = await run_test(brain, frames_to_send=[frame, SleepFrame(0.03)])
        self.assertEqual([f.text for f in down if isinstance(f, TTSSpeakFrame)], [FALLBACK["en"]])

    async def test_new_turn_drops_the_pending_reply(self) -> None:
        core = FakeCore()
        _, speech = await self.exercise(core, ["Jarvis ilk", "Jarvis ikinci"])
        self.assertEqual([f.text for f in speech], ["Jarvis ikinci"])

    async def test_unaddressed_speech_does_not_cancel_an_addressed_turn(self) -> None:
        _, speech = await self.exercise(FakeCore(), ["Jarvis ilk", "televizyon konuşması"])
        self.assertEqual([f.text for f in speech], ["Jarvis ilk"])


if __name__ == "__main__":
    unittest.main()
