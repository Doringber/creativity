"""LLM re-rank pass on top of the heuristic `analyze` output.

The heuristic ranks by boundary count + coverage. The LLM reads the diff,
the linked tickets, and the existing-test shape, then attaches a
rationale, a probable bug class, a suggested test name, and a delta to
re-order the list. The heuristic stays authoritative when the LLM is
unavailable.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .analyze import Gap
from .llm import Llm, LlmUnavailable


_PROMPT_DIR = Path(__file__).parent / "prompts"
_RERANK_SYSTEM = (_PROMPT_DIR / "rerank_system.md").read_text(encoding="utf-8")

_VALID_BUG_CLASSES = {
    "cache_race",
    "missing_idempotency",
    "n_plus_one",
    "retry_storm",
    "transaction_violation",
    "connection_leak",
    "message_redelivery",
    "ordering_assumption",
    "partial_failure",
    "stale_read",
    "other",
}

_MAX_FILE_CHARS = 6000
_MAX_TICKET_CHARS = 2000


@dataclass
class LlmVerdict:
    rationale: str = ""
    likely_bug_class: str = "other"
    suggested_test_name: str = ""
    suggested_scenario: list[str] = field(default_factory=list)
    confidence: str = "low"
    rerank_delta: int = 0
    raw: str = ""
    """The full text the model returned, kept for debugging."""

    @classmethod
    def parse(cls, raw: str) -> "LlmVerdict":
        text = raw.strip()
        # Some models wrap JSON in ```json ... ```; strip if present.
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # Last-ditch: find the first { ... } block.
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end <= start:
                return cls(rationale="(could not parse LLM output)", raw=raw)
            try:
                data = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return cls(rationale="(could not parse LLM output)", raw=raw)
        if not isinstance(data, dict):
            return cls(rationale="(LLM did not return a JSON object)", raw=raw)
        bug_class = str(data.get("likely_bug_class", "other"))
        if bug_class not in _VALID_BUG_CLASSES:
            bug_class = "other"
        scenario_raw = data.get("suggested_scenario", [])
        scenario = [str(s) for s in scenario_raw] if isinstance(scenario_raw, list) else []
        delta = data.get("rerank_delta", 0)
        try:
            delta_int = max(-3, min(3, int(delta)))
        except (TypeError, ValueError):
            delta_int = 0
        return cls(
            rationale=str(data.get("rationale", "")).strip(),
            likely_bug_class=bug_class,
            suggested_test_name=str(data.get("suggested_test_name", "")).strip(),
            suggested_scenario=scenario,
            confidence=str(data.get("confidence", "low")).strip().lower(),
            rerank_delta=delta_int,
            raw=raw,
        )


def _read_truncated(path: Path, limit: int = _MAX_FILE_CHARS) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n# ... (truncated, {len(text) - limit} more chars)"


def _format_ticket(signal: Any) -> str:
    """Render a Jira Signal for the LLM. Body is truncated."""
    body = (signal.body or "").strip()
    if len(body) > _MAX_TICKET_CHARS:
        body = body[:_MAX_TICKET_CHARS] + " ... (truncated)"
    md = signal.metadata or {}
    return (
        f"### {signal.id} — {signal.title}\n"
        f"status: {md.get('status')}  type: {md.get('issuetype')}  "
        f"priority: {md.get('priority')}\n"
        f"{body or '(no description)'}"
    )


def build_rerank_user_prompt(
    gap: Gap,
    repo: Path,
    ticket_signals: Iterable[Any] = (),
) -> str:
    file_text = _read_truncated(repo / gap.file)
    test_texts: list[str] = []
    for t in gap.tests:
        body = _read_truncated(t.path, limit=2000)
        test_texts.append(f"### existing test: {t.path.name} (shape: {t.shape})\n{body}")
    tickets_by_key = {s.id: s for s in ticket_signals}
    linked = [tickets_by_key[k] for k in gap.tickets if k in tickets_by_key]
    ticket_block = "\n\n".join(_format_ticket(s) for s in linked) or "(no linked tickets)"
    kinds = ", ".join(f"{k.label} ({k.code})" for k in gap.kinds)
    boundary_lines = "\n".join(
        f"  L{h.line}: import {h.module} → {h.kind.code}"
        + (f"  [transitive via {h.via}]" if h.via else "")
        for h in gap.hits
    )
    test_block = "\n\n".join(test_texts) or "(no existing tests covering this file)"
    return (
        f"# Gap under review\n\n"
        f"**File:** `{gap.file}`\n"
        f"**Boundary kinds:** {kinds}\n"
        f"**Existing coverage:** {gap.coverage}\n"
        f"**Heuristic severity:** {gap.severity}\n\n"
        f"## Boundary imports\n{boundary_lines or '(none direct)'}\n\n"
        f"## Linked Jira tickets\n{ticket_block}\n\n"
        f"## File under test\n```python\n{file_text}\n```\n\n"
        f"## Existing tests\n{test_block}\n\n"
        f"Produce the JSON verdict per the system instructions. Remember: "
        f"never propose a unit test or a mocked test. Only real-integration "
        f"tests against real services."
    )


@dataclass
class RankedGap:
    gap: Gap
    verdict: LlmVerdict | None
    heuristic_rank: int
    """1-based rank from the heuristic pass."""
    final_rank: int = 0
    """1-based rank after applying LLM delta."""

    def adjusted_score(self) -> float:
        delta = self.verdict.rerank_delta if self.verdict else 0
        return -(self.heuristic_rank) + delta


def rerank(
    gaps: list[Gap],
    llm: Llm,
    repo: Path,
    ticket_signals: Iterable[Any] = (),
    on_progress: Any = None,
) -> list[RankedGap]:
    """Apply the LLM re-ranker to a list of heuristic gaps."""
    tickets_list = list(ticket_signals)
    ranked: list[RankedGap] = []
    for i, gap in enumerate(gaps, start=1):
        if on_progress:
            on_progress(i, len(gaps), gap)
        user_prompt = build_rerank_user_prompt(gap, repo, tickets_list)
        try:
            raw = llm.complete(_RERANK_SYSTEM, user_prompt, json_mode=True)
            verdict = LlmVerdict.parse(raw)
        except LlmUnavailable as e:
            verdict = LlmVerdict(rationale=f"(LLM unavailable: {e})")
        ranked.append(RankedGap(gap=gap, verdict=verdict, heuristic_rank=i))
    ranked.sort(key=lambda r: r.adjusted_score(), reverse=True)
    for new_rank, rg in enumerate(ranked, start=1):
        rg.final_rank = new_rank
    return ranked
