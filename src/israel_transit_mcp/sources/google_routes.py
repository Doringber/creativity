"""Google Maps Routes API v1 — driving ETA with live traffic.

Picked because Google owns Waze; their traffic-aware ETAs in Israel are
visibly better than TomTom/HERE/Mapbox. Free tier: 5,000 traffic-aware
calls/month under the post-March-2025 SKU model, plenty for one user's
commute-monitoring MCP.

Single responsibility: turn `(origin, destination, departure_time)` into
a list of `Route` objects. Knows nothing about MCP, about the store, or
about other sources.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from ..models import LatLng, Place, Route, RouteLeg, TransportMode


_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"

# X-Goog-FieldMask cuts response cost: we ask only for what we render.
# See https://developers.google.com/maps/documentation/routes/reference/rpc/google.maps.routing.v2
_FIELD_MASK = ",".join([
    "routes.duration",
    "routes.staticDuration",
    "routes.distanceMeters",
    "routes.polyline.encodedPolyline",
    "routes.description",
    "routes.warnings",
    "routes.legs.duration",
    "routes.legs.staticDuration",
    "routes.legs.distanceMeters",
    "routes.legs.startLocation",
    "routes.legs.endLocation",
    "routes.legs.steps.navigationInstruction.instructions",
    "routes.legs.steps.distanceMeters",
])


class GoogleRoutesSource:
    name = "google_routes"
    supports_modes = (TransportMode.DRIVING,)

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        if not api_key:
            raise ValueError("GOOGLE_MAPS_API_KEY is required for GoogleRoutesSource")
        self._api_key = api_key
        self._client = client
        self._owns_client = client is None

    async def __aenter__(self) -> "GoogleRoutesSource":
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def plan(
        self,
        origin: Place,
        destination: Place,
        mode: TransportMode = TransportMode.DRIVING,
        departure_time: datetime | None = None,
    ) -> list[Route]:
        if mode is not TransportMode.DRIVING:
            return []
        body: dict[str, Any] = {
            "origin": _waypoint(origin),
            "destination": _waypoint(destination),
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
            "computeAlternativeRoutes": True,
            "languageCode": "he",
            "regionCode": "IL",
            "units": "METRIC",
        }
        if departure_time is not None:
            if departure_time.tzinfo is None:
                departure_time = departure_time.replace(tzinfo=timezone.utc)
            body["departureTime"] = departure_time.isoformat().replace("+00:00", "Z")

        client = await self._ensure_client()
        resp = await client.post(
            _ENDPOINT,
            json=body,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": self._api_key,
                "X-Goog-FieldMask": _FIELD_MASK,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return [_parse_route(r, origin, destination, departure_time) for r in data.get("routes", [])]

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client


def _waypoint(p: Place) -> dict[str, Any]:
    if p.coords is not None:
        return {
            "location": {
                "latLng": {"latitude": p.coords.lat, "longitude": p.coords.lng}
            }
        }
    return {"address": p.display_name}


def _seconds(raw: str | None) -> int:
    """Google's `duration` fields look like `"1234s"`."""
    if not raw:
        return 0
    if raw.endswith("s"):
        try:
            return int(float(raw[:-1]))
        except ValueError:
            return 0
    return 0


def _parse_route(
    raw: dict[str, Any],
    origin: Place,
    destination: Place,
    departure_time: datetime | None,
) -> Route:
    duration_traffic = _seconds(raw.get("duration"))
    duration_static = _seconds(raw.get("staticDuration"))
    distance_m = int(raw.get("distanceMeters") or 0)
    legs_in = raw.get("legs") or []
    legs_out: list[RouteLeg] = []
    for leg in legs_in:
        leg_traffic = _seconds(leg.get("duration"))
        leg_static = _seconds(leg.get("staticDuration"))
        leg_distance = int(leg.get("distanceMeters") or 0)
        # Pick the most informative step name as a leg summary; fall back
        # to a generic label.
        summary = "Drive"
        steps = leg.get("steps") or []
        for step in steps:
            ni = (step.get("navigationInstruction") or {}).get("instructions")
            if ni:
                summary = str(ni)
                break
        legs_out.append(
            RouteLeg(
                mode=TransportMode.DRIVING,
                summary=summary,
                distance_m=leg_distance,
                duration_s=leg_static or leg_traffic,
                duration_in_traffic_s=leg_traffic if leg_static else None,
                departure_time=departure_time,
                arrival_time=None,
            )
        )
    description = raw.get("description") or ""
    minutes = max(1, duration_traffic // 60)
    summary = description or f"דרך — {minutes} דק׳ בתנועה"
    warnings_raw = raw.get("warnings") or []
    return Route(
        mode=TransportMode.DRIVING,
        origin=origin,
        destination=destination,
        legs=legs_out,
        total_duration_s=duration_traffic or duration_static,
        total_distance_m=distance_m,
        departure_time=departure_time,
        arrival_time=None,
        summary=summary,
        warnings=[str(w) for w in warnings_raw],
        source="google_routes",
    )
