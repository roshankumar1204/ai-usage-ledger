# AI Usage Ledger

Find out whether your team is overpaying for AI. Upload a ChatGPT, GitHub Copilot or Cursor usage export (or just name the plan you're on), and the app re-prices your team's actual usage on every comparable plan from the top AI vendors, tells you which one fits best, and why.

The first 2 analyses per team are free. Sample bills are always free.

## How it works

### 1. Add a bill, or name your plan

| You have | What you do | What the app knows |
|---|---|---|
| A usage export (ChatGPT `.json`, Copilot `.csv`, Cursor `.jsonl`) | Pick the tool, upload the file | Who used it, when, which models, tokens, and cost per event if the export has it |
| No export | Pick your current plan, enter seats, optionally what you really pay | Seats and current spend only |
| Nothing yet | Click "try a sample bill" | A small built-in example; doesn't use a free analysis |

Uploaded files go through the ingest pipeline (see [Under the hood](#under-the-hood)): parsed into one common event shape, de-duplicated, and stored. Only usage counts and costs are kept, never prompts or conversations.

### 2. The bill report

For an uploaded bill the app works out:

- **Spend per month**: the bill's total, projected to 30 days if the bill covers fewer.
- **Seats**: distinct people on the bill, and cost per seat.
- **Underused seats**: anyone using under 20% of the average person's tokens.
- **Premium-model share**: how much of the spend goes to top-tier models (ChatGPT bills only; Copilot and Cursor exports don't name models).
- **Overlap**: people who also show up on the team's other AI bills, i.e. paid for twice.
- **Seat-billed vs usage-billed**: an export with no per-message costs is treated as a seat plan, and current spend is estimated from the plan's list price.

### 3. The comparison

The same usage is re-priced on every plan in the pricing catalog (`backend/app/pricing/catalog.json`), which covers OpenAI, Anthropic, Google, GitHub and Cursor with a lower and a premium tier each:

- **Seat plans**: seats × monthly price, never below the plan's minimum seat count (the row says so when a minimum applies).
- **Pay-per-token APIs**: monthly tokens × list rate, assuming 75% input and 25% output tokens. Shown in a separate, collapsed list, since they need your own app or API client.
- **Fit**: low-tier seat plans are flagged "may hit usage caps" above roughly 2M tokens per seat per month.

### 4. How the recommendation is chosen

1. **Only like-for-like products are recommended.** Every plan has a product type: chat assistant, office suite with AI, coding assistant (IDE plugin or AI editor), or API. A ChatGPT bill is only matched against other chat assistants; a Copilot or Cursor bill against coding assistants.
2. **Among those, the cheapest seat plan with no usage-cap risk wins**, if it costs less than what you pay today. The card says why ("cheapest chat assistant for 8 seats at your usage") plus a one-line note on what the product is.
3. **Everything else is advice, not the headline:**
   - *Quick win*: on seat-billed plans, what dropping the underused seats saves before switching anything.
   - *Cheaper, different product*: e.g. Google Workspace is cheaper per seat than ChatGPT Business, but it's a whole office suite, so it's mentioned, never recommended in its place.
   - *Using the API directly*: the cheapest per-token option for the same usage.
4. **If you already pay less than every alternative**, the app says so instead of inventing a switch.

### 5. Checks before you trust a number

- **Implausible prices.** If a per-token bill works out to more than 3× the priciest API list rate in the catalog, the app shows a warning and **does not recommend a switch**: the file is probably wrong, and any savings figure would be too.
- **Low confidence** is shown when the bill covers under 28 days, costs are still pending, or spend had to be estimated from list price.
- **Price sources.** Each price is marked `official` (read from the vendor's pricing page) or `third-party` (from 2026 pricing guides) and links to the vendor page. Prices carry an "as of" date.

### 6. After the report

- **"I switched"** records the switch. Savings are recomputed on the server (never taken from the browser) and the header keeps a running "saving $X/mo" total. Undo is one click.
- **Share with team** copies a link (`?team=<id>`) that opens the same workspace on another device. There are no logins yet, so anyone with the link sees the team's bills.
- **Privacy**: each team only ever sees its own bills and events.
- **Free tier**: 2 analyses (bill uploads or plan entries) per team; after that uploads return `402` and the Pro plan (unlimited compares, monthly monitoring, price research) is shown as coming soon.

### Try it

- Click **try a sample bill** in the app, or
- Generate two realistic 30-day ChatGPT bills and upload them:

  ```bash
  cd backend && python scripts/make_test_bills.py ./test-bills
  ```

  | File | Situation | What you should see |
  |---|---|---|
  | `chatgpt-api-team.json` | 8 people on per-token billing, about $66/month | "You're already paying less than any other chat assistant", plus the cheaper-API tip |
  | `chatgpt-business-seats.json` | 12-seat plan; 2 people barely use it and 1 never does | 11 seats seen (the unused one isn't in the export), a switch to the cheapest chat assistant, and a quick win for dropping the 2 idle seats |

### Known limitations

- **Parsers read this project's export format, not the vendors' real exports yet.** Real ChatGPT, Copilot and Cursor admin exports have different fields; adding them needs real (anonymized) sample exports.
- **Seats with zero usage are invisible.** A usage export only lists people who used the tool, so a paid seat nobody touched won't show up. Use "No export? Just tell us your plan" with your real seat count.
- **Price, not quality.** The comparison is about cost and product type; it doesn't judge which model is better for your work.
- **Token split is assumed** (75% input / 25% output), since exports only give totals.
- **Prices change.** Update `catalog.json` and its `as_of` date when vendors change pricing; `third-party` prices should be re-checked against `official_url`.

## API

| Endpoint | Purpose |
|---|---|
| `POST /bills/{source}` | Upload a bill (`chatgpt`, `copilot`, `cursor`) → report + comparison (402 once the free quota is used) |
| `POST /bills/{source}/sample` | Same, using a built-in sample bill (free) |
| `GET /bills`, `GET /bills/{id}` | The team's bills and one bill's report |
| `POST /compare/manual` | Compare from `{plan_id, seats, monthly_spend_cents?}`, no file |
| `GET /compare/manual`, `GET /compare/manual/{id}` | The team's plan entries and one comparison |
| `POST /switches`, `DELETE /switches/{kind}/{ref_id}` | Record or undo "I switched to plan X" |
| `GET /team` | Plan, free analyses left, switches and monthly savings |
| `GET /pricing/catalog` | The pricing catalog |
| `GET /metrics/*` | Team-scoped usage metrics (active users, cost by tool, recent events) |
| `POST /ingest/{source}` | Raw ingest without a bill (used by tests and the pipeline demo) |

Every endpoint except `/ingest`, `/pricing/catalog` and `/status` needs an `X-Team-Id` header (the frontend generates one per browser).

## Under the hood

Usage and cost data arrive from each vendor in its own format and billing cadence. The ingest pipeline turns that into one trustworthy set of events:

| Problem | Solution |
|---|---|
| Sources arrive in incompatible shapes | One canonical `AIUsageEvent` schema; a parser per vendor converges on it |
| Every source can redeliver the same event | Deterministic `dedup_key` (hash of source + raw event id), upsert-not-insert |
| Cost data arrives late, separately from usage | `cost_cents` is nullable; a later batch with the same key fills it in place |
| A vendor renames a field and nothing throws | `drift_detector.py` baselines each vendor's key paths and flags missing keys |
| A parser fix for one vendor silently breaks another | pytest replay harness + output snapshots per vendor fixture |
| Linking the same person across tools without guessing | `identity_resolver.py` links identities only with a recorded `proof_type` |
| Remote database latency | Ingest looks up existing events in batches and each person once, not per event |

### Layout

```
backend/
  app/
    main.py                # FastAPI app, metrics endpoints
    bills.py               # bills, manual compares, switches, team quota
    bill_analysis.py       # per-bill report
    simulator.py           # re-pricing, recommendation, sanity checks
    pricing/catalog.json   # plans, prices, product types, sources
    parsers/               # one parser per vendor export
    ingest.py              # dedup + upsert + late-cost backfill
    identity_resolver.py   # proof-based identity linking
    drift_detector.py      # schema drift per vendor
    models/                # SQLModel tables
    samples/               # built-in sample bills
  scripts/make_test_bills.py
  tests/                   # replay, analysis, comparison and API tests
frontend/
  src/
    App.tsx                # page shell
    CompareFlow.tsx        # pick tool -> upload bill / enter plan -> report
    ComparisonView.tsx     # recommendation, plan list, "I switched"
    BillReport.tsx         # per-bill stats, findings, breakdowns
    api/client.ts          # typed API client, team id handling
```

## Tech stack

- **Backend:** FastAPI, SQLModel/SQLAlchemy, PostgreSQL ([Neon](https://neon.tech)), pytest. Versions are pinned in `backend/requirements.txt`.
- **Frontend:** React + TypeScript (Vite), Tailwind CSS v4, TanStack Query, Axios.
- **Hosting:** backend on Render (auto-deploys `main`), frontend on Vercel.

All config (API base URL, database URL) comes from environment variables.

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt pytest httpx
```

Create `backend/.env`:

```
DATABASE_URL=postgresql://<your-neon-connection-string>
```

Run the API (docs at `http://localhost:8000/docs`) and the tests:

```bash
uvicorn app.main:app --reload --port 8000
pytest
```

### Frontend

```bash
cd frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:8000" > .env
npm run dev                     # http://localhost:5173
```

## What I'd build next

- Parsers for real ChatGPT, Copilot and Cursor admin exports, plus Claude and Gemini
- Accounts and logins to replace share links
- Price-change alerts and monthly monitoring (the Pro plan)
- Alembic migrations instead of `create_all()`
