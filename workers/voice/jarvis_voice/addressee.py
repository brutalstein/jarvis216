"""Decides whether speech is meant for JARVIS: its name, or the follow-up window after a reply."""

import re
import time
import unicodedata
from collections.abc import Callable

# Whisper spells the name many ways in Turkish speech; suffixes ("Jarvis'e", "jarvisciğim") count.
NAME = re.compile(r"\b[jcç][ae]rv[iı]s\w*")


def fold(text: str) -> str:
    # "İ".lower() leaves a combining dot (U+0307) that would split "JARVİS".
    return unicodedata.normalize("NFC", text).lower().replace("̇", "")


def is_named(text: str) -> bool:
    return NAME.search(fold(text)) is not None


# A sentence ending on one of these is still on its way: a conjunction, a connective or an
# object pronoun waiting for its verb ("Jarvis, bana ...", "müziği aç ve ...").
CONTINUES = frozenset(
    "ve veya ya ama fakat ancak çünkü sonra ile için gibi kadar daha bir eğer hem yani şey "
    "mesela ayrıca önce bana beni sana seni onu bunu şunu buna şuna ona and or but because "
    "the a an to for with of then so my me please".split()
)


def unfinished(text: str) -> bool:
    """Whether the words read like the start of a request rather than a whole one."""
    if re.search(r"(,|\.\.\.|…|-)\s*$", text):
        return True
    words = [w for w in re.sub(r"[^\w\s]", " ", fold(text)).split() if not NAME.fullmatch(w)]
    return not words or words[-1] in CONTINUES


class FollowUpWindow:
    def __init__(self, seconds: float = 8.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.seconds = seconds
        self.clock = clock
        self.until = float("-inf")

    def open(self) -> None:
        self.until = self.clock() + self.seconds

    def is_open(self) -> bool:
        return self.clock() < self.until
