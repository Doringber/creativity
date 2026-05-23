"""Scheduled briefing — runs best_way on every configured route and prints
a concise Hebrew summary to stdout.

Designed to be called from cron / launchd / systemd-timer at the times
the user actually leaves the house. Output is plain text so it can be
piped to:

  - `mail -s "בריפינג בוקר" you@example.com`
  - a file appended daily for journaling
  - a Telegram bot via `curl -d ... api.telegram.org/bot.../sendMessage`
  - tee'd to all three.

Usage:
    python scripts/scheduled_briefing.py <route_name>[,<route_name>...] [--avoid-tolls]

Env vars (required):
    GOOGLE_MAPS_API_KEY  — same as the MCP server
    ISRAEL_TRANSIT_STORE_DIR  — same store the MCP writes to

Example crontab for Sun-Thu mornings at 09:30 and 10:00:
    30 9  * * 0-4 cd /path/to/israel-transit-mcp && python scripts/scheduled_briefing.py home->work,shilat->work --avoid-tolls >> ~/morning.log 2>&1
     0 10 * * 0-4 cd /path/to/israel-transit-mcp && python scripts/scheduled_briefing.py home->work,shilat->work --avoid-tolls >> ~/morning.log 2>&1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


async def run(route_names: list[str], avoid_tolls: bool) -> int:
    if not os.environ.get("GOOGLE_MAPS_API_KEY"):
        print("ERROR: GOOGLE_MAPS_API_KEY not set", file=sys.stderr)
        return 2

    from fastmcp import Client
    from fastmcp.client.transports import StdioTransport

    server_env = os.environ.copy()

    transport = StdioTransport(
        command="israel-transit-mcp",
        args=[],
        env=server_env,
    )

    now = datetime.now().astimezone()
    print(f"\n=== בריפינג {now.strftime('%H:%M  %a %d/%m/%Y')} ===")
    if avoid_tolls:
        print("(ללא כבישי אגרה)")

    async with Client(transport) as client:
        for name in route_names:
            print(f"\n--- {name} ---")
            try:
                result = await client.call_tool("best_way", {
                    "name": name,
                    "modes": ["driving", "transit"],
                    "avoid_tolls": avoid_tolls,
                    "record_observation": True,
                })
            except Exception as e:
                print(f"  ERROR: {type(e).__name__}: {e}")
                continue
            payload = _payload(result)
            if not payload.get("ok"):
                print(f"  ERROR: {payload.get('error', 'unknown')}")
                continue
            _render(payload)
    return 0


def _payload(result: Any) -> dict:
    if hasattr(result, "structured_content") and result.structured_content is not None:
        return result.structured_content
    if hasattr(result, "content") and result.content:
        text = getattr(result.content[0], "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"raw_text": text}
    return {"raw": str(result)}


def _render(payload: dict) -> None:
    win = payload["winner"]
    alts = payload.get("alternatives", [])
    rec = payload.get("recommendation", "")
    trace = payload.get("trace", {})

    print(f"  ► {rec}")

    win_mode_he = _mode_he(win["mode"])
    print(f"    {win_mode_he}: {win['total_duration_min']} דק׳"
          f"  ({win['summary'][:60]})")
    for alt in alts:
        alt_mode = _mode_he(alt["mode"])
        print(f"    {alt_mode}: {alt['total_duration_min']} דק׳"
              f"  ({alt['summary'][:60]})")

    matched = win.get("matched_disruptions", [])
    if matched:
        print(f"\n  ⚠️  {len(matched)} דיווח/ים על המסלול:")
        for d in matched[:3]:
            print(f"     [{d['kind']}] {d['title']}  ({d['source']})")

    baselines = payload.get("baselines", {})
    for mode, b in baselines.items():
        n = b.get("sample_size", 0)
        if n >= 5:
            anomaly = " ⚡ חריג" if b.get("is_anomalous") else ""
            print(f"  בייסליין {_mode_he(mode)}: p50={b['p50_min']}m "
                  f"p75={b['p75_min']}m היום={b['today_min']}m"
                  f"  ({n} דגימות){anomaly}")

    failures = (trace.get("disruptions") or {}).get("failures") or {}
    if failures:
        print(f"  (מקורות שלא ענו: {', '.join(failures.keys())})")


def _mode_he(m: str) -> str:
    return {"driving": "🚗 רכב", "transit": "🚌 תח״צ", "walking": "🚶 ברגל"}.get(m, m)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scheduled morning commute briefing")
    parser.add_argument(
        "routes",
        help="Comma-separated saved route names (e.g. home->work,shilat->work)",
    )
    parser.add_argument(
        "--avoid-tolls",
        action="store_true",
        help="Exclude toll roads (כביש 6 etc.)",
    )
    args = parser.parse_args()
    route_names = [r.strip() for r in args.routes.split(",") if r.strip()]
    if not route_names:
        print("ERROR: no routes provided", file=sys.stderr)
        return 2
    return asyncio.run(run(route_names, args.avoid_tolls))


if __name__ == "__main__":
    sys.exit(main())
