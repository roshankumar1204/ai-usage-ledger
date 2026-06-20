import csv, io, hashlib
from datetime import datetime

def parse(raw_text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(raw_text))
    events = []
    for r in reader:
        dedup_key = hashlib.sha256(f"copilot:{r['record_id']}".encode()).hexdigest()
        amount = r.get("billed_amount", "").strip()
        events.append({
            "dedup_key": dedup_key,
            "source": "copilot",
            "user_email": r["user"],
            "tool_name": r["tool"],
            "event_type": r["action"],
            "occurred_at": datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")),
            "cost_cents": int(float(amount) * 100) if amount else None,
            "tokens": int(r["token_count"]),
            "raw_payload": str(r),
        })
    return events