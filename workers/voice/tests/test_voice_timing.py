import asyncio
import contextlib
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
from pipecat.frames.frames import VADUserStoppedSpeakingFrame
from pipecat.services.whisper.stt import WhisperSTTService

from jarvis_voice.brain import Brain
from jarvis_voice.core_client import Turn
from jarvis_voice.enrollment import Enrollment
from jarvis_voice.speaker import DEFAULT_THRESHOLD
from jarvis_voice.stt_gated import GatedSTT
from jarvis_voice.tts import BilingualTTS


class VoiceTimingTest(unittest.IsolatedAsyncioTestCase):
    async def test_core_timing_excludes_waiting_for_filler_playback(self) -> None:
        core = SimpleNamespace(
            turn=AsyncMock(return_value=Turn("t", None, True, "ok", "tr", [], None, 0))
        )
        brain = Brain(core, AsyncMock(), lambda: False, filler_s=0)
        brain.filler_playing = True
        brain.push_frame = AsyncMock()
        loop = asyncio.get_running_loop()
        done = loop.call_later(0.1, brain.filler_done.set)
        try:
            await brain.reply("Jarvis saat kaç", False, 0)
        finally:
            done.cancel()
        timing = brain.push_frame.call_args.args[0].metadata
        self.assertLess(timing["coreMs"], 50)
        self.assertGreaterEqual(timing["replyWaitMs"], 75)

    async def test_queued_segments_keep_their_own_speech_end(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(WhisperSTTService, "_load"):
            stt = GatedSTT(Enrollment(Path(directory), 0.7))
            stt._sample_rate = 16000
            stt._model = SimpleNamespace(
                detect_language=lambda *args, **kwargs: ("tr", 0.9, [("tr", 0.9)]),
                transcribe=lambda *args, **kwargs: (
                    [SimpleNamespace(text="Jarvis", no_speech_prob=0, avg_logprob=0)],
                    SimpleNamespace(language="tr"),
                ),
            )
            for ended in [time.monotonic() - 2, time.monotonic() - 1]:
                stt.speech_end = ended
                stt._audio_buffer = bytearray(320)
                await stt._handle_user_stopped_speaking(VADUserStoppedSpeakingFrame(stop_secs=0))
            stt.speech_end = time.monotonic()
            frames = []
            for _ in range(2):
                audio = await stt._segment_queue.get()
                frames.extend([frame async for frame in stt.run_stt(audio)])
            self.assertLess(frames[0].metadata["speechEnd"], frames[1].metadata["speechEnd"])
            self.assertLess(frames[1].metadata["speechEnd"], stt.speech_end)
            for frame in frames:
                self.assertGreaterEqual(frame.metadata["segmentQueueMs"], 0)
                self.assertGreaterEqual(frame.metadata["transcribeMs"], 0)

    async def decode(self, probabilities, segments, voice=None):
        """One segment through GatedSTT with a fake Whisper; returns (calls, frames, stt).

        With `voice`, the gate holds the print [1, 0] and the segment embeds as `voice`.
        """
        calls = []

        def transcribe(*args, **kwargs):
            calls.append(kwargs)
            return segments, SimpleNamespace(language=kwargs["language"])

        with tempfile.TemporaryDirectory() as directory, patch.object(WhisperSTTService, "_load"):
            stt = GatedSTT(Enrollment(Path(directory), 0.7))
            stt._sample_rate = 16000
            stt._model = SimpleNamespace(
                detect_language=lambda *args, **kwargs: ("", 0.0, probabilities),
                transcribe=transcribe,
            )
            if voice is not None:
                stt.enrollment.gate.threshold = DEFAULT_THRESHOLD
                stt.enrollment.gate.enroll([np.array([1.0, 0.0])])
            with patch("jarvis_voice.stt_gated.embed", return_value=np.array(voice or [1.0, 0.0])):
                frames = [frame async for frame in stt.run_stt(bytes(3200))]
        return calls, frames, stt

    async def test_narrowband_turkish_decodes_as_turkish_with_the_name_prompt(self) -> None:
        # A Bluetooth hands-free "Jarvis, saat kaç?": Urdu 0.71, English 0.05, Turkish not in
        # the top five. Free decoding wrote "Javi Sattach"; Turkish with the name prompt wrote
        # "Jarvis saat kaç?".
        speech = SimpleNamespace(text="Jarvis saat kaç?", no_speech_prob=0.0, avg_logprob=-0.74)
        calls, frames, _ = await self.decode([("ur", 0.71), ("pt", 0.05), ("en", 0.046)], [speech])
        self.assertEqual(calls[0]["language"], "tr")
        self.assertEqual(calls[0]["initial_prompt"], "Jarvis")
        self.assertEqual(frames[0].text, "Jarvis saat kaç?")

    async def test_english_needs_a_clear_lead(self) -> None:
        speech = SimpleNamespace(
            text="Jarvis, what time is it?", no_speech_prob=0.0, avg_logprob=-0.3
        )
        calls, _, _ = await self.decode([("en", 0.93), ("tr", 0.02)], [speech])
        self.assertEqual(calls[0]["language"], "en")
        calls, _, _ = await self.decode([("en", 0.41), ("tr", 0.3)], [speech])
        self.assertEqual(calls[0]["language"], "tr")

    async def test_drops_a_segment_only_when_whisper_doubts_both_speech_and_words(self) -> None:
        # The name prompt raised no_speech_prob to 0.81 on clear speech (avg_logprob -0.21).
        kept = SimpleNamespace(text="Jarvis bugün", no_speech_prob=0.81, avg_logprob=-0.21)
        dropped = SimpleNamespace(text="Altyazı M.K.", no_speech_prob=0.9, avg_logprob=-1.4)
        _, frames, _ = await self.decode([("tr", 0.9)], [kept, dropped])
        self.assertEqual(frames[0].text, "Jarvis bugün")

    async def test_an_unverified_voice_is_still_decoded_so_its_name_can_pass(self) -> None:
        # The operator's own "Jarvis, saat kaç?" scored 0.08-0.25 on microphones other than
        # the print's and was dropped before decoding. Now it is decoded, marked unverified,
        # and only the name lets it reach Core.
        speech = SimpleNamespace(text="Jarvis saat kaç?", no_speech_prob=0.0, avg_logprob=-0.5)
        for voice in ([0.22, 0.975], [0.05, 0.999]):
            calls, frames, stt = await self.decode([("tr", 0.9)], [speech], voice=voice)
            self.assertEqual(len(calls), 1)
            self.assertEqual(frames[0].text, "Jarvis saat kaç?")
            self.assertFalse(frames[0].metadata["verified"])
            # Calling JARVIS by name teaches the gate this microphone's version of the voice.
            self.assertEqual(len(stt.enrollment.gate.session), 1)

    async def test_whispers_subtitle_credits_for_noise_are_dropped(self) -> None:
        noise = SimpleNamespace(
            text=" İzlediğiniz için teşekkür ederim.", no_speech_prob=0.0, avg_logprob=-0.3
        )
        _, frames, _ = await self.decode([("tr", 0.9)], [noise])
        self.assertEqual(frames, [])
        thanks = SimpleNamespace(text="Teşekkür ederim.", no_speech_prob=0.0, avg_logprob=-0.3)
        _, frames, _ = await self.decode([("tr", 0.9)], [thanks])
        self.assertEqual(frames[0].text, "Teşekkür ederim.")

    async def test_a_verified_named_turn_adapts_the_print(self) -> None:
        speech = SimpleNamespace(text="Jarvis saat kaç?", no_speech_prob=0.0, avg_logprob=-0.5)
        _, frames, stt = await self.decode([("tr", 0.9)], [speech], voice=[0.5, 0.866])
        self.assertTrue(frames[0].metadata["verified"])
        self.assertEqual(len(stt.enrollment.gate.session), 1)
        unnamed = SimpleNamespace(text="saat kaç?", no_speech_prob=0.0, avg_logprob=-0.5)
        _, frames, stt = await self.decode([("tr", 0.9)], [unnamed], voice=[0.5, 0.866])
        self.assertTrue(frames[0].metadata["verified"])
        self.assertFalse(stt.enrollment.gate.session)

    async def test_synthesis_yields_first_chunk_without_waiting_for_the_rest(self) -> None:
        tts = object.__new__(BilingualTTS)
        produced = []

        def synthesize(text):
            for index in range(2):
                produced.append(index)
                yield SimpleNamespace(audio_int16_bytes=b"\x00\x00")

        tts.voices = {
            "tr": SimpleNamespace(synthesize=synthesize, config=SimpleNamespace(sample_rate=22050))
        }
        tts.timing = {"speechEnd": time.monotonic(), "sttMs": 5, "coreMs": 8}
        stream = tts.run_tts("test", "context")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            await anext(stream)
            self.assertEqual(produced, [0])
            await anext(stream)
            with self.assertRaises(StopAsyncIteration):
                await anext(stream)
        timing = json.loads(output.getvalue())
        self.assertEqual(timing["event"], "turn.timing")
        self.assertGreaterEqual(timing["totalMs"], timing["firstAudioMs"])

    async def test_announcement_synthesis_is_not_counted_as_a_user_turn(self) -> None:
        tts = object.__new__(BilingualTTS)
        tts.voices = {
            "tr": SimpleNamespace(
                synthesize=lambda text: iter([SimpleNamespace(audio_int16_bytes=b"\x00\x00")]),
                config=SimpleNamespace(sample_rate=22050),
            )
        }
        tts.timing = {"lang": "tr"}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(len([chunk async for chunk in tts.run_tts("test", "context")]), 1)
        self.assertEqual(json.loads(output.getvalue())["event"], "voice.timing")
