"""Local STT after semantic end-of-turn and speaker verification. No audio is persisted."""

import asyncio
import json
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import numpy as np
import torch  # noqa: F401 -- load bundled CUDA DLLs before faster-whisper
from pipecat.frames.frames import (
    Frame,
    TranscriptionFrame,
    UserStoppedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.whisper.stt import WhisperSTTService

from jarvis_voice.speaker import SpeakerGate, Vector, embed


class Enrollment:
    def __init__(self, store: Path, threshold: float) -> None:
        self.gate = SpeakerGate(store, threshold)
        self.active = False
        self.embeddings: list[Vector] = []
        self.seconds = 0.0

    def start(self) -> None:
        self.embeddings.clear()
        self.seconds = 0.0
        self.active = True

    def cancel(self) -> None:
        self.active = False
        self.embeddings.clear()
        self.seconds = 0.0

    def finish(self) -> bool:
        if self.seconds < 25 or len(self.embeddings) < 3:
            return False
        self.gate.enroll(self.embeddings)
        self.embeddings.clear()
        self.active = False
        return True


class GatedSTT(WhisperSTTService):  # type: ignore[misc]
    def __init__(self, enrollment: Enrollment) -> None:
        super().__init__(
            device="cuda",
            compute_type="float16",
            audio_passthrough=True,
            settings=WhisperSTTService.Settings(model="large-v3", language=None, hotwords="Jarvis"),
        )
        self.enrollment = enrollment
        self.speech_end = time.monotonic()

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        # Smart Turn ends the segment; a brief VAD pause must not launch a model call.
        if isinstance(frame, VADUserStoppedSpeakingFrame):
            self.speech_end = time.monotonic() - frame.stop_secs
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, UserStoppedSpeakingFrame) and direction == FrameDirection.DOWNSTREAM:
            await super().process_frame(VADUserStoppedSpeakingFrame(stop_secs=0), direction)
        await super().process_frame(frame, direction)

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        started = time.monotonic()
        enrollment = self.enrollment
        if enrollment.active or enrollment.gate.enrolled():
            vector = await asyncio.to_thread(embed, audio, self.sample_rate)
            if enrollment.active:
                # Bound enrollment in memory even if its UI is left open.
                if enrollment.seconds < 40:
                    enrollment.embeddings.append(vector)
                    enrollment.seconds += len(audio) / (self.sample_rate * 2)
                return
            similarity = enrollment.gate.similarity(vector)
            print(
                json.dumps({"event": "speaker.score", "similarity": round(similarity, 3)}),
                flush=True,
            )
            if not enrollment.gate.accepts(vector):
                return

        def transcribe() -> tuple[str, Any]:
            samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768
            segments, info = self._model.transcribe(samples, language=None, hotwords="Jarvis")
            text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.6)
            return text, info

        text, info = await asyncio.to_thread(transcribe)
        if text:
            frame = TranscriptionFrame(text, "operator", "", language=info.language, finalized=True)
            frame.metadata.update(
                speechEnd=self.speech_end, sttMs=round((time.monotonic() - started) * 1000)
            )
            yield frame
