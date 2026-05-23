"""Live demo against the real MCP subprocess.

Unlike demo_user_session.py (which uses an in-process MCP with fakes),
this script:
  1. spawns `israel-transit-mcp` as a real subprocess over stdio,
  2. connects to it via fastmcp.Client (the same transport Claude Desktop uses),
  3. calls best_way / plan_route with a saved Tel Aviv → Herzliya route
     against the live Google Routes API.

Reads the key from $KEY env var so it never lands on disk.
The MCP subprocess receives the key via its own env config.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


async def main() -> int:
    api_key = os.environ.get("KEY", "")
    if not api_key.startswith("AIza"):
        print("ERROR: KEY env var missing")
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="itm-live-"))
    # Inherit the full env (so SSL_CERT_FILE / system CA bundles / PATH etc.
    # flow through to the MCP subprocess) and override only what we need.
    server_env = os.environ.copy()
    server_env.update({
        "GOOGLE_MAPS_API_KEY": api_key,
        "ISRAEL_TRANSIT_STORE_DIR": str(tmp),
        "ANOMALY_THRESHOLD_MINUTES": "5",
        "BASELINE_MIN_SAMPLES": "5",
    })

    from fastmcp import Client
    from fastmcp.client.transports import StdioTransport

    transport = StdioTransport(
        command="israel-transit-mcp",
        args=[],
        env=server_env,
    )

    print("Connecting to the MCP subprocess (stdio)...")
    async with Client(transport) as client:
        tools = await client.list_tools()
        print(f"\nMCP up. Tools registered: {len(tools)}")
        for t in sorted(tools, key=lambda x: x.name):
            print(f"  · {t.name}")

        # 1. health
        print("\n--- 1. health() ---")
        result = await client.call_tool("health", {})
        payload = _payload(result)
        print(json.dumps(payload, indent=2, ensure_ascii=False))

        # 2. save a real Tel Aviv -> Herzliya route
        print("\n--- 2. save_route(name='work->home') ---")
        result = await client.call_tool("save_route", {
            "name": "work->home",
            "origin": "הרצליה פיתוח, רחוב גלגלי הפלדה 11",
            "destination": "נחלת בנימין 30, תל אביב",
            "mode": "driving",
            "default_departure_local": "21:00",
        })
        print(json.dumps(_payload(result), indent=2, ensure_ascii=False))

        # 3. live plan_route — real Google call
        print("\n--- 3. plan_route(work->home, driving) — LIVE Google call ---")
        result = await client.call_tool("plan_route", {
            "origin": "הרצליה פיתוח, רחוב גלגלי הפלדה 11",
            "destination": "נחלת בנימין 30, תל אביב",
            "mode": "driving",
        })
        p = _payload(result)
        if p.get("ok"):
            print(f"  alternatives returned: {len(p['alternatives'])}")
            for i, alt in enumerate(p["alternatives"], 1):
                print(f"  {i}. {alt['total_duration_min']} min, "
                      f"{alt['total_distance_km']} km  |  {alt['summary'][:60]}")
            print(f"  trace: {json.dumps(p['trace'], ensure_ascii=False)}")
        else:
            print(f"  ERROR: {p.get('error')}")

        # 4. live plan_route TRANSIT — real Google call
        print("\n--- 4. plan_route(work->home, transit) — LIVE Google call ---")
        result = await client.call_tool("plan_route", {
            "origin": "הרצליה פיתוח, רחוב גלגלי הפלדה 11",
            "destination": "נחלת בנימין 30, תל אביב",
            "mode": "transit",
        })
        p = _payload(result)
        if p.get("ok"):
            print(f"  alternatives returned: {len(p['alternatives'])}")
            for i, alt in enumerate(p["alternatives"][:2], 1):
                print(f"  {i}. {alt['total_duration_min']} min  |  {alt['summary'][:80]}")
                for leg in alt["legs"][:6]:
                    print(f"       [{leg['mode']:8s}] {leg['summary'][:75]}  ({leg['duration_s']//60} min)")
        else:
            print(f"  ERROR: {p.get('error')}")

        # 5. best_way comparing both modes — two live Google calls in parallel
        print("\n--- 5. best_way(work->home) — LIVE driving + transit + RSS in parallel ---")
        result = await client.call_tool("best_way", {
            "name": "work->home",
            "modes": ["driving", "transit"],
            "record_observation": False,
        })
        p = _payload(result)
        if p.get("ok"):
            win = p["winner"]
            print(f"  WINNER: {win['mode']}  —  {win['total_duration_min']} min  ({win['summary'][:60]})")
            for alt in p["alternatives"]:
                print(f"  alt:    {alt['mode']}  —  {alt['total_duration_min']} min  ({alt['summary'][:60]})")
            print(f"\n  RECOMMENDATION (what Claude would say):")
            print(f"    {p['recommendation']}")
            print(f"\n  trace.modes: {json.dumps(p['trace']['modes'], ensure_ascii=False)}")
            print(f"  trace.disruptions: {json.dumps(p['trace']['disruptions'], ensure_ascii=False)}")
        else:
            print(f"  ERROR: {p.get('error')}")

    print("\nDone. MCP subprocess shut down cleanly.")
    return 0


def _payload(result) -> dict:
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


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
