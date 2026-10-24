"""Addressed speech goes through Core. A newer turn supersedes an unfinished reply.

JARVIS keeps the conversation going while Core works: what Core announces (progress, outcomes)
waits in a queue for a natural gap and never talks over the operator, and a slow answer gets a
short "one moment" instead of silence.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from jarvis_voice.addressee import FollowUpWindow, is_named, unfinished
from jarvis_voice.core_client import FALLBACK, Turn
from jarvis_voice.events import event

Kind = Literal["progress", "outcome"]
FILLERS = {
    "tr": ("Bir saniye, efendim.", "Bakıyorum, efendim.", "Hemen bakıyorum, efendim."),
    "en": ("One moment, sir.", "Let me see, sir.", "Looking into it, sir."),
}
# A progress line older than this says something no longer true; outcomes are always spoken.
PROGRESS_TTL_S = 12.0
QUEUE_LIMIT = 8
# Whisper's mean token log-probability below which the words may be misheard (clear speech
# measured -0.2 to -0.8, garbled -1.2 to -1.4); Core then confirms what it understood.
UNSURE_LOGPROB = -0.9
# The longest an unfinished sentence waits while the operator is still talking.
SPEAKING_LIMIT_S = 8.0


class Core(Protocol):
    async def turn(
        self, utterance: str, follow_up: bool, uncertain: bool = False
    ) -> Turn | None: ...


@dataclass
class Announcement:
    text: str
    lang: str
    kind: Kind
    plan_id: str | None
    at: float


class Brain(FrameProcessor):  # type: ignore[misc]
    def __init__(
        self,
        core: Core,
        send: Callable[[dict[str, Any]], Awaitable[None]],
        enrolled: Callable[[], bool],
        *,
        # Say a short filler when Core has not answered within this long (0 turns it off).
        filler_s: float = 1.2,
        # Leave the operator this long after they stop speaking before announcing anything:
        # their reply may still be on its way.
        hold_s: float = 1.5,
        # Pause between JARVIS's own sentences so the operator can come in.
        gap_s: float = 0.6,
        # How long an unfinished sentence ("Jarvis, bana ...") waits for the rest.
        continue_s: float = 1.5,
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
        self.user_speaking = False
        self.announcing = False
        self.filler_s = filler_s
        self.hold_s = hold_s
        self.gap_s = gap_s
        self.continue_s = continue_s
        # The request JARVIS has not answered yet: text, follow-up, uncertain recognition.
        self.request: tuple[str, bool, bool] | None = None
        # The turn waiting for the rest of an unfinished sentence.
        self.holding: int | None = None
        self.queue: list[Announcement] = []
        self.heard_at = float("-inf")
        self.drainer: asyncio.Task[None] | None = None
        self.filler_playing = False
        self.filler_done = asyncio.Event()
        self.fillers = 0

    def busy(self) -> bool:
        return (
            self.user_speaking
            or (self.pending is not None and not self.pending.done())
            or self.replied
            or self.announcing
            or self.filler_playing
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStartedSpeakingFrame):
            self.user_speaking = True
        if isinstance(frame, UserStoppedSpeakingFrame):
            self.user_speaking = False
            self.heard_at = time.monotonic()
            self.schedule(self.hold_s)
        if isinstance(frame, TranscriptionFrame):
            text = frame.text.strip()[:4000]
            named = is_named(text)
            verified = bool(frame.metadata.get("verified"))
            # Mid-sentence ("Jarvis, bana ..."), the next words finish the same request.
            continuing = self.holding is not None
            # Once addressed, JARVIS keeps listening to the operator without its name while it
            # works or speaks and for a while after. Only their verified voice counts there;
            # without a voice print anyone could speak, so the name is required.
            follow_up = not named and (
                continuing
                or (verified and self.enrolled() and (self.window.is_open() or self.busy()))
            )
            event(
                "brain.heard",
                chars=len(text),
                named=named,
                verified=verified,
                continuing=continuing,
                followUp=follow_up,
            )
            if text and (named or follow_up):
                self.window.open()
                uncertain = float(frame.metadata.get("logprob", 0.0)) < UNSURE_LOGPROB
                if self.pending is not None and not self.pending.done() and self.request:
                    # JARVIS has not answered yet: these words continue or add to the request.
                    earlier, earlier_follow_up, earlier_uncertain = self.request
                    text = f"{earlier} {text}"[:4000]
                    follow_up = follow_up and earlier_follow_up
                    uncertain = uncertain or earlier_uncertain
                self.request = (text, follow_up, uncertain)
                self.timing = frame.metadata.copy()
                self.timing["lang"] = "en" if str(frame.language) == "en" else "tr"
                # Neither unverified VAD nor unrelated speech can interrupt a reply.
                self.sequence += 1
                if self.pending:
                    self.pending.cancel()
                await self.broadcast_frame(InterruptionFrame)
                self.pending = self.create_task(
                    self.reply(text, follow_up, self.sequence, uncertain)
                )
            return
        if isinstance(frame, BotStoppedSpeakingFrame):
            if self.filler_playing:
                self.filler_playing = False
                self.filler_done.set()
            elif self.replied or self.announcing:
                # After anything JARVIS said, the operator may answer without its name.
                self.window.open()
                self.replied = False
                self.announcing = False
                await self.send({"type": "state", "value": "listening"})
                self.schedule(self.gap_s)
        if isinstance(frame, EndFrame) and self.pending:
            with suppress(asyncio.CancelledError):
                await self.pending
        if isinstance(frame, (EndFrame, CancelFrame)) and self.drainer:
            self.drainer.cancel()
        if isinstance(frame, CancelFrame) and self.pending:
            self.pending.cancel()
        await self.push_frame(frame, direction)

    async def announce(
        self, text: str, lang: str, kind: Kind = "outcome", plan_id: str | None = None
    ) -> None:
        """Queue what Core announced; it is spoken at the next natural gap."""
        if kind == "progress":
            # Only the newest progress per plan matters, and none once its outcome is queued.
            if plan_id and any(a.kind == "outcome" and a.plan_id == plan_id for a in self.queue):
                return
            self.queue = [
                a for a in self.queue if not (a.kind == "progress" and a.plan_id == plan_id)
            ]
        elif plan_id:
            self.queue = [
                a for a in self.queue if not (a.kind == "progress" and a.plan_id == plan_id)
            ]
        self.queue.append(Announcement(text, lang, kind, plan_id, time.monotonic()))
        del self.queue[:-QUEUE_LIMIT]
        await self.drain()

    def schedule(self, delay: float) -> None:
        if self.drainer is not None and not self.drainer.done():
            return

        async def later() -> None:
            await asyncio.sleep(max(0.0, delay))
            await self.drain()

        self.drainer = asyncio.get_running_loop().create_task(later())

    def next_announcement(self) -> Announcement | None:
        now = time.monotonic()
        self.queue = [a for a in self.queue if a.kind == "outcome" or now - a.at <= PROGRESS_TTL_S]
        for index, item in enumerate(self.queue):
            if item.kind == "outcome":
                return self.queue.pop(index)
        return self.queue.pop() if self.queue else None

    async def drain(self) -> None:
        if self.busy() or not self.queue:
            return
        wait = self.hold_s - (time.monotonic() - self.heard_at)
        if wait > 0:
            self.schedule(wait)
            return
        item = self.next_announcement()
        if item is None:
            return
        self.announcing = True
        try:
            await self.send({"type": "caption", "role": "jarvis", "text": item.text})
            await self.send({"type": "state", "value": "speaking"})
            # A user turn may have arrived while the caption was being sent.
            if self.user_speaking or (self.pending is not None and not self.pending.done()):
                self.announcing = False
                self.queue.insert(0, item)
                return
            speech = TTSSpeakFrame(item.text)
            speech.metadata["lang"] = item.lang
            await self.push_frame(speech)
        except BaseException:
            self.announcing = False
            raise

    async def fill(self, sequence: int, lang: str) -> None:
        await asyncio.sleep(self.filler_s)
        if sequence != self.sequence or self.user_speaking or self.announcing or self.replied:
            return
        phrases = FILLERS.get(lang, FILLERS["tr"])
        text = phrases[self.fillers % len(phrases)]
        self.fillers += 1
        self.filler_playing = True
        self.filler_done.clear()
        try:
            speech = TTSSpeakFrame(text)
            speech.metadata["lang"] = lang
            await self.push_frame(speech)
        except BaseException:
            self.filler_playing = False
            self.filler_done.set()
            raise

    async def reply(
        self, text: str, follow_up: bool, sequence: int, uncertain: bool = False
    ) -> None:
        await self.send({"type": "caption", "role": "user", "text": text})
        if unfinished(text):
            # The operator is mid-sentence: give them time to go on, and longer while they talk.
            self.holding = sequence
            try:
                await asyncio.sleep(self.continue_s)
                deadline = time.monotonic() + SPEAKING_LIMIT_S
                while self.user_speaking and time.monotonic() < deadline:
                    await asyncio.sleep(0.05)
            finally:
                if self.holding == sequence:
                    self.holding = None
        await self.send({"type": "state", "value": "thinking"})
        started = time.monotonic()
        timing = self.timing.copy()
        filler = (
            asyncio.get_running_loop().create_task(self.fill(sequence, timing.get("lang", "tr")))
            if self.filler_s > 0
            else None
        )
        try:
            result = await self.core.turn(text, follow_up, uncertain)
            core_done = time.monotonic()
            event(
                "core.turn",
                answered=result is not None,
                addressed=bool(result and result.addressed),
            )
        except Exception as error:
            event("core.failed", error=type(error).__name__)
            raise
        finally:
            if filler is not None:
                filler.cancel()
        if sequence != self.sequence:
            return
        if result is not None and not result.addressed:
            await self.send({"type": "state", "value": "listening"})
            self.schedule(0)
            return
        lang = result.lang if result else timing.get("lang", "tr")
        say = (result.say if result else "") or FALLBACK[lang]
        # The filler finishes first; the answer follows it instead of cutting it off.
        if self.filler_playing:
            with suppress(TimeoutError):
                await asyncio.wait_for(self.filler_done.wait(), 4)
            self.filler_playing = False
        if sequence != self.sequence:
            return
        await self.send({"type": "caption", "role": "jarvis", "text": say})
        await self.send({"type": "display", "blocks": result.display if result else []})
        await self.send({"type": "state", "value": "speaking"})
        speech = TTSSpeakFrame(say)
        speech.metadata.update(
            {
                **timing,
                "lang": lang,
                "coreMs": round((core_done - started) * 1000),
                "replyWaitMs": round((time.monotonic() - core_done) * 1000),
            }
        )
        self.replied = True
        await self.push_frame(speech)
