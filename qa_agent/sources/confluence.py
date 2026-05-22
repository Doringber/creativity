"""Confluence as a Signal source.

Confluence pages are how-it's-supposed-to-work: runbooks, ADRs, service
contracts, test strategies. Where Jira gives intent-of-change, Confluence
gives intent-of-system. Both are needed for the agent to triage a failure
as `test-bug | code-bug | env-bug`.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterable

from ..config import AtlassianConfig, ConfluenceScope
from .atlassian import AtlassianClient
from .base import Signal


_HTML_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"\s+")


def _strip_html(s: str | None) -> str:
    if not s:
        return ""
    return _WHITESPACE.sub(" ", _HTML_TAG.sub(" ", s)).strip()


class ConfluenceSource:
    name = "confluence"

    def __init__(self, client: AtlassianClient, scope: ConfluenceScope) -> None:
        self._client = client
        self._scope = scope
        self._space_id_cache: dict[str, str] = {}

    def _resolve_space_id(self, key: str) -> str | None:
        if key in self._space_id_cache:
            return self._space_id_cache[key]
        resp = self._client.get("/wiki/api/v2/spaces", params={"keys": key, "limit": 1})
        results = resp.json().get("results", [])
        if not results:
            return None
        space_id = str(results[0]["id"])
        self._space_id_cache[key] = space_id
        return space_id

    def fetch(
        self,
        limit_per_space: int = 25,
        with_body: bool = True,
    ) -> Iterable[Signal]:
        for key in self._scope.space_keys:
            space_id = self._resolve_space_id(key)
            if space_id is None:
                continue
            params: dict[str, Any] = {
                "limit": min(limit_per_space, 100),
                "sort": "-modified-date",
                "status": "current",
            }
            if with_body:
                params["body-format"] = "storage"
            resp = self._client.get(
                f"/wiki/api/v2/spaces/{space_id}/pages",
                params=params,
            )
            for page in resp.json().get("results", []):
                yield self._to_signal(page, space_key=key)

    def get(self, page_id: str) -> Signal:
        resp = self._client.get(
            f"/wiki/api/v2/pages/{page_id}",
            params={"body-format": "storage"},
        )
        return self._to_signal(resp.json(), space_key=None)

    def _to_signal(self, page: dict[str, Any], space_key: str | None) -> Signal:
        body_obj = (page.get("body") or {}).get("storage") or {}
        body = _strip_html(body_obj.get("value"))
        ts = page.get("version", {}).get("createdAt") or page.get("createdAt")
        try:
            timestamp = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
        except (TypeError, ValueError):
            timestamp = None
        page_id = str(page.get("id", ""))
        return Signal(
            source=self.name,
            id=page_id,
            kind="doc",
            title=page.get("title", ""),
            body=body,
            url=f"https://{self._client.site}/wiki/spaces/{space_key}/pages/{page_id}"
            if space_key
            else None,
            timestamp=timestamp,
            metadata={
                "space_key": space_key,
                "space_id": page.get("spaceId"),
                "status": page.get("status"),
            },
        )
