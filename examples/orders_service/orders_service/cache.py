from __future__ import annotations

import json
import os
from typing import Any

import redis


_client = redis.Redis.from_url(
    os.environ.get("ORDERS_REDIS_URL", "redis://localhost:6379/0"),
    decode_responses=True,
)

ORDER_TTL_SECONDS = 300


def _key(order_id: int) -> str:
    return f"order:{order_id}"


def get(order_id: int) -> dict[str, Any] | None:
    raw = _client.get(_key(order_id))
    return json.loads(raw) if raw else None


def put(order_id: int, payload: dict[str, Any]) -> None:
    _client.set(_key(order_id), json.dumps(payload, default=str), ex=ORDER_TTL_SECONDS)


def invalidate(order_id: int) -> None:
    _client.delete(_key(order_id))
