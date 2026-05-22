"""Git log as a Signal source.

Every recent commit becomes a signal carrying the diff metadata that the
analyze step needs: which files changed, which boundary modules they
touch. The agent joins this with Jira tickets (via key references like
`PNG-1234` in the commit message) to know which change came from which
intent.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from git import Repo  # gitpython

from .base import Signal


_JIRA_KEY = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")


class GitSource:
    name = "git"

    def __init__(self, repo_path: Path) -> None:
        self._repo = Repo(repo_path)
        self._repo_path = Path(repo_path).resolve()

    def fetch(
        self,
        since: str = "2 weeks ago",
        max_count: int = 200,
        path_prefix: str | None = None,
    ) -> Iterable[Signal]:
        kwargs: dict[str, object] = {"since": since, "max_count": max_count}
        if path_prefix:
            kwargs["paths"] = [path_prefix]
        for commit in self._repo.iter_commits(**kwargs):
            yield self._to_signal(commit)

    def _to_signal(self, commit) -> Signal:  # type: ignore[no-untyped-def]
        message = commit.message if isinstance(commit.message, str) else commit.message.decode("utf-8", "replace")
        title, _, body = message.partition("\n")
        changed = sorted(commit.stats.files.keys())
        tickets = sorted(set(_JIRA_KEY.findall(message)))
        return Signal(
            source=self.name,
            id=commit.hexsha,
            kind="commit",
            title=title.strip(),
            body=body.strip(),
            url=None,
            timestamp=datetime.fromtimestamp(commit.committed_date, tz=timezone.utc),
            metadata={
                "author": str(commit.author),
                "files": changed,
                "ticket_refs": tickets,
                "short": commit.hexsha[:8],
            },
        )
