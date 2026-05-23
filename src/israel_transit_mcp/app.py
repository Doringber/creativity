"""Process-wide singletons.

`mcp` and `cfg` live here so every tool module can import them without
creating a cycle through `server.py`. The store is lazily opened on first
use and closed in `lifespan` (handled by FastMCP's shutdown hooks).
"""

from __future__ import annotations

from functools import lru_cache

from fastmcp import FastMCP

from .config import Config
from .store import Store, open_store


mcp = FastMCP("israel-transit")


@lru_cache(maxsize=1)
def get_config() -> Config:
    return Config.from_env()


@lru_cache(maxsize=1)
def get_store() -> Store:
    cfg = get_config()
    return open_store(cfg.store_dir / "store.db")
