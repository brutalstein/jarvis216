"""Authenticated loopback signalling and enrollment for one operator desktop."""

import asyncio
import hmac
import json
import os
import sys
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

from aiohttp import web

from jarvis_voice.brain import Brain
from jarvis_voice.enrollment import Enrollment


def create_app(token: str, enrollment: Enrollment) -> web.Application:
    if not token:
        raise ValueError("VOICE_TOKEN_REQUIRED")

    @web.middleware  # type: ignore[untyped-decorator]
    async def authenticate(request: web.Request, handler: Any) -> web.StreamResponse:
        if request.method == "OPTIONS":
            response: web.StreamResponse = web.Response(status=204)
        elif not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            response = web.json_response({"error": "UNAUTHORIZED"}, status=401)
        else:
            response = await handler(request)
        # Electron's file:// renderer has the opaque origin "null". Bearer auth is still required.
        if request.headers.get("origin") == "null":
            response.headers.update(
                {
                    "Access-Control-Allow-Origin": "null",
                    "Vary": "Origin",
                    "Access-Control-Allow-Headers": "authorization, content-type",
                    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                }
            )
        return response

    app = web.Application(middlewares=[authenticate], client_max_size=128 * 1024)
    sessions: set[asyncio.Task[None]] = set()
    peer: Any = None
    brain: Brain | None = None
    offer_lock = asyncio.Lock()

    async def announce(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("text"), str)
                or not 1 <= len(data["text"]) <= 600
                or not data["text"].strip()
                or data.get("lang") not in ("tr", "en")
                or data.get("kind", "outcome") not in ("progress", "outcome")
                or not (
                    data.get("planId") is None
                    or (isinstance(data["planId"], str) and 1 <= len(data["planId"]) <= 64)
                )
            ):
                raise ValueError("INVALID_ANNOUNCEMENT")
        except (TypeError, ValueError):
            return web.json_response({"error": "INVALID_ANNOUNCEMENT"}, status=400)
        if brain is None:
            return web.json_response({"error": "NO_SESSION"}, status=409)
        try:
            await brain.announce(
                data["text"], data["lang"], data.get("kind", "outcome"), data.get("planId")
            )
        except Exception:
            return web.json_response({"error": "ANNOUNCEMENT_FAILED"}, status=503)
        return web.Response(status=204)

    async def health(request: web.Request) -> web.Response:
        return web.json_response(
            {"enrolled": enrollment.gate.enrolled(), "seconds": round(enrollment.seconds, 1)}
        )

    async def start(request: web.Request) -> web.Response:
        enrollment.start()
        return web.json_response({"enrolled": False})

    async def finish(request: web.Request) -> web.Response:
        if not enrollment.finish():
            return web.json_response({"error": "MORE_SPEECH_NEEDED"}, status=409)
        return web.json_response({"enrolled": True})

    async def cancel(request: web.Request) -> web.Response:
        enrollment.cancel()
        return web.json_response({"enrolled": enrollment.gate.enrolled()})

    async def remove(request: web.Request) -> web.Response:
        enrollment.cancel()
        enrollment.gate.delete()
        return web.Response(status=204)

    async def handle_offer(request: web.Request) -> web.Response:
        nonlocal peer
        try:
            data = await request.json()
            if not isinstance(data, dict):
                raise ValueError("INVALID_OFFER")
            if request.method == "PATCH":
                from aiortc.sdp import candidate_from_sdp

                if peer is None or data.get("pc_id") != peer.pc_id:
                    return web.json_response({"error": "NO_SESSION"}, status=404)
                items = data.get("candidates")
                if not isinstance(items, list) or len(items) > 32:
                    raise ValueError("INVALID_OFFER")
                candidates = []
                for item in items:
                    if (
                        not isinstance(item, dict)
                        or not isinstance(item.get("candidate"), str)
                        or len(item["candidate"]) > 8192
                    ):
                        raise ValueError("INVALID_OFFER")
                    try:
                        candidate = (
                            candidate_from_sdp(item["candidate"]) if item["candidate"] else None
                        )
                    except AssertionError as error:
                        raise ValueError("INVALID_OFFER") from error
                    if candidate is not None:
                        mid, index = item.get("sdp_mid"), item.get("sdp_mline_index")
                        if (
                            not (mid is None or isinstance(mid, str) and len(mid) <= 256)
                            or not (index is None or type(index) is int and 0 <= index <= 65535)
                            or mid is None
                            and index is None
                        ):
                            raise ValueError("INVALID_OFFER")
                        candidate.sdpMid = mid
                        candidate.sdpMLineIndex = index
                    candidates.append(candidate)
                for candidate in candidates:
                    await peer.add_ice_candidate(candidate)
                return web.Response(status=200)
            if data.get("type") != "offer" or not isinstance(data.get("sdp"), str):
                raise ValueError("INVALID_OFFER")
            if peer is not None:
                if data.get("pc_id") != peer.pc_id:
                    return web.json_response({"error": "SESSION_ACTIVE"}, status=409)
                await peer.renegotiate(
                    data["sdp"], data["type"], restart_pc=data.get("restart_pc", False)
                )
            else:
                from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

                connection = SmallWebRTCConnection(ice_servers=[])
                await connection.initialize(data["sdp"], data["type"])
                peer = connection

                @connection.event_handler("closed")  # type: ignore[untyped-decorator]
                async def closed(connection: Any) -> None:
                    nonlocal peer, brain
                    if peer is connection:
                        peer = None
                        brain = None

                session_open = True

                def set_brain(current: Brain | None) -> None:
                    nonlocal brain, session_open
                    if current is None:
                        session_open = False
                    if peer is connection and (current is None or session_open):
                        brain = current

                async def session() -> None:
                    nonlocal peer
                    try:
                        await run_session(connection, enrollment, set_brain)
                    except Exception:
                        connection.send_app_message(
                            {
                                "label": "rtvi-ai",
                                "type": "server-message",
                                "data": {"type": "error", "code": "VOICE_PIPELINE_FAILED"},
                            }
                        )
                        raise
                    finally:
                        set_brain(None)
                        if peer is connection:
                            peer = None
                        with suppress(Exception):
                            await asyncio.wait_for(connection.disconnect(), 5)

                task = asyncio.create_task(session())
                sessions.add(task)

                def finished(done: asyncio.Task[None]) -> None:
                    sessions.discard(done)
                    set_brain(None)
                    if not done.cancelled() and (error := done.exception()) is not None:
                        print(
                            f"VOICE_PIPELINE_FAILED: {type(error).__name__}: {error}",
                            file=sys.stderr,
                        )

                task.add_done_callback(finished)

            return web.json_response(peer.get_answer())
        except (KeyError, TypeError, ValueError):
            return web.json_response({"error": "INVALID_OFFER"}, status=400)

    async def offer(request: web.Request) -> web.Response:
        async with offer_lock:
            return await handle_offer(request)

    async def cleanup(app: web.Application) -> None:
        pending = list(sessions)
        if peer:
            with suppress(Exception):
                await asyncio.wait_for(peer.disconnect(), 5)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    app.router.add_get("/health", health)
    app.router.add_post("/enroll/start", start)
    app.router.add_post("/enroll/finish", finish)
    app.router.add_post("/enroll/cancel", cancel)
    app.router.add_delete("/enroll", remove)
    app.router.add_post("/offer", offer)
    app.router.add_post("/announce", announce)
    app.router.add_patch("/offer", offer)
    app.router.add_route("OPTIONS", "/{path:.*}", health)
    app.on_cleanup.append(cleanup)
    return app


