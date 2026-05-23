"""MCP tool: `check_disruptions` — what's wrong on Israeli roads right now.

Fans out to every configured RSS feed in parallel, classifies items via
the Hebrew tier-1/2/3 keyword filter, deduplicates near-identical events
across outlets (a closure on Ayalon reported by Ynet + Mako + Walla
becomes one event with three sources), and returns the cleaned list.

Trace metadata names which feeds responded and which timed out, so
Claude can be honest about coverage in its answer.

Optional `location_filter` substring-matches Hebrew road/area names
("איילון", "כביש 4", "תל אביב") against the event's title and location
hint — useful when Claude already knows the user's commute corridor.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from ..aggregator import Aggregator
from ..app import get_config, mcp


@mcp.tool()
async def check_disruptions(
    window_hours: Annotated[int, Field(ge=1, le=24, description="Look back this many hours when scanning the RSS feeds.")] = 6,
    location_filter: Annotated[str | None, Field(description="Optional Hebrew/English substring to filter events by area or road name. Example: 'איילון' or 'כביש 4'.")] = None,
) -> dict:
    """Return road-disruption events from Israeli news RSS feeds.

    Six feeds (Ynet flash + main, N12/Mako בארץ + צבא, Walla, Times of
    Israel road-closures) are fetched in parallel; items are classified
    by a Hebrew traffic-keyword regex (tier-1 fires by itself, tier-3
    requires a tier-1 co-occurrence to suppress noise), then merged
    across outlets so multi-source reports surface as one event with
    high confidence.

    Use this together with `plan_route` to explain *why* a route's ETA
    is elevated today.
    """
    cfg = get_config()
    agg = Aggregator(cfg)
    snap = await agg.gather_disruptions(
        window_hours=window_hours,
        location_filter=location_filter,
    )
    return {
        "ok": True,
        "count": len(snap.events),
        "events": [_event_to_json(e) for e in snap.events[:30]],
        "trace": {"successes": snap.trace.successes, "failures": snap.trace.failures},
    }


def _event_to_json(e) -> dict:
    return {
        "kind": e.kind.value,
        "title": e.title,
        "description": e.description,
        "source": e.source,
        "source_url": e.source_url,
        "published_at": e.published_at.isoformat() if e.published_at else None,
        "location_hint": e.location_hint,
    }
