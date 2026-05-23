"""Bounded-concurrency async task runner.

The MCP tools fan out across many independent I/O sources: Google Routes,
several RSS feeds, IMS weather, Hasadna Stride, israel-rail. They are
slow individually (HTTP, parsing) and uncorrelated, so they MUST run in
parallel — otherwise a single MCP call would block for many seconds and
Claude would time out.

`TaskRunner.run` takes a named dict of zero-arg async factories, runs them
concurrently up to `max_concurrency`, enforces a per-task timeout (so one
hanging RSS feed cannot delay the whole batch), and an overall timeout
(so the MCP tool returns *something* in bounded time). Failures and
timeouts become `TaskResult.error` rather than exceptions — every MCP
tool gets partial-success tolerance for free.

Deliberately small. If we later need persistent jobs (cron-like
"every 5 min refresh GTFS"), that's a separate scheduler, not this.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, TypeVar

T = TypeVar("T")


@dataclass
class TaskResult(Generic[T]):
    name: str
    value: T | None = None
    error: str | None = None
    duration_ms: int = 0

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass
class TaskRunner:
    max_concurrency: int = 8
    task_timeout_s: float = 6.0
    overall_timeout_s: float = 12.0

    async def run(
        self,
        tasks: dict[str, Callable[[], Awaitable[T]]],
    ) -> dict[str, TaskResult[T]]:
        if not tasks:
            return {}
        sem = asyncio.Semaphore(self.max_concurrency)

        async def _one(name: str, factory: Callable[[], Awaitable[T]]) -> TaskResult[T]:
            async with sem:
                t0 = time.perf_counter()
                try:
                    value = await asyncio.wait_for(factory(), timeout=self.task_timeout_s)
                    return TaskResult(
                        name=name,
                        value=value,
                        duration_ms=int((time.perf_counter() - t0) * 1000),
                    )
                except asyncio.TimeoutError:
                    return TaskResult(
                        name=name,
                        error=f"timeout after {self.task_timeout_s}s",
                        duration_ms=int((time.perf_counter() - t0) * 1000),
                    )
                except Exception as e:
                    return TaskResult(
                        name=name,
                        error=f"{type(e).__name__}: {e}",
                        duration_ms=int((time.perf_counter() - t0) * 1000),
                    )

        coros = [_one(n, f) for n, f in tasks.items()]
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*coros), timeout=self.overall_timeout_s
            )
        except asyncio.TimeoutError:
            return {
                n: TaskResult(name=n, error="overall timeout reached")
                for n in tasks
            }
        return {r.name: r for r in results}


def successes(results: dict[str, TaskResult[T]]) -> dict[str, T]:
    """Convenience: drop failed/empty tasks, return name → value."""
    return {n: r.value for n, r in results.items() if r.ok and r.value is not None}


def failures(results: dict[str, TaskResult[T]]) -> dict[str, str]:
    """Convenience: name → error string for tasks that did not succeed."""
    return {n: (r.error or "no value") for n, r in results.items() if not r.ok}
