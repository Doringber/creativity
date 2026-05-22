"""Common types for any input the agent reads.

A `Signal` is the unit of "something I know about the system": a commit,
a Jira ticket, a Confluence page. The `analyze` step consumes signals;
sources produce them. New sources (GitHub, PagerDuty, OpenTelemetry...)
implement the `Source` protocol and the rest of the agent doesn't care.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Protocol


@dataclass
class Signal:
    source: str
    """`git` | `jira` | `confluence` | ..."""

    id: str
    """Stable identifier within the source (sha, issue key, page id)."""

    kind: str
    """`commit` | `ticket` | `doc` | ..."""

    title: str
    body: str
    url: str | None = None
    timestamp: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class Source(Protocol):
    name: str

    def fetch(self, **kwargs: Any) -> Iterable[Signal]: ...
