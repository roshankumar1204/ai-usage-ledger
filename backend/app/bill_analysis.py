"""Per-bill report: what one uploaded bill says about spend, seats and usage."""
import math
from collections import defaultdict
from datetime import datetime, timezone

from app.models.canonical_event import AIUsageEvent
from app.pricing.catalog import model_tier

# A seat using less than this share of the average seat's tokens is flagged as underused
UNDERUSED_SHARE = 0.2


def _utc_naive(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def period_days(events: list[AIUsageEvent]) -> int:
    times = [_utc_naive(e.occurred_at) for e in events]
    span = (max(times) - min(times)).total_seconds() / 86400
    return max(1, math.ceil(span))


def analyze_bill(events: list[AIUsageEvent], other_tools_by_user: dict[str, set[str]] | None = None,
                 names_are_models: bool = True) -> dict:
    """other_tools_by_user: tools each person also appears on in the team's other bills (for overlap).
    names_are_models: False for exports whose tool_name is the product (Copilot, Cursor), not a model."""
    if not events:
        return {"empty": True, "findings": ["This bill has no usage events."]}

    times = [_utc_naive(e.occurred_at) for e in events]
    total_cost = sum(e.cost_cents or 0 for e in events)
    pending = sum(1 for e in events if e.cost_cents is None)
    total_tokens = sum(e.tokens or 0 for e in events)

    by_user: dict[str, dict] = defaultdict(lambda: {"events": 0, "tokens": 0, "cost_cents": 0})
    by_model: dict[str, dict] = defaultdict(lambda: {"events": 0, "tokens": 0, "cost_cents": 0})
    for e in events:
        for bucket in (by_user[e.user_email], by_model[e.tool_name]):
            bucket["events"] += 1
            bucket["tokens"] += e.tokens or 0
            bucket["cost_cents"] += e.cost_cents or 0

    seats = len(by_user)
    avg_tokens = total_tokens / seats if seats else 0
    underused = sorted(u for u, s in by_user.items() if avg_tokens and s["tokens"] < UNDERUSED_SHARE * avg_tokens)
    tier = model_tier if names_are_models else (lambda _: None)
    premium_cost = sum(s["cost_cents"] for m, s in by_model.items() if tier(m) == "high")

    overlap = {}
    for user in by_user:
        others = (other_tools_by_user or {}).get(user, set())
        if others:
            overlap[user] = sorted(others)

    findings = []
    if pending == len(events):
        findings.append("This export has no per-message costs, which is normal for seat-billed plans; "
                        "spend is estimated from the plan's list price.")
    elif pending:
        findings.append(f"{pending} of {len(events)} events have no cost yet (billing data arrives later); totals will rise when it does.")
    if underused:
        verb = "uses" if len(underused) == 1 else "use"
        findings.append(f"{len(underused)} of {seats} seats {verb} under {int(UNDERUSED_SHARE * 100)}% of the average seat's tokens: {', '.join(underused)}.")
    if total_cost and premium_cost:
        findings.append(f"{round(100 * premium_cost / total_cost)}% of spend goes to premium-tier models.")
    if overlap:
        findings.append(f"{len(overlap)} people also appear on other AI bills you uploaded, so you may be paying twice for them.")
    if not findings:
        findings.append("No obvious waste in this bill.")

    return {
        "empty": False,
        "period_start": min(times).isoformat(),
        "period_end": max(times).isoformat(),
        "period_days": period_days(events),
        "events": len(events),
        "seats": seats,
        "total_cost_cents": total_cost,
        "pending_cost_events": pending,
        "total_tokens": total_tokens,
        "cost_per_seat_cents": round(total_cost / seats) if seats else 0,
        "cost_per_1k_tokens_cents": round(1000 * total_cost / total_tokens, 2) if total_tokens else None,
        "by_user": sorted(({"user": u, **s} for u, s in by_user.items()), key=lambda r: -r["cost_cents"]),
        "by_model": sorted(({"model": m, "tier": tier(m), **s} for m, s in by_model.items()), key=lambda r: -r["cost_cents"]),
        "underused_seats": underused,
        "overlap": overlap,
        "findings": findings,
    }
