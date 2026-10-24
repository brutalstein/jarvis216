"""Operator voice print: a conversation filter, not a security boundary."""

from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

type Vector = NDArray[np.float64]
MODELS = Path(__file__).resolve().parents[3] / "data" / "voice" / "models"
# SpeechBrain's own verification threshold for this ECAPA model. A wake phrase is ~1 s, and the
# operator's own 1 s clips score 0.3-0.8 against a print from longer speech, so 0.7 rejected them.
DEFAULT_THRESHOLD = 0.25
# The operator as each of their microphones hears them: a headset scored their speech 0.08-0.25
# against a print made on another microphone, but far higher against their own turns on it.
MAX_CHANNELS = 4
# ECAPA cosine above which a turn is the same voice through the same microphone.
SAME_CHANNEL = 0.5
# A channel's mean keeps following the voice: older turns weigh at most this many.
CHANNEL_MEMORY = 50


def _unit(vector: Vector) -> Vector:
    unit: Vector = vector / (np.linalg.norm(vector) or 1.0)
    return unit


class SpeakerGate:
    def __init__(self, store: Path, threshold: float) -> None:
        self.path = store / "operator.npy"
        self.threshold = threshold
        self.print: Vector | None = np.load(self.path) if self.path.exists() else None
        # Learned from turns that named JARVIS and kept across restarts, like the print: only
        # normalized embeddings, never audio.
        self.channels_path = store / "operator-channels.npz"
        self.channels: list[Vector] = []
        self.counts: list[int] = []
        if self.print is not None and self.channels_path.exists():
            with np.load(self.channels_path) as saved:
                self.channels = [np.asarray(c, dtype=np.float64) for c in saved["centroids"]]
                self.counts = [int(n) for n in saved["counts"]]

    def enrolled(self) -> bool:
        return self.print is not None

    def enroll(self, embeddings: list[Vector]) -> None:
        self.print = _unit(np.mean([_unit(e) for e in embeddings], axis=0))
        self.forget_channels()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.save(self.path, self.print)

    def adapt(self, embedding: Vector) -> None:
        """Learn the operator's voice as the microphone that heard this turn renders it."""
        if self.print is None:
            return
        vector = _unit(embedding)
        nearest = max(
            range(len(self.channels)), key=lambda i: self.channels[i] @ vector, default=-1
        )
        if nearest >= 0 and self.channels[nearest] @ vector >= SAME_CHANNEL:
            weight = min(self.counts[nearest], CHANNEL_MEMORY)
            self.channels[nearest] = _unit(self.channels[nearest] * weight + vector)
            self.counts[nearest] += 1
        elif len(self.channels) < MAX_CHANNELS:
            self.channels.append(vector)
            self.counts.append(1)
        else:
            rare = min(range(len(self.counts)), key=self.counts.__getitem__)
            self.channels[rare], self.counts[rare] = vector, 1
        np.savez(
            self.channels_path, centroids=np.array(self.channels), counts=np.array(self.counts)
        )

    def forget_channels(self) -> None:
        self.channels, self.counts = [], []
        self.channels_path.unlink(missing_ok=True)

    def similarity(self, embedding: Vector) -> float:
        if self.print is None:
            return -1.0
        vector = _unit(embedding)
        return max([float(np.dot(self.print, vector))] + [float(c @ vector) for c in self.channels])

    def accepts(self, embedding: Vector) -> bool:
        return self.print is not None and self.similarity(embedding) >= self.threshold

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)
        self.print = None
        self.forget_channels()


_encoder: Any = None


def embed(audio: bytes, sample_rate: int) -> Vector:
    """ECAPA embedding of 16-bit mono PCM."""
    global _encoder
    import torch
    import torchaudio
    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy

    if _encoder is None:
        _encoder = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(MODELS / "ecapa"),
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"},
            local_strategy=LocalStrategy.COPY,
        )
    samples = torch.frombuffer(bytearray(audio), dtype=torch.int16).float() / 32768
    samples = torchaudio.functional.resample(samples.unsqueeze(0), sample_rate, 16_000)
    with torch.no_grad():
        vector = _encoder.encode_batch(samples.to(_encoder.device)).squeeze()
    return np.asarray(vector.cpu().numpy(), dtype=np.float64)
