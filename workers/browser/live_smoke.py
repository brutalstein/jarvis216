"""Explicit opt-in public-page smoke test; no credentials, accounts or shared profiles."""

import asyncio
import os
from uuid import uuid4

from worker import Request, extract

if os.environ.get("JARVIS_LIVE_BROWSER_TEST") != "true":
    raise SystemExit("Set JARVIS_LIVE_BROWSER_TEST=true to run the public example.com smoke test")

result = asyncio.run(
    extract(Request(str(uuid4()), "https://example.com/", "documentation examples", 30000))
)
assert "documentation examples" in result["text"]
print({"liveBrowserUse": True, "source": result["source"], "verified": True})
