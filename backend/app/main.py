from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Session, select, func
from app.db import engine, get_session
from app.models.canonical_event import AIUsageEvent
from app.ingest import ingest_batch, PARSERS
from app.drift_detector import check_drift, flatten_keys
import json

app = FastAPI(title="AI Usage Ledger")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for prod
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

# ---------- INGEST ----------
@app.post("/ingest/{source}")
async def ingest(source: str, file: UploadFile = File(...), session: Session = Depends(get_session)):
    if source not in PARSERS:
        raise HTTPException(400, f"Unknown source '{source}'")

    raw_text = (await file.read()).decode("utf-8")

    # Drift check on first record before we even parse fully
    try:
        if source == "copilot":
            import csv, io
            reader = csv.DictReader(io.StringIO(raw_text))
            sample = next(reader)
        elif source == "cursor":
            sample = json.loads(raw_text.strip().splitlines()[0])
        else:
            sample = json.loads(raw_text)[0]
        drift = check_drift(source, sample)
    except Exception:
        drift = {"status": "unchecked"}

    result = ingest_batch(source, raw_text, session)
    result["drift"] = drift
    return result

# ---------- METRICS (single source of truth) ----------
@app.get("/metrics/active-users")
def active_users(session: Session = Depends(get_session)):
    stmt = select(func.count(func.distinct(AIUsageEvent.user_email)))
    return {"active_users_this_week": session.exec(stmt).one()}

@app.get("/metrics/cost-by-tool")
def cost_by_tool(session: Session = Depends(get_session)):
    stmt = (
        select(AIUsageEvent.tool_name, func.sum(AIUsageEvent.cost_cents))
        .group_by(AIUsageEvent.tool_name)
    )
    rows = session.exec(stmt).all()
    return [{"tool": t, "cost_cents": c or 0} for t, c in rows]

@app.get("/metrics/events")
def list_events(session: Session = Depends(get_session)):
    stmt = select(AIUsageEvent).order_by(AIUsageEvent.occurred_at.desc()).limit(50)
    return session.exec(stmt).all()

@app.get("/status")
def status_check():
    return {"status": "ok"}