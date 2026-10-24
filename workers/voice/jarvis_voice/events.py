"""Pipeline events: numbers and flags only, never transcripts or audio.

Printed for the desktop launcher and appended to VOICE_DATA_DIR/voice.log, so a turn that never
reaches Core shows the stage where it stopped.
"""

import json
import os
import time
from pathlib import Path
from typing import Any

# shortcut: cut to its newest half past 1 MB; use a rotating handler if it is ever kept long-term.
LIMIT = 1_000_000


def event(name: str, **fields: Any) -> None:
    line = json.dumps({"event": name, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), **fields})
    print(line, flush=True)
    directory = os.environ.get("VOICE_DATA_DIR")
    if not directory:
        return
    path = Path(directory) / "voice.log"
    try:
        if path.exists() and path.stat().st_size > LIMIT:
            path.write_bytes(path.read_bytes()[-LIMIT // 2 :])
        with path.open("a", encoding="utf-8") as log:
            log.write(line + "\n")
    except OSError:
        pass  # A diagnostic log never stops a turn.
