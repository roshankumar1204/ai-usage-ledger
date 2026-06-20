# AI Usage Ledger

A reconciliation pipeline for AI tool usage and spend across an organization. Pulls usage data from multiple AI vendors (ChatGPT, GitHub Copilot, Cursor) into one canonical event format, then surfaces clean, trustworthy metrics — solving for the real-world mess of incompatible schemas, duplicate deliveries, late-arriving billing data, and silent schema drift.

## Live ingestion via UI

Beyond the Swagger-only flow, the dashboard itself has an upload panel — one drop zone per vendor (ChatGPT `.json`, Copilot `.csv`, Cursor `.jsonl`). Selecting a file posts directly to `/ingest/{source}` and the dashboard's stats, chart, and ledger refresh automatically on success — no Swagger or curl needed for the demo.

## The problem

Organizations using multiple AI tools end up with usage and cost data scattered across vendors, each with its own export format, billing cadence, and quirks. Getting one trustworthy number — "how much are we spending, on what, by whom" — means solving several hard problems at once:

| Problem | Solution built here |
|---|---|
| Sources arrive in incompatible shapes | One canonical `AIUsageEvent` schema; 3 vendor parsers (ChatGPT JSON export, Copilot CSV, Cursor JSONL) each converge on the same shape |
| Every source can redeliver the same event | Deterministic `dedup_key` (hash of source + raw event id), upsert-not-insert |
| Cost data arrives late, separately from usage | Cost field is nullable on ingest; a later batch with the same dedup key patches `cost_cents` in place instead of duplicating the row |
| A vendor changes a field and nothing throws — it just silently reads null | `drift_detector.py` baselines each vendor's key-paths on first ingest and flags missing keys on every batch after |
| A parser fix for one vendor can silently break another | pytest replay harness runs every parser against committed fixture payloads + snapshot-asserts output didn't unexpectedly change |
| Linking the same person across tools without guessing | `identity_resolver.py` only links a raw email to an Identity via an explicit, recorded `proof_type` — no fuzzy matching, no silent merging |
| Different readers reporting different numbers for the same metric | Single FastAPI metrics layer (`/metrics/*`) is the only place "active users" / "cost by tool" are computed — dashboard and any future reader pull from the same source |

**Deliberately not built** (would need infra disproportionate to a demo, covered conceptually instead): TLS interception on endpoints, browser-extension network capture, fleet-wide deployment/MDM, corpus-scale LLM classification, generic auto-detection of unknown vendor schemas (the parsers here are intentionally vendor-specific — real schema auto-detection for an arbitrary, undocumented format is itself the open-ended problem this kind of system exists to solve, not a demo-scope add-on).

## Architecture

ai-usage-ledger/

backend/

app/

models/

canonical_event.py     # the one event shape every vendor maps into

identity.py             # Identity + IdentityEdge (proof-backed links only)

parsers/

chatgpt_enterprise.py   # JSON export -> canonical shape

copilot_export.py       # CSV export -> canonical shape

cursor_jsonl.py         # JSONL stream -> canonical shape

ingest.py                 # dedup + upsert + late-cost backfill

identity_resolver.py      # proof-based identity linking

drift_detector.py         # baseline + diff key-paths per vendor

db.py

main.py                   # FastAPI app: /ingest/{source}, /metrics/*

tests/

fixtures/<vendor>/        # captured sample payloads + committed output snapshots

test_replay.py            # structural assertions + regression snapshots

frontend/
    src/
      api/client.ts             # typed API client, no hardcoded URLs (env-driven)
      App.tsx                   # dashboard layout: stats, cost-by-tool chart, ledger table
      IngestPanel.tsx           # file upload UI per vendor, wired to /ingest/{source}
      index.css                 # design tokens (Tailwind v4 @theme)

## Tech stack

**Backend**
- FastAPI — REST API
- SQLModel — ORM (Pydantic + SQLAlchemy in one)
- PostgreSQL via [Neon](https://neon.tech) — serverless, free tier, no local DB setup
- pytest — replay/regression harness
- python-dotenv — env config

**Frontend**
- React + TypeScript (Vite)
- Tailwind CSS v4 (CSS-native `@theme` tokens, no JS config file)
- TanStack Query (`@tanstack/react-query`) — data fetching/caching
- Axios — HTTP client
- Recharts — cost-by-tool chart

All config (API base URL, DB connection string) is environment-driven — nothing hardcoded.

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install fastapi uvicorn sqlmodel psycopg2-binary pydantic python-dotenv pytest
```

Create `backend/.env`:


DATABASE_URL=postgresql://<your-neon-connection-string>

Run:
```bash
uvicorn app.main:app --reload --port 8000
```
Swagger docs: `http://localhost:8000/docs`

Run tests:
```bash
pytest tests/test_replay.py -v
```

### Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:


VITE_API_BASE_URL=http://localhost:8000


Run:
```bash
npm run dev
```
Dashboard: `http://localhost:5173`

## Demo flow

1. Ingest all three vendor fixtures via Swagger (`/ingest/chatgpt`, `/ingest/copilot`, `/ingest/cursor`)
2. Open the dashboard — same numbers reflected in stat strip, chart, and ledger table from one metrics layer
3. **Dedup**: re-ingest the same file — `inserted` stays 0, no duplicate rows
4. **Late-cost backfill**: ingest a follow-up payload with the same `dedup_key` but cost now filled in — existing row updates in place, doesn't duplicate
5. **Drift detection**: ingest a payload with a renamed/missing field for an already-baselined vendor — response includes `"status": "DRIFT_DETECTED"` instead of silently nulling the field
6. **Add a 4th vendor live**: write one new parser file, register it in `PARSERS` dict — zero other files change, proving the canonical-event architecture holds
## What I'd build next

- Migrations via Alembic instead of `create_all()` — additive and reversible, instead of dropping tables on schema changes
- An audit trail table logging every write with a reason, so any number can be explained or disputed later
- Versioned parser dispatch, so multiple schema generations of the same vendor can be handled live at once (vendors change their export format over time without warning)
- Expanding `proof_type` beyond exact-email-match (SSO claims, verified device certs) without changing the resolver's core guarantee: never assert an identifier that can't be proven