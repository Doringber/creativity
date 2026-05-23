"""MCP tool: `list_routes` — show every saved commute."""

from __future__ import annotations

from ..app import get_store, mcp


@mcp.tool()
def list_routes() -> dict:
    """List every named commute the user has saved.

    Useful as the entry point for `morning_briefing` and for reminding
    the user what's in their RAG store.
    """
    store = get_store()
    routes = store.list_routes()
    return {
        "ok": True,
        "count": len(routes),
        "routes": [
            {
                "id": r.id,
                "name": r.name,
                "origin": r.origin.display_name,
                "destination": r.destination.display_name,
                "mode": r.mode.value,
                "default_departure_local": r.default_departure_local,
                "notes": r.notes,
            }
            for r in routes
        ],
    }
