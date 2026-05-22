"""Jira as a Signal source.

Recent tickets become signals of intent: what we said we'd change, what
broke, what was reported. The agent later joins these against git commits
to identify which code paths a ticket actually touches.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from ..config import AtlassianConfig, JiraScope
from .atlassian import AtlassianClient
from .base import Signal


_DEFAULT_FIELDS = (
    "summary",
    "description",
    "status",
    "issuetype",
    "priority",
    "labels",
    "components",
    "assignee",
    "created",
    "updated",
)


def _adf_to_text(node: Any) -> str:
    """Flatten Atlassian Document Format to plain text. Good enough for
    feeding into an LLM — we don't need round-trip fidelity."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""
    parts: list[str] = []
    if node.get("type") == "text":
        parts.append(str(node.get("text", "")))
    for child in node.get("content", []) or []:
        parts.append(_adf_to_text(child))
    if node.get("type") in {"paragraph", "heading", "bulletList", "orderedList"}:
        parts.append("\n")
    return "".join(parts)


class JiraSource:
    name = "jira"

    def __init__(self, client: AtlassianClient, scope: JiraScope) -> None:
        self._client = client
        self._scope = scope

    def _jql(self, extra: str | None) -> str:
        parts: list[str] = []
        if self._scope.projects:
            quoted = ", ".join(self._scope.projects)
            parts.append(f"project in ({quoted})")
        if self._scope.jql_window:
            parts.append(self._scope.jql_window)
        if extra:
            parts.append(f"({extra})")
        return " AND ".join(parts) + " ORDER BY updated DESC"

    def fetch(
        self,
        jql_extra: str | None = None,
        limit: int = 50,
        fields: Iterable[str] = _DEFAULT_FIELDS,
    ) -> Iterable[Signal]:
        params: dict[str, Any] = {
            "jql": self._jql(jql_extra),
            "fields": ",".join(fields),
            "maxResults": min(limit, 100),
        }
        resp = self._client.get("/rest/api/3/search", params=params)
        for issue in resp.json().get("issues", []):
            yield self._to_signal(issue)

    def get(self, key: str) -> Signal:
        resp = self._client.get(
            f"/rest/api/3/issue/{key}",
            params={"fields": ",".join(_DEFAULT_FIELDS)},
        )
        return self._to_signal(resp.json())

    def _to_signal(self, issue: dict[str, Any]) -> Signal:
        f = issue.get("fields", {})
        body = _adf_to_text(f.get("description"))
        ts = f.get("updated") or f.get("created")
        try:
            timestamp = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
        except (TypeError, ValueError):
            timestamp = None
        return Signal(
            source=self.name,
            id=issue.get("key", ""),
            kind="ticket",
            title=f.get("summary", ""),
            body=body,
            url=f"https://{self._client.site}/browse/{issue.get('key', '')}",
            timestamp=timestamp,
            metadata={
                "status": (f.get("status") or {}).get("name"),
                "issuetype": (f.get("issuetype") or {}).get("name"),
                "priority": (f.get("priority") or {}).get("name"),
                "labels": f.get("labels") or [],
                "components": [c.get("name") for c in f.get("components") or []],
                "assignee": (f.get("assignee") or {}).get("displayName"),
                "project": (f.get("project") or {}).get("key"),
            },
        )
