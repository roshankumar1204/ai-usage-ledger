"""Phase 1 bill flow: upload a bill -> per-bill report -> comparison against the pricing catalog."""
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.bill_analysis import analyze_bill
from app.db import get_session
from app.ingest import PARSERS, ingest_batch
from app.models.bill import Bill, BillEvent, Team
from app.models.canonical_event import AIUsageEvent
from app.pricing.catalog import load_catalog
from app.simulator import compare_bill

FREE_ANALYSES = 2
SAMPLES_DIR = Path(__file__).parent / "samples"
SAMPLE_FILES = {"chatgpt": "chatgpt.json", "copilot": "copilot.csv", "cursor": "cursor.jsonl"}
TOOL_LABELS = {"chatgpt": "ChatGPT", "copilot": "GitHub Copilot", "cursor": "Cursor"}
TEAM_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")

router = APIRouter()


def get_team(x_team_id: str = Header(...), session: Session = Depends(get_session)) -> Team:
    if not TEAM_ID_RE.match(x_team_id):
        raise HTTPException(400, "Invalid X-Team-Id header")
    team = session.get(Team, x_team_id)
    if not team:
        team = Team(id=x_team_id)
        session.add(team)
        session.commit()
        session.refresh(team)
    return team


def _analyses_used(team: Team, session: Session) -> int:
    stmt = select(func.count(Bill.id)).where(Bill.team_id == team.id, Bill.is_sample == False)  # noqa: E712
    return session.exec(stmt).one()


def _quota(team: Team, session: Session) -> dict:
    used = _analyses_used(team, session)
    return {
        "plan": team.plan,
        "free_limit": FREE_ANALYSES,
        "used": used,
        "remaining": None if team.plan == "paid" else max(0, FREE_ANALYSES - used),
    }


def _create_bill(team: Team, source: str, filename: str, raw_text: str, is_sample: bool, session: Session) -> dict:
    if source not in PARSERS:
        raise HTTPException(400, f"Unknown source '{source}'")
    try:
        keys = list(dict.fromkeys(e["dedup_key"] for e in PARSERS[source](raw_text)))
    except Exception:
        raise HTTPException(400, f"Couldn't read this file as a {TOOL_LABELS[source]} export")
    if not keys:
        raise HTTPException(400, "This file has no usage events")

    ingest_batch(source, raw_text, session)
    bill = Bill(team_id=team.id, source=source, filename=filename, is_sample=is_sample, event_count=len(keys))
    session.add(bill)
    session.commit()
    session.refresh(bill)
    session.add_all(BillEvent(bill_id=bill.id, dedup_key=k) for k in keys)
    session.commit()
    return _bill_result(bill, session)


def _bill_result(bill: Bill, session: Session) -> dict:
    events = session.exec(
        select(AIUsageEvent).join(BillEvent, BillEvent.dedup_key == AIUsageEvent.dedup_key)
        .where(BillEvent.bill_id == bill.id)
    ).all()

    # People on this bill who also show up on the team's bills for other tools
    rows = session.exec(
        select(AIUsageEvent.user_email, Bill.source)
        .join(BillEvent, BillEvent.dedup_key == AIUsageEvent.dedup_key)
        .join(Bill, Bill.id == BillEvent.bill_id)
        .where(Bill.team_id == bill.team_id, Bill.source != bill.source)
    ).all()
    other_tools: dict[str, set[str]] = {}
    for email, src in rows:
        other_tools.setdefault(email, set()).add(TOOL_LABELS[src])

    report = analyze_bill(list(events), other_tools, names_are_models=bill.source == "chatgpt")
    comparison = None if report["empty"] else compare_bill(bill.source, report)
    return {"bill": bill.model_dump(mode="json"), "report": report, "comparison": comparison}


@router.get("/team")
def team_status(team: Team = Depends(get_team), session: Session = Depends(get_session)):
    return _quota(team, session)


@router.get("/pricing/catalog")
def pricing_catalog():
    return load_catalog()


@router.post("/bills/{source}")
async def upload_bill(source: str, file: UploadFile = File(...),
                      team: Team = Depends(get_team), session: Session = Depends(get_session)):
    quota = _quota(team, session)
    if quota["remaining"] == 0:
        raise HTTPException(402, {
            "code": "free_limit_reached",
            "message": f"You've used your {FREE_ANALYSES} free bill analyses. Upgrade for unlimited compares and monthly monitoring.",
        })
    try:
        raw_text = (await file.read()).decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be a text export (JSON, CSV or JSONL)")
    return _create_bill(team, source, file.filename or "upload", raw_text, False, session)


@router.post("/bills/{source}/sample")
def sample_bill(source: str, team: Team = Depends(get_team), session: Session = Depends(get_session)):
    if source not in SAMPLE_FILES:
        raise HTTPException(400, f"Unknown source '{source}'")
    raw_text = (SAMPLES_DIR / SAMPLE_FILES[source]).read_text()
    return _create_bill(team, source, f"sample {SAMPLE_FILES[source]}", raw_text, True, session)


@router.get("/bills")
def list_bills(team: Team = Depends(get_team), session: Session = Depends(get_session)):
    return session.exec(select(Bill).where(Bill.team_id == team.id).order_by(Bill.uploaded_at.desc())).all()


@router.get("/bills/{bill_id}")
def get_bill(bill_id: int, team: Team = Depends(get_team), session: Session = Depends(get_session)):
    bill = session.get(Bill, bill_id)
    if not bill or bill.team_id != team.id:
        raise HTTPException(404, "Bill not found")
    return _bill_result(bill, session)
