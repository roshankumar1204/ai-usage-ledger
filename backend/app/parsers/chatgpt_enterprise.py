import json, hashlib
from datetime import datetime

def parse(raw_text: str) -> list[dict]:
    records = json.loads(raw_text)
    events = []
    for r in records:
        dedup_key = hashlib.sha256(f"chatgpt:{r['id']}".encode()).hexdigest()
        cost = r.get("cost_usd")
        events.append({
            "dedup_key": dedup_key,
            "source": "chatgpt",
            "user_email": r["email"],
            "tool_name": r["model"],
            "event_type": r["type"],
            "occurred_at": datetime.fromisoformat(r["created"].replace("Z", "+00:00")),
            "cost_cents": int(cost * 100) if cost is not None else None,
            # "tokens": r["usage"]["total_tokens"],
            "tokens": r.get("usage", {}).get("total_tokens"),
            "raw_payload": json.dumps(r),
        })
    return events