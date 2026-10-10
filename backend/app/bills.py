"""Bill flow: upload a bill (or name your plan) -> report -> comparison -> track the switch."""
import re
from pathlib import Path

from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.bill_analysis import analyze_bill
from app.db import get_session
from app.ingest import PARSERS, ingest_batch
from app.models.bill import Bill, BillEvent, ManualCompare, SwitchDecision, Team
from app.models.canonical_event import AIUsageEvent
from app.pricing.catalog import load_catalog
from app.simulator import compare_bill, compare_manual, find_plan

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
    bills = session.exec(select(func.count(Bill.id)).where(Bill.team_id == team.id, Bill.is_sample == False)).one()  # noqa: E712
    manual = session.exec(select(func.count(ManualCompare.id)).where(ManualCompare.team_id == team.id)).one()
    return bills + manual


def _quota(team: Team, session: Session) -> dict:
    used = _analyses_used(team, session)
    switches = session.exec(select(SwitchDecision).where(SwitchDecision.team_id == team.id)).all()
    return {
        "plan": team.plan,
        "free_limit": FREE_ANALYSES,
        "used": used,
        "remaining": None if team.plan == "paid" else max(0, FREE_ANALYSES - used),
        "switches": len(switches),
        "monthly_savings_cents": sum(sw.from_monthly_cents - sw.to_monthly_cents for sw in switches),
    }


def _require_quota(team: Team, session: Session) -> None:
    if _quota(team, session)["remaining"] == 0:
        raise HTTPException(402, {
            "code": "free_limit_reached",
            "message": f"You've used your {FREE_ANALYSES} free analyses. Upgrade for unlimited compares and monthly monitoring.",
        })


def _switch_for(team_id: str, kind: str, ref_id: int, session: Session) -> Optional[SwitchDecision]:
    return session.exec(select(SwitchDecision).where(
        SwitchDecision.team_id == team_id, SwitchDecision.kind == kind, SwitchDecision.ref_id == ref_id)).first()


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
    switch = _switch_for(bill.team_id, "bill", bill.id, session)
    return {"bill": bill.model_dump(mode="json"), "report": report, "comparison": comparison,
            "switch": switch.model_dump(mode="json") if switch else None}


def _manual_result(mc: ManualCompare, session: Session) -> dict:
    switch = _switch_for(mc.team_id, "manual", mc.id, session)
    return {"manual": mc.model_dump(mode="json"),
            "comparison": compare_manual(mc.plan_id, mc.seats, mc.monthly_spend_cents),
            "switch": switch.model_dump(mode="json") if switch else None}


@router.get("/team")
def team_status(team: Team = Depends(get_team), session: Session = Depends(get_session)):
    return _quota(team, session)


@router.get("/pricing/catalog")
def pricing_catalog():
    return load_catalog()


@router.post("/bills/{source}")
async def upload_bill(source: str, file: UploadFile = File(...),
                      team: Team = Depends(get_team), session: Session = Depends(get_session)):
    _require_quota(team, session)
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


class ManualCompareIn(BaseModel):
    plan_id: str
    seats: int = Field(ge=1, le=100_000)
    monthly_spend_cents: Optional[int] = Field(default=None, ge=0)


@router.post("/compare/manual")
def create_manual_compare(body: ManualCompareIn, team: Team = Depends(get_team), session: Session = Depends(get_session)):
    plan = find_plan(body.plan_id)
    if not plan or plan["pricing"] != "seat":
        raise HTTPException(400, f"Unknown seat plan '{body.plan_id}'")
    _require_quota(team, session)
    mc = ManualCompare(team_id=team.id, **body.model_dump())
    session.add(mc)
    session.commit()
    session.refresh(mc)
    return _manual_result(mc, session)


@router.get("/compare/manual")
def list_manual_compares(team: Team = Depends(get_team), session: Session = Depends(get_session)):
    return session.exec(select(ManualCompare).where(ManualCompare.team_id == team.id)
                        .order_by(ManualCompare.created_at.desc())).all()


@router.get("/compare/manual/{compare_id}")
def get_manual_compare(compare_id: int, team: Team = Depends(get_team), session: Session = Depends(get_session)):
    mc = session.get(ManualCompare, compare_id)
    if not mc or mc.team_id != team.id:
        raise HTTPException(404, "Compare not found")
    return _manual_result(mc, session)


class SwitchIn(BaseModel):
    kind: Literal["bill", "manual"]
    ref_id: int
    plan_id: str


@router.post("/switches")
def record_switch(body: SwitchIn, team: Team = Depends(get_team), session: Session = Depends(get_session)):
    """Recomputes the comparison server-side so the recorded savings can't be made up by the client."""
    if body.kind == "bill":
        bill = session.get(Bill, body.ref_id)
        if not bill or bill.team_id != team.id:
            raise HTTPException(404, "Bill not found")
        comparison = _bill_result(bill, session)["comparison"]
    else:
        mc = session.get(ManualCompare, body.ref_id)
        if not mc or mc.team_id != team.id:
            raise HTTPException(404, "Compare not found")
        comparison = compare_manual(mc.plan_id, mc.seats, mc.monthly_spend_cents)
    option = next((o for o in (comparison or {}).get("options", []) if o["plan_id"] == body.plan_id), None)
    if not option:
        raise HTTPException(400, f"Plan '{body.plan_id}' isn't an option for this analysis")

    switch = _switch_for(team.id, body.kind, body.ref_id, session) or SwitchDecision(
        team_id=team.id, kind=body.kind, ref_id=body.ref_id, plan_id=body.plan_id, from_monthly_cents=0, to_monthly_cents=0)
    switch.plan_id = body.plan_id
    switch.from_monthly_cents = comparison["current_monthly_cents"]
    switch.to_monthly_cents = option["monthly_cents"]
    session.add(switch)
    session.commit()
    session.refresh(switch)
    return {"switch": switch.model_dump(mode="json"), "team": _quota(team, session)}


@router.delete("/switches/{kind}/{ref_id}")
def undo_switch(kind: Literal["bill", "manual"], ref_id: int, team: Team = Depends(get_team),
                session: Session = Depends(get_session)):
    switch = _switch_for(team.id, kind, ref_id, session)
    if switch:
        session.delete(switch)
        session.commit()
    return {"team": _quota(team, session)}


def team_event_keys(team: Team):
    """Subquery of the dedup keys on this team's bills: everything a team can see in the ledger."""
    return select(BillEvent.dedup_key).join(Bill, Bill.id == BillEvent.bill_id).where(Bill.team_id == team.id)
