"""Source protocols. Each kind has its own shape — there's no useful
single `Source` abstraction across both `plan a driving route` and `give
me weather warnings`. We just have one Protocol per capability."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from ..models import DisruptionEvent, Place, Route, TransportMode


class RoutingSource(Protocol):
    """Plans a Route from A to B. Implementations exist per mode."""

    name: str
    supports_modes: tuple[TransportMode, ...]

    def plan(
        self,
        origin: Place,
        destination: Place,
        mode: TransportMode,
        departure_time: datetime | None = None,
    ) -> list[Route]: ...


class DisruptionSource(Protocol):
    """Returns recently observed disruption events. The MCP's tools
    decide which ones intersect a user's route geographically."""

    name: str

    def recent(self, window_hours: int = 6) -> list[DisruptionEvent]: ...
