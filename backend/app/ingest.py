from sqlmodel import Session, select
from app.models.canonical_event import AIUsageEvent
from app.parsers import chatgpt_enterprise, copilot_export, cursor_jsonl
from app.identity_resolver import resolve_identity


PARSERS = {
    "chatgpt": chatgpt_enterprise.parse,
    "copilot": copilot_export.parse,
    "cursor": cursor_jsonl.parse,
}

# Keep IN (...) lists well under database parameter limits
LOOKUP_CHUNK = 500


def ingest_batch(source: str, raw_text: str, session: Session) -> dict:
    if source not in PARSERS:
        raise ValueError(f"Unknown source: {source}")

    events = PARSERS[source](raw_text)
    inserted, updated = 0, 0

    # One round trip per chunk and per distinct person, not per event: the database is remote,
    # so per-event queries turned an 800-row bill into minutes of latency
    keys = list({ev["dedup_key"] for ev in events})
    existing: dict[str, AIUsageEvent] = {}
    for i in range(0, len(keys), LOOKUP_CHUNK):
        rows = session.exec(select(AIUsageEvent).where(AIUsageEvent.dedup_key.in_(keys[i:i + LOOKUP_CHUNK]))).all()
        existing.update({row.dedup_key: row for row in rows})
    identity_status = {email: resolve_identity(email, source, session)["status"]
                       for email in {ev["user_email"] for ev in events}}

    for ev in events:
        ev["identity_status"] = identity_status[ev["user_email"]]
        row = existing.get(ev["dedup_key"])

        if row:
            # Late-arriving cost backfill: only patch if we now have cost and didn't before
            if row.cost_cents is None and ev["cost_cents"] is not None:
                row.cost_cents = ev["cost_cents"]
                session.add(row)
                updated += 1
            # else: true duplicate, skip — this is the dedup in action
        else:
            row = AIUsageEvent(**ev)
            session.add(row)
            existing[ev["dedup_key"]] = row
            inserted += 1

    session.commit()
    return {"inserted": inserted, "updated": updated, "total_seen": len(events)}
