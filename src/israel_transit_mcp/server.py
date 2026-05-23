"""FastMCP entry point.

Owns nothing — defers to `app.py` for the MCP singleton + config, and to
the `tools` package for tool registration. Side-effecting import of
`tools` triggers `@mcp.tool()` registration of every tool module.
"""

from __future__ import annotations

import sys

from . import tools  # noqa: F401  (side-effecting registration)
from . import __version__
from .app import get_config, get_store, mcp


@mcp.tool()
def health() -> dict:
    """Return server status, version, and which capabilities are wired."""
    cfg = get_config()
    store = get_store()
    saved = len(store.list_routes())
    return {
        "name": "israel-transit-mcp",
        "version": __version__,
        "store_dir": str(cfg.store_dir),
        "saved_routes": saved,
        "capabilities": {
            "driving": cfg.driving_available,
            "transit": False,
            "news_rss": True,
            "weather": False,
        },
        "tools": sorted(_registered_tool_names()),
    }


def _registered_tool_names() -> list[str]:
    """Best-effort introspection. FastMCP keeps tools internally; the
    exact attribute name has shifted between releases, so we try several."""
    for attr in ("_tools", "tools", "_tool_registry"):
        registry = getattr(mcp, attr, None)
        if isinstance(registry, dict):
            return list(registry.keys())
        if isinstance(registry, list):
            names = []
            for t in registry:
                n = getattr(t, "name", None) or getattr(t, "__name__", None)
                if n:
                    names.append(n)
            return names
    return []


def main() -> None:
    try:
        mcp.run()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
