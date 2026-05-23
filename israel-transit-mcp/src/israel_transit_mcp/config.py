"""Environment-driven config. Same pattern as qa-agent: load .env, expose
typed dataclasses. No secrets reach git."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(Path.cwd() / ".env")


def _default_store_dir() -> Path:
    raw = os.environ.get("ISRAEL_TRANSIT_STORE_DIR")
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".israel-transit-mcp"


@dataclass(frozen=True)
class Config:
    google_maps_api_key: str | None
    store_dir: Path
    anomaly_threshold_minutes: int
    baseline_min_samples: int
    news_feeds: tuple[str, ...]
    """User override; empty tuple means use the built-in default set."""
    news_items_per_feed: int

    @classmethod
    def from_env(cls) -> "Config":
        feeds_raw = os.environ.get("NEWS_FEEDS", "")
        feeds = tuple(f.strip() for f in feeds_raw.split(",") if f.strip())
        return cls(
            google_maps_api_key=os.environ.get("GOOGLE_MAPS_API_KEY"),
            store_dir=_default_store_dir(),
            anomaly_threshold_minutes=int(
                os.environ.get("ANOMALY_THRESHOLD_MINUTES", "5")
            ),
            baseline_min_samples=int(os.environ.get("BASELINE_MIN_SAMPLES", "5")),
            news_feeds=feeds,
            news_items_per_feed=int(os.environ.get("NEWS_ITEMS_PER_FEED", "50")),
        )

    @property
    def driving_available(self) -> bool:
        return bool(self.google_maps_api_key)
