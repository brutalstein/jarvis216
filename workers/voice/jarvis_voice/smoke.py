"""GPU smoke test: CUDA, Piper TTS voices, faster-whisper STT and ECAPA speaker embedding.

Prints one JSON line per check. Samples are written to data/voice/samples (gitignored).
"""

import json
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import soundfile
import torch  # first: its bundled CUDA/cuDNN DLLs must load before ctranslate2
import torchaudio

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = ROOT / "data" / "voice" / "samples"
LINES = {
    "tr": "Merhaba efendim, sizi dinliyorum.",
    "en": "Good evening, sir. I am listening.",
}
# Candidate voices; the first of each language is the default the STT check listens to.
VOICES = {
    "tr": ["tr_TR-dfki-medium"],
    "en": ["en_GB-alan-medium", "en_GB-northern_english_male-medium"],
}


def report(check: str, ok: bool, **detail: Any) -> None:
    print(json.dumps({"check": check, "ok": ok, **detail}, ensure_ascii=False), flush=True)


def timed(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[Any, int]:
    started = time.perf_counter()
    value = fn(*args, **kwargs)
    return value, round((time.perf_counter() - started) * 1000)


def gpu_used_mib() -> int:
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        check=True,
    )
    return int(out.stdout.split()[0])


def main() -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    baseline = gpu_used_mib()
    cuda = torch.cuda.is_available()
    report(
        "cuda",
        cuda,
        device=torch.cuda.get_device_name(0) if cuda else None,
        torch=torch.__version__,
        capability=torch.cuda.get_device_capability(0) if cuda else None,
    )
    if not cuda:
        return

    from piper import PiperVoice
    from piper.download_voices import download_voice

    models = ROOT / "data" / "voice" / "models" / "piper"
    models.mkdir(parents=True, exist_ok=True)
    for lang, voices in VOICES.items():
        for name in voices:
            if not (models / f"{name}.onnx").exists():
                download_voice(name, models)
            voice, load_ms = timed(PiperVoice.load, models / f"{name}.onnx")
            list(voice.synthesize(LINES[lang]))  # warm-up
            chunks, ms = timed(list, voice.synthesize(LINES[lang]))
            pcm = np.frombuffer(b"".join(c.audio_int16_bytes for c in chunks), dtype=np.int16)
            rate = voice.config.sample_rate
            path = SAMPLES / f"{lang}.wav" if name == voices[0] else SAMPLES / f"{name}.wav"
            soundfile.write(path, pcm, rate)
            report(
                "tts",
                True,
                voice=name,
                ms=ms,
                loadMs=load_ms,
                seconds=round(len(pcm) / rate, 2),
                file=str(path.relative_to(ROOT)),
            )

    from faster_whisper import WhisperModel

    stt, load_ms = timed(lambda: WhisperModel("large-v3", device="cuda", compute_type="float16"))
    for lang, text in LINES.items():
        sample = str(SAMPLES / f"{lang}.wav")
        list(stt.transcribe(sample)[0])  # warm-up
        (segments, info), _ = timed(stt.transcribe, sample, beam_size=1)
        transcript, ms = timed(" ".join, (s.text.strip() for s in segments))
        first = text.split()[0].strip(",").lower()
        report(
            "stt",
            first in transcript.lower(),
            lang=lang,
            detected=info.language,
            ms=ms,
            loadMs=load_ms,
            transcript=transcript,
        )

    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy

    encoder = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(ROOT / "data" / "voice" / "models" / "ecapa"),
        run_opts={"device": "cuda"},
        local_strategy=LocalStrategy.COPY,
    )
    data, sr = soundfile.read(SAMPLES / "tr.wav", dtype="float32")
    audio = torchaudio.functional.resample(torch.from_numpy(data).unsqueeze(0), sr, 16_000)
    embedding, ms = timed(lambda: encoder.encode_batch(audio.cuda()).squeeze())
    report("speaker", embedding.shape[-1] == 192, dims=int(embedding.shape[-1]), ms=ms)

    used = gpu_used_mib()
    report(
        "vram",
        used < 7680,
        usedMiB=used,
        addedMiB=used - baseline,
        torchPeakMiB=round(torch.cuda.max_memory_allocated() / 2**20),
    )


if __name__ == "__main__":
    main()
