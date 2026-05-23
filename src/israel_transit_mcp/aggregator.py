"""Orchestrator between sources and MCP tools.

Tools call into the aggregator with a request shape; the aggregator
fans out to the relevant sources in parallel via `TaskRunner`, merges
the results, applies cross-source heuristics, and returns one clean
typed object the tool returns verbatim to Claude.

Dependency inversion: the aggregator depends on Source protocols, not
concrete classes. Sources can be swapped (e.g., the unit tests will
inject fakes; later commits add Stride/Rail).

Cross-source heuristics applied here:

- **Deduplication** of disruption events by normalized title similarity
  (a closure reported by Ynet + Mako + Walla is one event, not three).
- **Confidence boost** when ≥ 2 distinct outlets report a near-identical
  event — those are the events most worth showing.
- **Recency sort** within each kind so the freshest signal leads.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable

from .config import Config
from .models import DisruptionEvent, Place, Route, TransportMode
from .runner import TaskResult, TaskRunner, successes


@dataclass
class FetchTrace:
    """What ran, what worked, how long it took. Returned alongside every
    aggregated result so Claude can tell the user `(driving from Google
    Routes, disruptions from 4/6 RSS feeds — Walla timed out)`."""
    successes: dict[str, int] = field(default_factory=dict)
    """name → duration_ms for tasks that returned a non-empty result."""
    failures: dict[str, str] = field(default_factory=dict)


@dataclass
class RoutePlan:
    routes: list[Route]
    trace: FetchTrace


@dataclass
class DisruptionSnapshot:
    events: list[DisruptionEvent]
    trace: FetchTrace


_PUNCT_OR_NONLETTER = re.compile(r"[^\w֐-׿]+", re.UNICODE)


def _normalize_title(s: str) -> str:
    """Cheap normalization for cross-source dedup. Lowercase, strip
    punctuation, collapse whitespace. Hebrew characters are preserved."""
    return _PUNCT_OR_NONLETTER.sub(" ", s.lower()).strip()


def _title_signature(s: str) -> tuple[str, ...]:
    """Bag-of-words signature for near-duplicate detection. Two events
    whose top-5 normalized tokens overlap by ≥ 3 are merged."""
    tokens = [t for t in _normalize_title(s).split() if len(t) >= 3]
    return tuple(tokens[:8])


def _signatures_match(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    if not a or not b:
        return False
    sa, sb = set(a), set(b)
    overlap = len(sa & sb)
    return overlap >= max(3, min(len(sa), len(sb)) // 2)


class Aggregator:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._runner = TaskRunner()

    # --- routing -------------------------------------------------------

    async def plan_driving(
        self,
        origin: Place,
        destination: Place,
        departure_time: datetime | None = None,
    ) -> RoutePlan:
        if not self._cfg.driving_available:
            return RoutePlan(
                routes=[],
                trace=FetchTrace(failures={"google_routes": "GOOGLE_MAPS_API_KEY not configured"}),
            )
        from .sources.google_routes import GoogleRoutesSource

        async def _call() -> list[Route]:
            async with GoogleRoutesSource(self._cfg.google_maps_api_key or "") as src:
                return await src.plan(origin, destination, TransportMode.DRIVING, departure_time)

        results = await self._runner.run({"google_routes": _call})
        trace = _trace_from(results)
        routes = next(iter(successes(results).values()), []) or []
        return RoutePlan(routes=routes, trace=trace)

    # --- disruptions ---------------------------------------------------

    async def gather_disruptions(
        self,
        window_hours: int = 6,
        location_filter: str | None = None,
    ) -> DisruptionSnapshot:
        from .sources.rss_news import RssNewsSource

        async def _rss() -> list[DisruptionEvent]:
            async with RssNewsSource() as src:
                return await src.recent(window_hours=window_hours)

        tasks: dict[str, Callable[[], Awaitable[list[DisruptionEvent]]]] = {
            "rss": _rss,
        }
        # IMS weather + transit-side service alerts plug in here in
        # following commits — same shape, same runner.
        results = await self._runner.run(tasks)
        trace = _trace_from(results)

        all_events: list[DisruptionEvent] = []
        for events in successes(results).values():
            all_events.extend(events)

        if location_filter:
            all_events = [
                e for e in all_events
                if _matches_location(e, location_filter)
            ]

        merged = _dedupe_and_boost(all_events)
        merged.sort(
            key=lambda e: (
                e.published_at or datetime.fromtimestamp(0, tz=timezone.utc),
            ),
            reverse=True,
        )
        return DisruptionSnapshot(events=merged, trace=trace)


def _trace_from(results: dict[str, TaskResult]) -> FetchTrace:
    trace = FetchTrace()
    for name, r in results.items():
        if r.ok and r.value:
            trace.successes[name] = r.duration_ms
        elif r.ok and not r.value:
            trace.failures[name] = "empty result"
        else:
            trace.failures[name] = r.error or "unknown error"
    return trace


def _matches_location(event: DisruptionEvent, needle: str) -> bool:
    """Simple substring match against Hebrew location strings — both the
    structured `location_hint` and the free-text title. Good enough until
    we wire real geocoding."""
    needle_norm = _normalize_title(needle)
    if not needle_norm:
        return True
    haystacks = (event.location_hint, event.title, event.description)
    return any(needle_norm in _normalize_title(h) for h in haystacks if h)


def _dedupe_and_boost(events: list[DisruptionEvent]) -> list[DisruptionEvent]:
    """Group near-duplicate events across sources. The merged event keeps
    the freshest publication date and concatenates source attribution so
    the caller can see "reported by Ynet + Mako + Walla".
    """
    buckets: list[tuple[tuple[str, ...], list[DisruptionEvent]]] = []
    for ev in events:
        sig = _title_signature(ev.title)
        placed = False
        for existing_sig, bucket in buckets:
            if _signatures_match(sig, existing_sig):
                bucket.append(ev)
                placed = True
                break
        if not placed:
            buckets.append((sig, [ev]))
    merged: list[DisruptionEvent] = []
    for _sig, bucket in buckets:
        if len(bucket) == 1:
            merged.append(bucket[0])
            continue
        # Most recent wins as the canonical event; sources are concatenated.
        bucket.sort(
            key=lambda e: (e.published_at or datetime.fromtimestamp(0, tz=timezone.utc)),
            reverse=True,
        )
        head = bucket[0]
        sources = sorted({e.source for e in bucket})
        merged.append(
            DisruptionEvent(
                kind=head.kind,
                title=head.title,
                description=head.description,
                source=" + ".join(sources),
                source_url=head.source_url,
                published_at=head.published_at,
                location_hint=head.location_hint or next(
                    (e.location_hint for e in bucket if e.location_hint), ""
                ),
                coords=head.coords,
            )
        )
    return merged
