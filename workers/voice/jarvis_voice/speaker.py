"""Operator voice print: a conversation filter, not a security boundary."""

from collections import deque
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

type Vector = NDArray[np.float64]
MODELS = Path(__file__).resolve().parents[3] / "data" / "voice" / "models"
# SpeechBrain's own verification threshold for this ECAPA model. A wake phrase is ~1 s, and the
# operator's own 1 s clips score 0.3-0.8 against a print from longer speech, so 0.7 rejected them.
DEFAULT_THRESHOLD = 0.25
# The operator's own named turns this session, as a second reference for their current microphone.
SESSION_TURNS = 10


def _unit(vector: Vector) -> Vector:
    unit: Vector = vector / (np.linalg.norm(vector) or 1.0)
    return unit


class SpeakerGate:
    def __init__(self, store: Path, threshold: float) -> None:
        self.path = store / "operator.npy"
        self.threshold = threshold
        self.print: Vector | None = np.load(self.path) if self.path.exists() else None
        # In memory only: a headset scores the operator far lower against a print made on
        # another microphone (0.21-0.25 measured over Bluetooth) than against their own turns.
        self.session: deque[Vector] = deque(maxlen=SESSION_TURNS)

    def enrolled(self) -> bool:
        return self.print is not None

    def enroll(self, embeddings: list[Vector]) -> None:
        self.print = _unit(np.mean([_unit(e) for e in embeddings], axis=0))
        self.session.clear()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.save(self.path, self.print)

    def adapt(self, embedding: Vector) -> None:
        """Remember a turn already verified as the operator's, as heard on this microphone."""
        self.session.append(_unit(embedding))

    def similarity(self, embedding: Vector) -> float:
        if self.print is None:
            return -1.0
        vector = _unit(embedding)
        score = float(np.dot(self.print, vector))
        if self.session:
            score = max(score, float(np.dot(_unit(np.mean(self.session, axis=0)), vector)))
        return score

    def accepts(self, embedding: Vector) -> bool:
        return self.print is not None and self.similarity(embedding) >= self.threshold

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)
        self.print = None
        self.session.clear()


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
