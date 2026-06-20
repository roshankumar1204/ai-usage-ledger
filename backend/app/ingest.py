from sqlmodel import Session, select
from app.models.canonical_event import AIUsageEvent
from app.parsers import chatgpt_enterprise, copilot_export, cursor_jsonl
from app.identity_resolver import resolve_identity


PARSERS = {
    "chatgpt": chatgpt_enterprise.parse,
    "copilot": copilot_export.parse,
    "cursor": cursor_jsonl.parse,
}

def ingest_batch(source: str, raw_text: str, session: Session) -> dict:
    if source not in PARSERS:
        raise ValueError(f"Unknown source: {source}")

    events = PARSERS[source](raw_text)
    inserted, updated = 0, 0

    for ev in events:
        identity_result = resolve_identity(ev["user_email"], source, session)
        ev["identity_status"] = identity_result["status"]
        existing = session.exec(
            select(AIUsageEvent).where(AIUsageEvent.dedup_key == ev["dedup_key"])
        ).first()

        if existing:
            # Late-arriving cost backfill: only patch if we now have cost and didn't before
            if existing.cost_cents is None and ev["cost_cents"] is not None:
                existing.cost_cents = ev["cost_cents"]
                session.add(existing)
                updated += 1
            # else: true duplicate, skip — this is the dedup in action
        else:
            session.add(AIUsageEvent(**ev))
            inserted += 1

    session.commit()
    return {"inserted": inserted, "updated": updated, "total_seen": len(events)}