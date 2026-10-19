"""Voice-print enrollment state: collected in memory, saved only as a normalized embedding.

Kept free of torch and Whisper so the signalling server and its tests load without CUDA.
"""

from pathlib import Path

from jarvis_voice.speaker import SpeakerGate, Vector


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
