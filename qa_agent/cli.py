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
    "--ticket",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="Path to a Jira ticket dump (markdown or JSON). Optional for v1.",
)
@click.option(
    "--llm/--no-llm",
    default=False,
    show_default=True,
    help="Use the local LLM to rank and explain gaps. Off by default in v1 "
    "so the heuristic pass works without any model.",
)
def analyze(repo: Path, since: str, ticket: Path | None, llm: bool) -> None:
    """Find integration-test gaps in a Python repo.

    Walks `git log` over the lookback window, finds files that touch a real
    boundary (DB, queue, cache, async, external API) and lack an
    integration test alongside, and emits a gap report.
    """
    console.print(
        Panel.fit(
            f"[bold]analyze[/bold] {repo}\n"
            f"since: {since}\n"
            f"ticket: {ticket or '(none)'}\n"
            f"llm: {'on' if llm else 'off (heuristic-only)'}",
            title="qa-agent",
            border_style="cyan",
        )
    )
    console.print("[yellow]stub — wiring for `analyze` lands in commit 2.[/yellow]")


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
