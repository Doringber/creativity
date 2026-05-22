"""Catalog of "real boundary" libraries.

A module is considered to touch a real boundary when it imports anything
from one of these prefixes. Each entry maps to a `BoundaryKind` so the
later `propose` step can pick the right testcontainers template
(SQL Server vs Redis vs LocalStack S3 vs ...).

Keep this list small and obvious. New boundaries get added when the
agent sees them in the wild, not preemptively.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BoundaryKind:
    code: str
    """Stable identifier used downstream (db_sync, cache, ...)."""
    label: str
    """Human-readable name shown in reports."""
    weight: int
    """Rough risk weight. Used as a tiebreaker when ranking gaps."""


DB_SYNC = BoundaryKind("db_sync", "DB (sync)", 4)
DB_ASYNC = BoundaryKind("db_async", "DB (async)", 5)
CACHE = BoundaryKind("cache", "cache", 3)
QUEUE = BoundaryKind("queue", "queue", 5)
HTTP_CLIENT = BoundaryKind("http_client", "HTTP client", 2)
CLOUD = BoundaryKind("cloud", "cloud SDK", 3)
TASK_QUEUE = BoundaryKind("task_queue", "task queue", 4)


# Order matters: the first matching prefix wins.
BOUNDARY_PREFIXES: tuple[tuple[str, BoundaryKind], ...] = (
    ("sqlalchemy.ext.asyncio", DB_ASYNC),
    ("sqlalchemy", DB_SYNC),
    ("asyncpg", DB_ASYNC),
    ("aiomysql", DB_ASYNC),
    ("motor", DB_ASYNC),
    ("pyodbc", DB_SYNC),
    ("psycopg2", DB_SYNC),
    ("psycopg", DB_SYNC),
    ("pymysql", DB_SYNC),
    ("pymssql", DB_SYNC),
    ("aioredis", CACHE),
    ("redis", CACHE),
    ("memcache", CACHE),
    ("pylibmc", CACHE),
    ("aio_pika", QUEUE),
    ("aiokafka", QUEUE),
    ("kafka", QUEUE),
    ("pika", QUEUE),
    ("confluent_kafka", QUEUE),
    ("aioboto3", CLOUD),
    ("boto3", CLOUD),
    ("google.cloud", CLOUD),
    ("azure", CLOUD),
    ("celery", TASK_QUEUE),
    ("dramatiq", TASK_QUEUE),
    ("rq", TASK_QUEUE),
    ("httpx", HTTP_CLIENT),
    ("aiohttp", HTTP_CLIENT),
    ("requests", HTTP_CLIENT),
)


def classify(module_name: str) -> BoundaryKind | None:
    """Return the BoundaryKind for an import path, or None if it isn't one."""
    for prefix, kind in BOUNDARY_PREFIXES:
        if module_name == prefix or module_name.startswith(prefix + "."):
            return kind
    return None
