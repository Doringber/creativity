"""Israeli news RSS — the qualitative "what's wrong" signal.

Six confirmed feeds (Ynet flash + main, N12/Mako בארץ + צבא, Walla,
Times of Israel road-closures topic). Items are fetched in parallel,
parsed with the stdlib XML parser, classified by Hebrew keyword tiers,
and emitted as `DisruptionEvent`s.

Cross-source confidence boost lives in the aggregator, not here — this
source's single responsibility is "give me what each feed currently
publishes that looks traffic-relevant".
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable

import httpx

from ..keywords import classify
from ..models import DisruptionEvent, DisruptionKind


@dataclass(frozen=True)
class Feed:
    key: str
    """Stable id for source attribution, e.g. `rss:ynet_flash`."""
    name: str
    """Human label, e.g. `Ynet מבזקים`."""
    url: str


# Confirmed feeds from May 2026 research. URLs reconciled from the
# danielrosehill/Israel-News-RSS-Feeds OPML + each outlet's own RSS
# index page. Wire-tested on first run from a real network — the
# research sandbox blocked .co.il egress.
DEFAULT_FEEDS: tuple[Feed, ...] = (
    Feed("ynet_flash", "Ynet מבזקים", "https://www.ynet.co.il/Integration/StoryRss1854.xml"),
    Feed("ynet_main", "Ynet חדשות", "https://www.ynet.co.il/Integration/StoryRss2.xml"),
    Feed("mako_israel", "N12/Mako בארץ", "https://rcs.mako.co.il/rss/news-israel.xml"),
    Feed("mako_military", "N12/Mako צבא", "https://rcs.mako.co.il/rss/news-military.xml"),
    Feed("walla", "Walla", "https://rss.walla.co.il/feed/1"),
    Feed(
        "toi_road_closures",
        "Times of Israel — road-closures",
        "https://www.timesofisrael.com/topic/road-closures/feed/",
    ),
)


_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}

_TAG_STRIP = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _strip_html(s: str | None) -> str:
    if not s:
        return ""
    return _WS.sub(" ", _TAG_STRIP.sub(" ", s)).strip()


def _parse_pubdate(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class RssItem:
    feed_key: str
    feed_name: str
    title: str
    link: str
    description: str
    pub_date: datetime | None
    raw_text: str = field(default="")
    """title + description concatenated, used for the keyword classifier."""


class RssNewsSource:
    name = "rss_news"

    def __init__(
        self,
        feeds: Iterable[Feed] = DEFAULT_FEEDS,
        client: httpx.AsyncClient | None = None,
        per_feed_limit: int = 50,
    ) -> None:
        self._feeds = tuple(feeds)
        self._client = client
        self._owns_client = client is None
        self._per_feed_limit = per_feed_limit

    async def __aenter__(self) -> "RssNewsSource":
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=8.0,
                headers={
                    # Several Israeli outlets 403 on a default httpx UA.
                    "User-Agent": "israel-transit-mcp/0.1 (+https://github.com)",
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
                follow_redirects=True,
            )
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def feeds(self) -> tuple[Feed, ...]:
        return self._feeds

    async def fetch_feed(self, feed: Feed) -> list[RssItem]:
        client = await self._ensure_client()
        resp = await client.get(feed.url)
        resp.raise_for_status()
        return self._parse(feed, resp.content)

    async def recent(
        self,
        window_hours: int = 6,
        min_confidence: float = 0.3,
    ) -> list[DisruptionEvent]:
        """Default fetch path — gather every configured feed in parallel
        and return only items that pass the Hebrew classifier."""
        from ..runner import TaskRunner, successes

        runner = TaskRunner(max_concurrency=len(self._feeds) or 1, task_timeout_s=5.0)
        tasks = {f.key: (lambda f=f: self.fetch_feed(f)) for f in self._feeds}
        results = await runner.run(tasks)
        items_by_feed = successes(results)
        all_items: list[RssItem] = []
        for items in items_by_feed.values():
            all_items.extend(items)
        return self._classify_and_filter(all_items, window_hours, min_confidence)

    # --- internals ----------------------------------------------------

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=8.0,
                headers={
                    "User-Agent": "israel-transit-mcp/0.1 (+https://github.com)",
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
                follow_redirects=True,
            )
        return self._client

    def _parse(self, feed: Feed, content: bytes) -> list[RssItem]:
        try:
            root = ET.fromstring(content)
        except ET.ParseError:
            return []
        # RSS 2.0: <rss><channel><item>...
        # Atom:    <feed><entry>...
        items: list[RssItem] = []
        for item in root.iter("item"):
            items.append(self._parse_rss2(feed, item))
        if not items:
            for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
                items.append(self._parse_atom(feed, entry))
        return items[: self._per_feed_limit]

    def _parse_rss2(self, feed: Feed, item: ET.Element) -> RssItem:
        title = _strip_html(_first_text(item, "title"))
        link = _first_text(item, "link")
        desc = _strip_html(
            _first_text(item, "description")
            or _first_text(item, "{http://purl.org/rss/1.0/modules/content/}encoded")
        )
        pub = _parse_pubdate(
            _first_text(item, "pubDate")
            or _first_text(item, "{http://purl.org/dc/elements/1.1/}date")
        )
        text = f"{title}\n{desc}".strip()
        return RssItem(
            feed_key=feed.key,
            feed_name=feed.name,
            title=title,
            link=link,
            description=desc,
            pub_date=pub,
            raw_text=text,
        )

    def _parse_atom(self, feed: Feed, entry: ET.Element) -> RssItem:
        title = _strip_html(_first_text(entry, "{http://www.w3.org/2005/Atom}title"))
        link_el = entry.find("{http://www.w3.org/2005/Atom}link")
        link = link_el.get("href", "") if link_el is not None else ""
        desc = _strip_html(
            _first_text(entry, "{http://www.w3.org/2005/Atom}summary")
            or _first_text(entry, "{http://www.w3.org/2005/Atom}content")
        )
        pub = _parse_pubdate(
            _first_text(entry, "{http://www.w3.org/2005/Atom}published")
            or _first_text(entry, "{http://www.w3.org/2005/Atom}updated")
        )
        text = f"{title}\n{desc}".strip()
        return RssItem(
            feed_key=feed.key,
            feed_name=feed.name,
            title=title,
            link=link,
            description=desc,
            pub_date=pub,
            raw_text=text,
        )

    def _classify_and_filter(
        self,
        items: list[RssItem],
        window_hours: int,
        min_confidence: float,
    ) -> list[DisruptionEvent]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
        out: list[DisruptionEvent] = []
        for item in items:
            if item.pub_date and item.pub_date < cutoff:
                continue
            cls = classify(item.raw_text)
            if not cls.matched:
                continue
            if cls.confidence < min_confidence:
                continue
            # Location hint = the highest-tier road/area token, when present.
            loc = cls.tier2_hits[0] if cls.tier2_hits else ""
            out.append(
                DisruptionEvent(
                    kind=cls.kind,
                    title=item.title,
                    description=item.description[:500],
                    source=f"rss:{item.feed_key}",
                    source_url=item.link or None,
                    published_at=item.pub_date,
                    location_hint=loc,
                )
            )
        return out


def _first_text(el: ET.Element, tag: str) -> str:
    found = el.find(tag)
    if found is None:
        return ""
    return (found.text or "").strip()
