"""Decides whether speech is meant for JARVIS: its name, or the follow-up window after a reply."""

import re
import time
import unicodedata
from collections.abc import Callable

# Whisper spells the name many ways in Turkish speech; suffixes ("Jarvis'e", "jarvisciğim") count.
NAME = re.compile(r"\b[jcç][ae]rv[iı]s\w*")


def is_named(text: str) -> bool:
    return NAME.search(unicodedata.normalize("NFC", text).lower()) is not None


class FollowUpWindow:
    def __init__(self, seconds: float = 8.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.seconds = seconds
        self.clock = clock
        self.until = float("-inf")

    def open(self) -> None:
        self.until = self.clock() + self.seconds

    def is_open(self) -> bool:
        return self.clock() < self.until
