"""MCP tool: `save_route` — remember a commute by name.

Persists to local SQLite so future tools (`morning_briefing`,
`when_should_i_leave`) can look up the user's baseline by `home->work`
without re-asking origin/destination every time.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from ..app import get_store, mcp
from ..models import LatLng, Place, SavedRoute, TransportMode


@mcp.tool()
def save_route(
    name: Annotated[str, Field(description="Short name to call this commute later. Example: 'home->work'.")],
    origin: Annotated[str, Field(description="Free-text origin address.")],
    destination: Annotated[str, Field(description="Free-text destination address.")],
    mode: Annotated[str, Field(description="'driving' or 'transit'.")] = "driving",
    default_departure_local: Annotated[str | None, Field(description="Optional default time in HH:MM local. Used by morning_briefing.")] = None,
    notes: Annotated[str, Field(description="Free-text notes the user wants attached.")] = "",
    origin_lat: Annotated[float | None, Field()] = None,
    origin_lng: Annotated[float | None, Field()] = None,
    destination_lat: Annotated[float | None, Field()] = None,
    destination_lng: Annotated[float | None, Field()] = None,
) -> dict:
    """Save a named commute. Re-saving with the same `name` updates it.

    The persisted route is the anchor for personal-baseline anomaly
    detection — every ETA observation gets bucketed under one of these
    saved routes.
    """
    try:
        mode_enum = TransportMode(mode.lower())
    except ValueError:
        return {"ok": False, "error": f"unknown mode '{mode}'"}
    route = SavedRoute(
        name=name,
        origin=Place(
            display_name=origin,
            coords=LatLng(lat=origin_lat, lng=origin_lng) if origin_lat is not None and origin_lng is not None else None,
        ),
        destination=Place(
            display_name=destination,
            coords=LatLng(lat=destination_lat, lng=destination_lng)
            if destination_lat is not None and destination_lng is not None
            else None,
        ),
        mode=mode_enum,
        default_departure_local=default_departure_local,
        notes=notes,
    )
    store = get_store()
    route_id = store.save_route(route)
    return {"ok": True, "id": route_id, "name": name}
