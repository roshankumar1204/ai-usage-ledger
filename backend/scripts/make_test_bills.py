"""Write two realistic ChatGPT test bills (30 days, priced at approximate list rates) for trying the app.

    python scripts/make_test_bills.py [out_dir]

chatgpt-api-team.json       8 people on per-token billing (cost_usd on every message)
chatgpt-business-seats.json 12 seats on a seat plan (no per-message cost); 2 barely used, 1 never used
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

START = datetime(2026, 9, 1, tzinfo=timezone.utc)
# Approximate list prices, USD per million tokens (input, output)
RATES = {"gpt-4o": (2.50, 10.00), "gpt-4o-mini": (0.15, 0.60)}
INPUT_SHARE = 0.75

API_TEAM = {"priya@acme.io": (40, .8), "rahul@acme.io": (30, .6), "meera@acme.io": (25, .7), "arjun@acme.io": (20, .3),
            "sana@acme.io": (18, .5), "vikram@acme.io": (35, .9), "neha@acme.io": (12, .4), "dev@acme.io": (0.3, .2)}
SEAT_TEAM = {f"{name}@northwind.co": (per_day, .6) for name, per_day in [
    ("ana", 25), ("ben", 18), ("chen", 22), ("dina", 15), ("eli", 30), ("farah", 12), ("gus", 20), ("hana", 16),
    ("ivan", 14), ("jo", 0.2), ("kai", 0.15), ("lea", 0.1)]}


def make_bill(users: dict, seed: int, priced: bool) -> list[dict]:
    """users: email -> (messages per day, share of messages on the premium model)."""
    rng = random.Random(seed)
    rows = []
    for day in range(30):
        if (START + timedelta(days=day)).weekday() >= 5 and rng.random() < .7:
            continue  # quieter weekends
        for email, (per_day, premium) in users.items():
            for _ in range(int(per_day) + (rng.random() < per_day % 1)):
                model = "gpt-4o" if rng.random() < premium else "gpt-4o-mini"
                tokens = rng.randint(1500, 12000) if model == "gpt-4o" else rng.randint(400, 4000)
                rate_in, rate_out = RATES[model]
                cost = tokens * (INPUT_SHARE * rate_in + (1 - INPUT_SHARE) * rate_out) / 1e6
                ts = START + timedelta(days=day, hours=rng.randint(8, 20), minutes=rng.randint(0, 59))
                rows.append({"id": f"cgpt_{seed}_{len(rows) + 1:05d}", "email": email, "model": model,
                             "type": "chat_message", "created": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                             "usage": {"total_tokens": tokens}, "cost_usd": round(cost, 6) if priced else None})
    return rows


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in [("chatgpt-api-team.json", make_bill(API_TEAM, 11, priced=True)),
                       ("chatgpt-business-seats.json", make_bill(SEAT_TEAM, 22, priced=False))]:
        (out / name).write_text(json.dumps(rows, indent=2))
        print(f"{out / name}: {len(rows)} events")
