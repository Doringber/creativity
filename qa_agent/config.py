"""Environment-driven configuration.

All knobs live in `QA_AGENT_*` env vars. A local `.env` file is loaded if
present (and is in `.gitignore` so credentials never reach the repo).
"""

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


@dataclass(frozen=True)
class AtlassianConfig:
    site: str | None
    """e.g. `pangobugs.atlassian.net` — no scheme."""

    email: str | None
    api_token: str | None
    cloud_id: str | None
    """Optional. If unset, the agent will resolve it from `site` at runtime."""

    @classmethod
    def from_env(cls) -> "AtlassianConfig":
        return cls(
            site=os.environ.get("QA_AGENT_ATLASSIAN_SITE"),
            email=os.environ.get("QA_AGENT_ATLASSIAN_EMAIL"),
            api_token=os.environ.get("QA_AGENT_ATLASSIAN_API_TOKEN"),
            cloud_id=os.environ.get("QA_AGENT_ATLASSIAN_CLOUD_ID"),
        )

    @property
    def configured(self) -> bool:
        return bool(self.site and self.email and self.api_token)


@dataclass(frozen=True)
class JiraScope:
    """Which Jira projects + JQL window the agent considers."""

    projects: tuple[str, ...]
    jql_window: str

    @classmethod
    def from_env(cls) -> "JiraScope":
        projects_raw = os.environ.get("QA_AGENT_JIRA_PROJECTS", "")
        projects = tuple(p.strip() for p in projects_raw.split(",") if p.strip())
        window = os.environ.get("QA_AGENT_JIRA_WINDOW", "updated >= -30d")
        return cls(projects=projects, jql_window=window)


@dataclass(frozen=True)
class ConfluenceScope:
    """Which Confluence spaces the agent indexes."""

    space_keys: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "ConfluenceScope":
        keys_raw = os.environ.get("QA_AGENT_CONFLUENCE_SPACES", "")
        keys = tuple(k.strip() for k in keys_raw.split(",") if k.strip())
        return cls(space_keys=keys)
