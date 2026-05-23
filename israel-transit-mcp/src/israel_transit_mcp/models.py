"""Shared pydantic models — the wire shapes between sources, tools, and the MCP.

Models are intentionally small. Driving and transit results both flatten to
`Route` so the MCP tool surface is mode-agnostic from Claude's perspective.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class TransportMode(str, Enum):
    DRIVING = "driving"
    TRANSIT = "transit"
    WALKING = "walking"


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Place(BaseModel):
    """A user-facing place. Either coordinates or a free-text address that
    the source resolves; both forms round-trip back as a normalized
    `display_name` so logs are debuggable."""
    display_name: str
    coords: LatLng | None = None


class RouteLeg(BaseModel):
    """One segment of a route — a driving stretch, a bus ride, a walking
    transfer. Time fields are seconds for arithmetic ease."""
    mode: TransportMode
    summary: str
    """e.g. `Hwy 4 north`, `Bus 480 Eged`, `Walk 5 min to stop`."""
    distance_m: int
    duration_s: int
    duration_in_traffic_s: int | None = None
    """Only set for driving legs; matches Google Routes' durationInTraffic."""
    departure_time: datetime | None = None
    arrival_time: datetime | None = None
    polyline: str | None = None
    """Encoded polyline for the leg (Google's algorithm). Optional, used
    only when a UI wants to draw it."""


class Route(BaseModel):
    """One concrete option from A to B. Sources return one or more."""
    mode: TransportMode
    origin: Place
    destination: Place
    legs: list[RouteLeg]
    total_duration_s: int
    total_distance_m: int
    departure_time: datetime | None = None
    arrival_time: datetime | None = None
    summary: str
    """Single-line human description: `via Hwy 4 — 27 min` /
    `Bus 480 + Rail to Savidor — 1 h 5 min`."""
    warnings: list[str] = Field(default_factory=list)
    source: str
    """Which source produced this route (`google_routes`, `mot_gtfs`, ...).
    Kept so the MCP can tell Claude exactly where each number came from."""


class DisruptionKind(str, Enum):
    CLOSURE = "closure"
    PROTEST = "protest"
    ACCIDENT = "accident"
    JAM = "jam"
    WEATHER = "weather"
    ROADWORK = "roadwork"
    SERVICE_DISRUPTION = "service_disruption"
    """Bus/rail-side disruption: cancelled trip, platform change, strike."""
    OTHER = "other"


class DisruptionEvent(BaseModel):
    """One observed disturbance that could affect a route.

    Sources of varying confidence produce these: RSS news (high confidence
    that something was reported, medium confidence on geography), weather
    (high on both axes), GTFS service alerts (highest confidence).
    """
    kind: DisruptionKind
    title: str
    description: str = ""
    source: str
    """Which source surfaced this: `rss:kan`, `rss:ynet`, `ims:weather`,
    `mot:service_alert`, etc."""
    source_url: str | None = None
    published_at: datetime | None = None
    location_hint: str = ""
    """Free-text Hebrew place / street name the source named, e.g.
    `איילון דרום`, `כביש 4`, `מחלף קסם`. The MCP does fuzzy match against
    the user's route's leg summaries; geocoding is out of scope for v1."""
    coords: LatLng | None = None
    """Filled when the source actually gives coordinates (rare for RSS,
    common for IMS regional warnings)."""


class AnomalyVerdict(BaseModel):
    """Output of comparing today's ETA to the personal baseline."""
    is_anomalous: bool
    today_eta_s: int
    baseline_p50_s: int
    baseline_p75_s: int
    delta_s: int
    """today_eta_s - baseline_p50_s."""
    sample_size: int
    """How many past observations the baseline is built from. Below
    BASELINE_MIN_SAMPLES we never declare anomaly even if delta is large."""
    explanation: str
    """One sentence explaining the verdict in plain text."""


class SavedRoute(BaseModel):
    """A commute the user has named: `home->work`, `evening rail`."""
    id: int | None = None
    name: str
    origin: Place
    destination: Place
    mode: TransportMode
    default_departure_local: str | None = None
    """e.g. `08:00` — used by morning_briefing as the default check time."""
    notes: str = ""


class ETAObservation(BaseModel):
    """One historical (route, time, observed ETA) row. The baseline is a
    rollup of these."""
    saved_route_id: int
    observed_at: datetime
    eta_s: int
    weekday: int
    """0 = Monday … 6 = Sunday. We bucket by weekday so Friday's empty
    roads don't pollute Sunday's commute baseline."""
    hour: int
    """0–23, observed_at's local hour."""


Severity = Literal["low", "med", "high"]


class CommuteBriefing(BaseModel):
    """The composed output of the `morning_briefing` tool."""
    saved_route_name: str
    route: Route
    anomaly: AnomalyVerdict
    disruptions: list[DisruptionEvent]
    suggested_action: str
    """`leave now`, `leave 15 min earlier`, `consider transit`, `route looks normal`."""
    severity: Severity
