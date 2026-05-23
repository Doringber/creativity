# israel-transit-mcp

An MCP server that gives Claude *live*, Israel-specific routing intelligence:
when to leave, which way to go, what's wrong on your usual commute *today*.

## The job

You ask Claude "should I leave for work now?" and Claude — via this MCP —
answers with: current driving ETA vs. your personal baseline, an anomaly flag,
the disruption events (RSS-confirmed) that explain the anomaly, and a
recommended departure time.

## Sources, picked deliberately

| Source | What it gives | TOS-clean? |
| --- | --- | --- |
| **Google Routes API v1** | Driving ETA, traffic-aware, departure-time prediction | Yes (5,000 free traffic-aware calls/month) |
| **Israeli news RSS** (Kan, Ynet, N12, Walla, gov.il) | Road closures, protests, accidents — the *cause* behind anomalies | Yes (public RSS) |
| **IMS** (`weatheril`) | Rain/storm warnings that explain delays | Yes (public, no key) |
| **MoT GTFS bundle** | Static bus + rail + light-rail schedules, all agencies | Yes (open data) |
| **Hasadna Open-Bus Stride** | Live bus positions, stop ETAs | Yes (community NGO mirror of MoT SIRI) |
| **`israel-rail-api`** | Live train arrivals + delays | Yes (well-known unofficial wrapper) |

Deliberately **not** integrated:
- **Waze** — TOS forbids automation. We rely on RSS news + Google's
  Waze-fed traffic via the Routes API instead.
- **Moovit** — enterprise/paid only in 2026, no realistic personal API.
- **Pango** — no public developer program.

## The hybrid that makes this work

There is **no machine-readable feed for Israeli protests / road closures**.
The MCP solves this with a hybrid:

1. The Routes API gives a *quantitative* signal — today's ETA is N minutes
   above your historical baseline for this (route, weekday, hour) bucket.
2. The RSS source provides *qualitative* candidates — recent news items
   mentioning the streets/cities along your route, filtered by Hebrew
   keywords (`חסימה`, `הפגנה`, `תאונה`, `פקקים`, `כביש סגור`).
3. The MCP returns both to Claude, which composes a human answer.

When RSS is silent and the ETA is still anomalous, the MCP tells Claude
exactly that: "anomalous delay, no news cause matched — consider asking
the user, or run web_search on `<street> חסימה`."

## RAG layer

Local SQLite at `~/.israel-transit-mcp/store.db`. Three small tables:
`saved_routes`, `eta_observations`, `user_prefs`. No vector store, no
embeddings — Hebrew place-name LIKE matching is enough at this scale.

The baseline is computed per (route, day_of_week, hour) bucket; anomaly is
declared when today's ETA exceeds p75 of the bucket by more than 5 minutes.

## Configuration

Copy `.env.example` to `.env` and set:

```
GOOGLE_MAPS_API_KEY=        # required for driving ETA
ISRAEL_TRANSIT_STORE_DIR=   # optional; default ~/.israel-transit-mcp
```

## Running

```bash
uv sync --extra transit --extra weather
israel-transit-mcp           # starts the MCP server on stdio
```

## Connecting to Claude

Add to `~/.config/claude-code/mcp.json` (or your client's equivalent):

```json
{
  "mcpServers": {
    "israel-transit": {
      "command": "israel-transit-mcp"
    }
  }
}
```

Then ask Claude things like:
- "תכנן לי איך להגיע לעבודה עכשיו"
- "האם המסלול לעבודה חריג היום?"
- "מתי כדאי לי לצאת היום בערב לרכבת בתל אביב סבידור?"
