"""FastMCP server entry point.

This commit only registers the `health` tool — enough to verify the MCP
handshake with Claude. Real tools (`plan_route`, `morning_briefing`, ...)
land in later commits as their underlying sources come online.
"""

from __future__ import annotations

import sys

from fastmcp import FastMCP

from . import __version__
from .config import Config
from .store import open_store


mcp = FastMCP("israel-transit")


@mcp.tool()
def health() -> dict:
    """Return server status, version, and which capabilities are wired.

    Use this first when connecting from Claude to confirm the MCP is up
    and to see which features (driving / transit / weather) are available
    given your current configuration.
    """
    cfg = Config.from_env()
    store = open_store(cfg.store_dir / "store.db")
    try:
        saved_count = len(store.list_routes())
    finally:
        store.close()
    return {
        "name": "israel-transit-mcp",
        "version": __version__,
        "store_dir": str(cfg.store_dir),
        "saved_routes": saved_count,
        "capabilities": {
            "driving": cfg.driving_available,
            "transit": False,  # wired in a later commit
            "news_rss": False,
            "weather": False,
        },
        "configured": {
            "google_maps_api_key": bool(cfg.google_maps_api_key),
        },
    }


def main() -> None:
    """Entry point declared in pyproject.toml."""
    try:
        mcp.run()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
