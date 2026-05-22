"""Shared Atlassian REST plumbing.

Both Jira and Confluence ride on the same auth (email + API token, basic
auth) against the tenant URL. Cloud ID is needed for the cross-product
REST API gateway; if the user supplied a site host we resolve the cloud
ID on first use via `/_edge/tenant_info`.
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from ..config import AtlassianConfig


class AtlassianClient:
    def __init__(self, cfg: AtlassianConfig, timeout: float = 30.0) -> None:
        if not cfg.configured:
            raise RuntimeError(
                "Atlassian credentials missing. Set QA_AGENT_ATLASSIAN_SITE, "
                "QA_AGENT_ATLASSIAN_EMAIL, QA_AGENT_ATLASSIAN_API_TOKEN."
            )
        self._cfg = cfg
        self._cloud_id = cfg.cloud_id
        token = base64.b64encode(
            f"{cfg.email}:{cfg.api_token}".encode("utf-8")
        ).decode("ascii")
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AtlassianClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    @property
    def site(self) -> str:
        return str(self._cfg.site)

    def cloud_id(self) -> str:
        if self._cloud_id:
            return self._cloud_id
        resp = self._client.get(f"https://{self.site}/_edge/tenant_info")
        resp.raise_for_status()
        self._cloud_id = resp.json()["cloudId"]
        return self._cloud_id

    def get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        """GET against the site (Jira REST v3 lives at /rest/api/3/...,
        Confluence v2 at /wiki/api/v2/...)."""
        resp = self._client.get(f"https://{self.site}{path}", params=params)
        resp.raise_for_status()
        return resp
