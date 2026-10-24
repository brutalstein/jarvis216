"""Local STT after semantic end-of-turn and speaker verification. No audio is persisted."""

import asyncio
import re
import time
from collections import deque
from collections.abc import AsyncGenerator
from contextlib import suppress
from typing import Any

import numpy as np
import torch  # noqa: F401 -- load bundled CUDA DLLs before faster-whisper
from numpy.typing import NDArray
from pipecat.frames.frames import (
    Frame,
    TranscriptionFrame,
    UserStoppedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.whisper.stt import WhisperSTTService

from jarvis_voice.addressee import fold, is_named
from jarvis_voice.enrollment import Enrollment
from jarvis_voice.events import event
from jarvis_voice.speaker import embed


def bandwidth(samples: NDArray[np.float32], rate: int) -> int:
    """Frequency under which 99% of the energy lies: ~3.4 kHz from a Bluetooth hands-free mic."""
    power = np.abs(np.fft.rfft(samples)) ** 2
    total = power.sum()
    if not total:
        return 0
    edge = int(np.searchsorted(np.cumsum(power) / total, 0.99))
    return int(np.fft.rfftfreq(len(samples), 1 / rate)[min(edge, len(power) - 1)])


# What Whisper writes for silence, noise or music: subtitle credits from its training data.
HALLUCINATIONS = frozenset(
    {
        "izlediğiniz için teşekkür ederim",
        "izlediğiniz için teşekkürler",
        "abone olmayı unutmayın",
        "beğenmeyi ve abone olmayı unutmayın",
        "thank you for watching",
        "thanks for watching",
        "please subscribe",
    }
)


def hallucinated(text: str) -> bool:
    words = re.sub(r"[^\w\s]", " ", fold(text)).split()
    phrase = " ".join(words)
    return phrase in HALLUCINATIONS or phrase.startswith(("altyazı", "subtitles by"))


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
        self.segment_timing: deque[tuple[float, float]] = deque()

    async def _handle_user_stopped_speaking(self, frame: VADUserStoppedSpeakingFrame) -> None:
        # Pipecat queues audio separately from inference; keep provenance in the same FIFO order.
        if self.is_usable:
            self.segment_timing.append((self.speech_end, time.monotonic()))
        await super()._handle_user_stopped_speaking(frame)

    async def warm_up(self) -> None:
        """Pay first-use costs (CUDA kernels, the speaker model) before the operator speaks."""

        def run() -> None:
            silence = bytes(16_000 * 2)
            if self.enrollment.gate.enrolled():
                embed(silence, 16_000)
            model = getattr(self, "_model", None)
            if model is not None:
                segments, _ = model.transcribe(np.zeros(16_000, dtype=np.float32), language="tr")
                list(segments)

        # A failed warm-up only means the first turn pays the cost itself.
        with suppress(Exception):
            await asyncio.to_thread(run)

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
        speech_end, queued = (
            self.segment_timing.popleft() if self.segment_timing else (self.speech_end, started)
        )
        speaker_ms = 0
        enrollment = self.enrollment
        event("stt.segment", seconds=round(len(audio) / (self.sample_rate * 2), 2))
        vector = None
        verified = False
        if enrollment.active or enrollment.gate.enrolled():
            vector = await asyncio.to_thread(embed, audio, self.sample_rate)
            speaker_ms = round((time.monotonic() - started) * 1000)
            if enrollment.active:
                # Bound enrollment in memory even if its UI is left open.
                if enrollment.seconds < 40:
                    enrollment.embeddings.append(vector)
                    enrollment.seconds += len(audio) / (self.sample_rate * 2)
                return
            similarity = enrollment.gate.similarity(vector)
            verified = similarity >= enrollment.gate.threshold
            # Every segment is decoded: the operator's own "Jarvis, saat kaç?" scored 0.08-0.25
            # on other microphones than the print's. Unverified speech passes only with the name.
            event("speaker.score", similarity=round(similarity, 3), accepted=verified)

        def transcribe() -> tuple[str, Any, dict[str, Any]]:
            samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768
            # Measured on a Bluetooth hands-free mic (narrowband): Whisper's free pick heard
            # "Jarvis, saat kaç?" as Urdu (Turkish not in its top five) and wrote "Javi Sattach".
            # JARVIS is Turkish-first, so English needs a clear lead, and the name prompt turns
            # "Yani saat kaç?" back into "Jarvis saat kaç?" without putting the name into
            # silence, noise or speech that lacks it.
            scores = dict(self._model.detect_language(samples)[2])
            english = scores.get("en", 0.0)
            language = "en" if english >= 0.5 and english > scores.get("tr", 0.0) else "tr"
            segments, info = self._model.transcribe(
                samples, language=language, initial_prompt="Jarvis", hotwords="Jarvis"
            )
            # Whisper's own rule: skip only when it doubts both speech and words. The prompt
            # alone raised no_speech_prob to 0.81 on clear speech.
            kept = [s for s in segments if not (s.no_speech_prob >= 0.6 and s.avg_logprob < -1.0)]
            text = " ".join(s.text.strip() for s in kept)
            detail = {
                "tr": round(scores.get("tr", 0.0), 3),
                "en": round(english, 3),
                "bandwidthHz": bandwidth(samples, self.sample_rate),
                "noSpeech": round(max((s.no_speech_prob for s in kept), default=0.0), 2),
                "logprob": round(min((s.avg_logprob for s in kept), default=0.0), 2),
            }
            return text, info, detail

        decoding = time.monotonic()
        text, info, detail = await asyncio.to_thread(transcribe)
        completed = time.monotonic()
        event(
            "stt.text",
            chars=len(text),
            language=str(info.language),
            decodeMs=round((completed - decoding) * 1000),
            **detail,
        )
        if text and hallucinated(text):
            event("stt.hallucination", chars=len(text))
            return
        if text:
            if vector is not None and is_named(text):
                # Whoever calls JARVIS by name is taken as the operator on this microphone, so
                # their unnamed follow-ups verify even when the print came from another one.
                enrollment.gate.adapt(vector)
            frame = TranscriptionFrame(text, "operator", "", language=info.language, finalized=True)
            frame.metadata.update(
                verified=verified,
                logprob=detail["logprob"],
                speechEnd=speech_end,
                turnEndMs=round(max(0, queued - speech_end) * 1000),
                segmentQueueMs=round(max(0, started - queued) * 1000),
                speakerMs=speaker_ms,
                transcribeMs=round((completed - decoding) * 1000),
                sttMs=round((completed - started) * 1000),
            )
            yield frame
