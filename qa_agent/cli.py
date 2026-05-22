from __future__ import annotations

from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from . import __version__
from .config import AtlassianConfig, ConfluenceScope, JiraScope

console = Console()


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, prog_name="qa-agent")
def cli() -> None:
    """qa-agent — an AI QA engineer for Python microservices.

    Finds real integration-test gaps, writes integration tests against real
    services (testcontainers + LocalStack), runs them, and produces a
    structured triage verdict on failure. Human-in-the-loop: never modifies
    your repo without an approved diff.
    """


@cli.command()
@click.argument("repo", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option(
    "--since",
    default="2 weeks ago",
    show_default=True,
    help="Git log lookback window (anything `git log --since=...` accepts).",
)
@click.option(
    "--llm/--no-llm",
    default=False,
    show_default=True,
    help="Run the LLM re-rank pass after the heuristic. Backend is taken "
    "from QA_AGENT_LLM_BACKEND (ollama | anthropic | dry-run).",
)
@click.option(
    "--llm-dry-run",
    is_flag=True,
    default=False,
    help="Force the LLM backend to `dry-run` (no model call), useful for "
    "verifying prompt construction without a model.",
)
@click.option(
    "--use-jira/--no-jira",
    default=False,
    show_default=True,
    help="Pull Jira tickets referenced by recent commits and include their "
    "text in the LLM prompt. Requires QA_AGENT_ATLASSIAN_* env vars.",
)
@click.option(
    "--format",
    "out_format",
    type=click.Choice(["text", "json"]),
    default="text",
    show_default=True,
)
def analyze(
    repo: Path,
    since: str,
    llm: bool,
    llm_dry_run: bool,
    use_jira: bool,
    out_format: str,
) -> None:
    """Find integration-test gaps in a Python repo.

    Walks every .py file, parses imports, flags modules that touch a real
    boundary (DB, queue, cache, cloud, HTTP client) without an integration
    test alongside. Cross-references the git log over the lookback window
    so each gap is annotated with the commits and Jira tickets that
    touched the file. With --llm, the LLM re-rank pass adds a rationale,
    likely bug class, and suggested test name per gap.
    """
    from .analyze import analyze_repo
    from .sources import GitSource

    try:
        git_signals = list(GitSource(repo).fetch(since=since, max_count=500))
    except Exception as e:
        console.print(f"[red]could not read git log:[/red] {e}")
        git_signals = []

    gaps = analyze_repo(repo, git_signals=git_signals)

    ticket_signals: list = []
    if (llm or out_format == "json") and use_jira:
        ticket_signals = _pull_referenced_tickets(gaps, git_signals)

    ranked = []
    if llm and gaps:
        from .llm import LlmConfig, LlmUnavailable, get_llm
        from .rerank import rerank

        cfg = LlmConfig.from_env()
        if llm_dry_run:
            cfg = LlmConfig(backend="dry-run", model=cfg.model, base_url=None, api_key=None)
        try:
            client = get_llm(cfg)
        except LlmUnavailable as e:
            console.print(f"[red]LLM unavailable:[/red] {e}")
            client = None
        if client is not None:
            def _progress(i: int, total: int, gap) -> None:
                console.print(f"[dim]llm rerank {i}/{total} — {gap.file}[/dim]")
            ranked = rerank(gaps, client, repo, ticket_signals=ticket_signals, on_progress=_progress)

    if out_format == "json":
        import json
        payload = [_gap_to_json(g, repo, _verdict_for(g, ranked)) for g in gaps]
        click.echo(json.dumps(payload, indent=2))
        return

    console.print(
        Panel.fit(
            f"[bold]analyze[/bold] {repo}\n"
            f"since: {since}\n"
            f"gaps: {len(gaps)}\n"
            f"llm: {'on (' + (ranked[0].verdict.raw and 'completed' or 'errored') + ')' if ranked else 'off'}",
            title="qa-agent",
            border_style="cyan",
        )
    )
    if not gaps:
        console.print("[green]no integration-test gaps found.[/green]")
        return

    iterable = (
        ((rg.final_rank, rg.gap, rg.verdict) for rg in ranked)
        if ranked
        else ((i, g, None) for i, g in enumerate(gaps, start=1))
    )
    sev_color = {"high": "red", "med": "yellow", "ok": "green"}
    for i, g, verdict in iterable:
        kinds = ", ".join(f"{k.label}" for k in g.kinds)
        console.print(
            f"\n[bold]{i}.[/bold] [{sev_color[g.severity]}]{g.severity.upper()}[/]"
            f"  [bold]{g.file}[/bold]"
        )
        console.print(f"   boundaries: {kinds}")
        if g.tests:
            shapes = ", ".join(f"{t.path.name} ({t.shape})" for t in g.tests)
            console.print(f"   tests: {shapes}")
        else:
            console.print("   tests: [red]none[/red]")
        if g.touches:
            console.print(
                f"   touched in window: {len(g.touches)} commit(s) — {', '.join(g.touches[:5])}"
                + (" ..." if len(g.touches) > 5 else "")
            )
        if g.tickets:
            console.print(f"   ticket refs: {', '.join(g.tickets)}")
        if verdict is not None and verdict.rationale:
            console.print(f"   [cyan]rationale:[/cyan] {verdict.rationale}")
            if verdict.likely_bug_class and verdict.likely_bug_class != "other":
                console.print(
                    f"   [cyan]likely bug:[/cyan] {verdict.likely_bug_class}"
                    f"  [dim]({verdict.confidence})[/dim]"
                )
            if verdict.suggested_test_name:
                console.print(
                    f"   [cyan]suggested test:[/cyan] {verdict.suggested_test_name}()"
                )
            for step in verdict.suggested_scenario:
                console.print(f"     [dim]·[/dim] {step}")


def _verdict_for(gap, ranked: list):
    for rg in ranked:
        if rg.gap is gap:
            return rg.verdict
    return None


def _gap_to_json(g, repo: Path, verdict) -> dict:
    out = {
        "file": str(g.file),
        "severity": g.severity,
        "coverage": g.coverage,
        "kinds": [k.code for k in g.kinds],
        "boundaries": [
            {"module": h.module, "kind": h.kind.code, "line": h.line, "via": h.via}
            for h in g.hits
        ],
        "tests": [
            {"path": str(t.path.relative_to(repo.resolve())), "shape": t.shape}
            for t in g.tests
        ],
        "touches": g.touches,
        "tickets": g.tickets,
    }
    if verdict is not None:
        out["llm"] = {
            "rationale": verdict.rationale,
            "likely_bug_class": verdict.likely_bug_class,
            "suggested_test_name": verdict.suggested_test_name,
            "suggested_scenario": verdict.suggested_scenario,
            "confidence": verdict.confidence,
            "rerank_delta": verdict.rerank_delta,
        }
    return out


def _pull_referenced_tickets(gaps: list, git_signals: list) -> list:
    """Best-effort fetch of every Jira key mentioned by any commit. Silent
    failure: a missing token just means tickets won't be included in the
    LLM prompt."""
    from .config import AtlassianConfig, JiraScope
    from .sources import AtlassianClient, JiraSource

    keys: set[str] = set()
    for g in gaps:
        keys.update(g.tickets)
    for s in git_signals:
        keys.update(s.metadata.get("ticket_refs") or [])
    if not keys:
        return []
    cfg = AtlassianConfig.from_env()
    if not cfg.configured:
        return []
    out: list = []
    try:
        with AtlassianClient(cfg) as client:
            jira = JiraSource(client, JiraScope(projects=(), jql_window=""))
            for key in sorted(keys):
                try:
                    out.append(jira.get(key))
                except Exception:
                    continue
    except Exception:
        return []
    return out


@cli.command()
@click.argument("gap_id")
@click.option(
    "--out",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("proposed"),
    show_default=True,
    help="Where proposed test files are written.",
)
def propose(gap_id: str, out: Path) -> None:
    """Generate an integration test for a previously-found gap.

    Output is a pytest module that uses `testcontainers` (SQL Server, Redis)
    and LocalStack (S3, SQS) to exercise the real boundary. The file is
    written into `proposed/` and never committed automatically.
    """
    console.print(
        Panel.fit(
            f"[bold]propose[/bold] gap={gap_id}\nout: {out}/",
            title="qa-agent",
            border_style="cyan",
        )
    )
    console.print("[yellow]stub — wiring for `propose` lands in commit 4.[/yellow]")


@cli.command()
@click.argument("test_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--triage/--no-triage",
    default=True,
    show_default=True,
    help="On failure, run structured triage and write a verdict.",
)
def run(test_path: Path, triage: bool) -> None:
    """Run a test and, on failure, produce a structured triage verdict.

    Verdicts are one of `test-bug | code-bug | env-bug`, with evidence
    (ticket text, diff context, failure trace). Nothing is auto-fixed.
    """
    console.print(
        Panel.fit(
            f"[bold]run[/bold] {test_path}\ntriage: {'on' if triage else 'off'}",
            title="qa-agent",
            border_style="cyan",
        )
    )
    console.print("[yellow]stub — wiring for `run` lands in commit 5.[/yellow]")


@cli.group()
def sources() -> None:
    """Inspect and probe the configured signal sources (git, Jira, Confluence)."""


@sources.command("probe")
@click.option(
    "--repo",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default=Path.cwd(),
    show_default=True,
    help="Repo to probe for the git source.",
)
@click.option(
    "--since",
    default="2 weeks ago",
    show_default=True,
    help="Git log lookback for the probe.",
)
@click.option(
    "--jira-limit",
    type=int,
    default=5,
    show_default=True,
)
@click.option(
    "--confluence-limit",
    type=int,
    default=5,
    show_default=True,
)
def sources_probe(repo: Path, since: str, jira_limit: int, confluence_limit: int) -> None:
    """End-to-end smoke test of every configured source.

    Reports the configuration in use, fetches a small sample from each
    source, and prints what came back. Use this to verify auth + scope
    before running `analyze`.
    """
    from .sources import AtlassianClient, ConfluenceSource, GitSource, JiraSource

    atl_cfg = AtlassianConfig.from_env()
    jira_scope = JiraScope.from_env()
    conf_scope = ConfluenceScope.from_env()

    config_table = Table(title="qa-agent sources — configuration", show_lines=False)
    config_table.add_column("knob")
    config_table.add_column("value")
    config_table.add_row("repo", str(repo))
    config_table.add_row("git since", since)
    config_table.add_row("atlassian site", atl_cfg.site or "[red](unset)[/red]")
    config_table.add_row("atlassian email", atl_cfg.email or "[red](unset)[/red]")
    config_table.add_row(
        "atlassian token",
        "[green](set)[/green]" if atl_cfg.api_token else "[red](unset)[/red]",
    )
    config_table.add_row("jira projects", ", ".join(jira_scope.projects) or "[yellow](all)[/yellow]")
    config_table.add_row("jira window", jira_scope.jql_window)
    config_table.add_row(
        "confluence spaces",
        ", ".join(conf_scope.space_keys) or "[yellow](none — Confluence skipped)[/yellow]",
    )
    console.print(config_table)

    # git
    console.rule("[cyan]git")
    try:
        git = GitSource(repo)
        git_signals = list(git.fetch(since=since, max_count=jira_limit))
        if not git_signals:
            console.print("[yellow]no commits in window[/yellow]")
        for s in git_signals:
            console.print(f"  [dim]{s.metadata['short']}[/dim] {s.title}")
            refs = s.metadata.get("ticket_refs") or []
            if refs:
                console.print(f"    [dim]ticket refs:[/dim] {', '.join(refs)}")
    except Exception as e:
        console.print(f"[red]git probe failed:[/red] {e}")

    # jira + confluence
    if not atl_cfg.configured:
        console.rule("[yellow]jira + confluence skipped (atlassian not configured)")
        return

    with AtlassianClient(atl_cfg) as client:
        console.rule("[cyan]jira")
        try:
            jira = JiraSource(client, jira_scope)
            for s in jira.fetch(limit=jira_limit):
                console.print(f"  [dim]{s.id}[/dim] [{s.metadata.get('status')}] {s.title}")
        except Exception as e:
            console.print(f"[red]jira probe failed:[/red] {e}")

        console.rule("[cyan]confluence")
        if not conf_scope.space_keys:
            console.print("[yellow]no QA_AGENT_CONFLUENCE_SPACES configured — skipping[/yellow]")
        else:
            try:
                conf = ConfluenceSource(client, conf_scope)
                for s in conf.fetch(limit_per_space=confluence_limit, with_body=False):
                    console.print(
                        f"  [dim]{s.metadata.get('space_key')}/{s.id}[/dim] {s.title}"
                    )
            except Exception as e:
                console.print(f"[red]confluence probe failed:[/red] {e}")


@cli.group()
def memory() -> None:
    """Inspect what the agent has learned about your services."""


@memory.command("show")
@click.option("--service", help="Filter to one service.")
def memory_show(service: str | None) -> None:
    """Show learned per-service invariants."""
    table = Table(title="learned invariants (stub)")
    table.add_column("service")
    table.add_column("invariant")
    table.add_column("confidence")
    table.add_row("(none yet)", "memory layer lands in commit 6", "—")
    console.print(table)


if __name__ == "__main__":
    cli()
