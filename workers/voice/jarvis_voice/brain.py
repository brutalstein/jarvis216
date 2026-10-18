"""Addressed speech goes through Core. A newer turn supersedes an unfinished reply."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Protocol

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from jarvis_voice.addressee import FollowUpWindow, is_named
from jarvis_voice.core_client import FALLBACK, Turn


class Core(Protocol):
    async def turn(self, utterance: str, follow_up: bool) -> Turn | None: ...


class Brain(FrameProcessor):  # type: ignore[misc]
    def __init__(
        self,
        core: Core,
        send: Callable[[dict[str, Any]], Awaitable[None]],
        enrolled: Callable[[], bool],
    ) -> None:
        super().__init__()
        self.core = core
        self.send = send
        self.enrolled = enrolled
        self.window = FollowUpWindow()
        self.pending: asyncio.Task[None] | None = None
        self.sequence = 0
        self.timing: dict[str, Any] = {}
        self.replied = False

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            text = frame.text.strip()[:4000]
            named = is_named(text)
            # Without a voice print anyone could speak in the window, so the name is required.
            follow_up = not named and self.window.is_open() and self.enrolled()
            if text and (named or follow_up):
                self.timing = frame.metadata.copy()
                self.timing["lang"] = "en" if str(frame.language) == "en" else "tr"
                # Neither unverified VAD nor unrelated speech can interrupt a reply.
                self.sequence += 1
                if self.pending:
                    self.pending.cancel()
                await self.broadcast_frame(InterruptionFrame)
                self.pending = self.create_task(self.reply(text, follow_up, self.sequence))
            return
        if isinstance(frame, BotStoppedSpeakingFrame) and self.replied:
            self.replied = False
            self.window.open()
            await self.send({"type": "state", "value": "listening"})
        if isinstance(frame, EndFrame) and self.pending:
            with suppress(asyncio.CancelledError):
                await self.pending
        if isinstance(frame, CancelFrame) and self.pending:
            self.pending.cancel()
        await self.push_frame(frame, direction)

    async def reply(self, text: str, follow_up: bool, sequence: int) -> None:
        await self.send({"type": "caption", "role": "user", "text": text})
        await self.send({"type": "state", "value": "thinking"})
        started = time.monotonic()
        timing = self.timing.copy()
        result = await self.core.turn(text, follow_up)
        if sequence != self.sequence:
            return
        if result is not None and not result.addressed:
            await self.send({"type": "state", "value": "listening"})
            return
        lang = result.lang if result else timing.get("lang", "tr")
        say = (result.say if result else "") or FALLBACK[lang]
        await self.send({"type": "caption", "role": "jarvis", "text": say})
        await self.send({"type": "display", "blocks": result.display if result else []})
        await self.send({"type": "state", "value": "speaking"})
        speech = TTSSpeakFrame(say)
        speech.metadata.update(
            {**timing, "lang": lang, "coreMs": round((time.monotonic() - started) * 1000)}
        )
        self.replied = True
        await self.push_frame(speech)
