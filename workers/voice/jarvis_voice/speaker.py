"""Operator voice print: a conversation filter, not a security boundary."""

from pathlib import Path
from typing import Any

import numpy as np

MODELS = Path(__file__).resolve().parents[3] / "data" / "voice" / "models"


def _unit(vector: np.ndarray) -> np.ndarray:
    return vector / (np.linalg.norm(vector) or 1.0)


class SpeakerGate:
    def __init__(self, store: Path, threshold: float) -> None:
        self.path = store / "operator.npy"
        self.threshold = threshold
        self.print: np.ndarray | None = np.load(self.path) if self.path.exists() else None

    def enrolled(self) -> bool:
        return self.print is not None

    def enroll(self, embeddings: list[np.ndarray]) -> None:
        self.print = _unit(np.mean([_unit(e) for e in embeddings], axis=0))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.save(self.path, self.print)

    def similarity(self, embedding: np.ndarray) -> float:
        return -1.0 if self.print is None else float(np.dot(self.print, _unit(embedding)))

    def accepts(self, embedding: np.ndarray) -> bool:
        return self.print is not None and self.similarity(embedding) >= self.threshold

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)
        self.print = None


_encoder: Any = None


def embed(audio: bytes, sample_rate: int) -> np.ndarray:
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
    return vector.cpu().numpy()
