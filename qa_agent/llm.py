"""LLM abstraction.

One protocol, two backends. Default is Ollama (local, private, free).
Anthropic is the fallback when you want more horsepower for a specific
run — set `QA_AGENT_LLM_BACKEND=anthropic` and provide `ANTHROPIC_API_KEY`.

Every backend takes a system prompt + user prompt and returns text. JSON
output is requested with `json_mode=True`; the backend wires up whatever
each provider supports (Ollama `format=json`, Anthropic message with a
`response_format`-style instruction).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True)
class LlmConfig:
    backend: str
    """`ollama` | `anthropic` | `dry-run`"""
    model: str
    base_url: str | None
    api_key: str | None

    @classmethod
    def from_env(cls) -> "LlmConfig":
        backend = os.environ.get("QA_AGENT_LLM_BACKEND", "ollama").strip().lower()
        if backend == "anthropic":
            default_model = "claude-haiku-4-5-20251001"
        else:
            default_model = "qwen2.5-coder:7b"
        return cls(
            backend=backend,
            model=os.environ.get("QA_AGENT_LLM_MODEL", default_model),
            base_url=os.environ.get(
                "QA_AGENT_LLM_BASE_URL",
                "http://localhost:11434" if backend == "ollama" else None,
            ),
            api_key=os.environ.get("ANTHROPIC_API_KEY"),
        )


class LlmUnavailable(RuntimeError):
    pass


class Llm(Protocol):
    name: str

    def complete(self, system: str, user: str, json_mode: bool = False) -> str: ...


class OllamaLlm:
    name = "ollama"

    def __init__(self, model: str, base_url: str) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")

    def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
        }
        if json_mode:
            payload["format"] = "json"
        try:
            resp = httpx.post(f"{self._base_url}/api/chat", json=payload, timeout=300.0)
        except httpx.HTTPError as e:
            raise LlmUnavailable(f"ollama unreachable at {self._base_url}: {e}") from e
        if resp.status_code != 200:
            raise LlmUnavailable(
                f"ollama returned {resp.status_code}: {resp.text[:200]}"
            )
        data = resp.json()
        message = data.get("message") or {}
        return str(message.get("content", ""))


class AnthropicLlm:
    name = "anthropic"

    def __init__(self, model: str, api_key: str) -> None:
        try:
            import anthropic  # type: ignore
        except ImportError as e:
            raise LlmUnavailable(
                "anthropic backend requires `pip install anthropic` "
                "(or `uv sync --extra llm`)."
            ) from e
        if not api_key:
            raise LlmUnavailable("ANTHROPIC_API_KEY is not set.")
        self._model = model
        self._client = anthropic.Anthropic(api_key=api_key)

    def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        user_msg = user
        if json_mode:
            user_msg = (
                user
                + "\n\nReturn ONLY a single JSON object. No prose before or after."
            )
        try:
            resp = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
        except Exception as e:
            raise LlmUnavailable(f"anthropic call failed: {e}") from e
        text_parts: list[str] = []
        for block in resp.content:
            text = getattr(block, "text", None)
            if text:
                text_parts.append(text)
        return "".join(text_parts)


class DryRunLlm:
    """Stand-in that records prompts instead of calling out. Useful for
    smoke-testing wiring with no model available."""

    name = "dry-run"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, bool]] = []

    def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        self.calls.append((system, user, json_mode))
        if json_mode:
            return json.dumps(
                {
                    "rationale": "(dry-run) no model invoked",
                    "likely_bug_class": "unknown",
                    "suggested_test_name": "test_dry_run_placeholder",
                    "suggested_scenario": ["(dry-run)"],
                    "confidence": "low",
                }
            )
        return "(dry-run output)"


def get_llm(cfg: LlmConfig | None = None) -> Llm:
    cfg = cfg or LlmConfig.from_env()
    if cfg.backend == "dry-run":
        return DryRunLlm()
    if cfg.backend == "ollama":
        if not cfg.base_url:
            raise LlmUnavailable("QA_AGENT_LLM_BASE_URL must be set for ollama.")
        return OllamaLlm(model=cfg.model, base_url=cfg.base_url)
    if cfg.backend == "anthropic":
        return AnthropicLlm(model=cfg.model, api_key=cfg.api_key or "")
    raise LlmUnavailable(f"unknown LLM backend: {cfg.backend}")
