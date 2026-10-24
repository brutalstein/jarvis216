"""Client for Core's conversation endpoint. Failures become None so JARVIS can apologise."""

from dataclasses import dataclass, fields
from typing import Any

import httpx

FALLBACK = {"tr": "Şu an yanıt veremiyorum, efendim.", "en": "I can't answer right now, sir."}


@dataclass(frozen=True)
class Turn:
    # Field names mirror Core's TurnResult JSON.
    id: str
    taskId: str | None
    addressed: bool
    say: str
    lang: str
    display: list[dict[str, Any]]
    provider: str | None
    latencyMs: int


class CoreClient:
    def __init__(
        self, base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        # A turn may repair once (2 x 30 s), then wait 5 s for a quick plan outcome.
        self.http = httpx.AsyncClient(
            base_url=base_url,
            headers={"authorization": f"Bearer {token}"},
            timeout=70.0,
            transport=transport,
        )

    async def turn(self, utterance: str, follow_up: bool, uncertain: bool = False) -> Turn | None:
        body: dict[str, Any] = {"utterance": utterance, "followUp": follow_up}
        if uncertain:
            # Speech recognition doubted these words; Core confirms what it understood.
            body["uncertain"] = True
        try:
            response = await self.http.post("/v1/conversation/turns", json=body)
        except httpx.HTTPError:
            return None
        if response.status_code != 200:
            return None
        # A malformed body must become an apology, not a crashed reply task.
        try:
            data = response.json()
            return Turn(**{f.name: data[f.name] for f in fields(Turn)})
        except (ValueError, KeyError, TypeError):
            return None
