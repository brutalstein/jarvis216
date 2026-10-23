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

from pipecat.frames.frames import VADUserStoppedSpeakingFrame
from pipecat.services.whisper.stt import WhisperSTTService

from jarvis_voice.brain import Brain
from jarvis_voice.core_client import Turn
from jarvis_voice.enrollment import Enrollment
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
            await brain.reply("Jarvis", False, 0)
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
                transcribe=lambda *args, **kwargs: (
                    [SimpleNamespace(text="Jarvis", no_speech_prob=0)],
                    SimpleNamespace(language="tr"),
                )
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
