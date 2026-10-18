"""Two local Piper voices, selected from Core's validated reply language."""

import asyncio
import json
import time
from collections.abc import AsyncGenerator
from typing import Any

from pipecat.frames.frames import Frame, TTSAudioRawFrame, TTSSpeakFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from piper import PiperVoice
from piper.download_voices import download_voice

from jarvis_voice.speaker import MODELS


class BilingualTTS(TTSService):  # type: ignore[misc]
    def __init__(self) -> None:
        super().__init__(
            sample_rate=22050,
            push_start_frame=True,
            push_stop_frames=True,
            settings=TTSSettings(model="piper", voice="local", language=None),
        )
        self.voices = {}
        store = MODELS / "piper"
        store.mkdir(parents=True, exist_ok=True)
        for lang, name in {"tr": "tr_TR-dfki-medium", "en": "en_GB-alan-medium"}.items():
            path = store / f"{name}.onnx"
            if not path.exists():
                download_voice(name, store)
            self.voices[lang] = PiperVoice.load(path)
        self.timing: dict[str, Any] = {}

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        if isinstance(frame, TTSSpeakFrame):
            self.timing = frame.metadata.copy()
        await super().process_frame(frame, direction)

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        timing = self.timing.copy()
        voice = self.voices.get(timing.get("lang", "tr"), self.voices["tr"])
        started = time.monotonic()
        chunks = await asyncio.to_thread(lambda: list(voice.synthesize(text)))
        first = time.monotonic()
        total = round((first - timing.get("speechEnd", started)) * 1000)
        print(
            json.dumps(
                {
                    "event": "turn.timing",
                    "sttMs": timing.get("sttMs", 0),
                    "coreMs": timing.get("coreMs", 0),
                    "firstAudioMs": total,
                    "totalMs": total,
                    "ttsMs": round((first - started) * 1000),
                }
            ),
            flush=True,
        )
        for chunk in chunks:
            yield TTSAudioRawFrame(chunk.audio_int16_bytes, voice.config.sample_rate, 1)
