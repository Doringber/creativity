"""MCP tool: `delete_route`."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from ..app import get_store, mcp


@mcp.tool()
def delete_route(
    name: Annotated[str, Field(description="The route's saved name. Look it up with list_routes if unsure.")],
) -> dict:
    """Delete a saved commute and every ETA observation tied to it
    (cascade via foreign key)."""
    store = get_store()
    ok = store.delete_route(name)
    return {"ok": ok, "deleted": ok, "name": name}