async def run_session(
    connection: Any, enrollment: Enrollment, set_brain: Callable[[Brain | None], None]
) -> None:
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.audio.vad_processor import VADProcessor
    from pipecat.processors.frameworks.rtvi import RTVIProcessor
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
    from pipecat.turns.user_start import VADUserTurnStartStrategy
    from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
    from pipecat.turns.user_turn_processor import UserTurnProcessor
    from pipecat.turns.user_turn_strategies import UserTurnStrategies
    from pipecat.workers.runner import WorkerRunner

    from jarvis_voice.core_client import CoreClient
    from jarvis_voice.stt_gated import GatedSTT
    from jarvis_voice.tts import BilingualTTS

    core = CoreClient(os.environ["JARVIS_CORE_URL"], os.environ["JARVIS_CORE_TOKEN"])
    transport = SmallWebRTCTransport(
        connection,
        TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_stream_on_start=False,
        ),
    )
    rtvi = RTVIProcessor()
    turns = UserTurnProcessor(
        user_turn_strategies=UserTurnStrategies(
            start=[VADUserTurnStartStrategy(enable_interruptions=False)],
            stop=[
                TurnAnalyzerUserTurnStopStrategy(
                    turn_analyzer=LocalSmartTurnAnalyzerV3(),
                    wait_for_transcript=False,
                )
            ],
        )
    )
    brain = Brain(
        core,
        rtvi.send_server_message,
        enrollment.gate.enrolled,
        filler_s=float(os.environ.get("VOICE_FILLER_SECONDS", "1.2")),
    )
    stt = GatedSTT(enrollment)
    tts = BilingualTTS()
    # Models warm up while the operator is still getting ready to speak.
    warming = [asyncio.create_task(stt.warm_up()), asyncio.create_task(tts.warm_up())]
    pipeline = Pipeline(
        [
            transport.input(),
            VADProcessor(vad_analyzer=SileroVADAnalyzer()),
            turns,
            stt,
            brain,
            tts,
            transport.output(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        rtvi_processor=rtvi,
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=22050),
    )

    @transport.event_handler("on_client_disconnected")  # type: ignore[untyped-decorator]
    async def disconnected(*args: Any) -> None:
        set_brain(None)
        await worker.cancel()

    @worker.event_handler("on_pipeline_started")  # type: ignore[untyped-decorator]
    async def started(*args: Any) -> None:
        set_brain(brain)

    runner = WorkerRunner(handle_sigint=False)
    try:
        await runner.add_workers(worker)
        await runner.run()
    finally:
        set_brain(None)
        for task in warming:
            task.cancel()
        await asyncio.gather(*warming, return_exceptions=True)
        await core.http.aclose()


async def main() -> None:
    from loguru import logger

    # Vendor debug logs include transcripts. Keep them out of persistent process logs.
    logger.remove()
    logger.add(sys.stderr, level="ERROR", format="{message}")
    enrollment = Enrollment(
        Path(os.environ["VOICE_DATA_DIR"]), float(os.environ.get("VOICE_SPEAKER_THRESHOLD", "0.7"))
    )
    runner = web.AppRunner(create_app(os.environ["VOICE_TOKEN"], enrollment), access_log=None)
    await runner.setup()
    server = web.TCPSite(runner, "127.0.0.1", int(os.environ.get("VOICE_PORT", "0")))
    await server.start()
    port = runner.addresses[0][1]
    print(json.dumps({"event": "voice.ready", "port": port}), flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()
