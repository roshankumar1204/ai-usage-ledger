import json, hashlib
from datetime import datetime

def parse(raw_text: str) -> list[dict]:
    events = []
    for line in raw_text.strip().splitlines():
        r = json.loads(line)
        dedup_key = hashlib.sha256(f"cursor:{r['eventId']}".encode()).hexdigest()
        events.append({
            "dedup_key": dedup_key,
            "source": "cursor",
            "user_email": r["actor"]["email"],
            "tool_name": r["product"],
            "event_type": r["kind"],
            "occurred_at": datetime.fromtimestamp(r["ts"]),
            "cost_cents": r["meta"]["cost"]["amount_cents"],
            "tokens": r["meta"]["tokens"],
            "raw_payload": json.dumps(r),
        })
    return events