from datetime import datetime, timedelta

from app.bill_analysis import analyze_bill
from app.models.canonical_event import AIUsageEvent
from app.simulator import compare_bill

START = datetime(2026, 9, 1)


def event(user, model="gpt-4o", cost=100, tokens=10_000, day=0):
    return AIUsageEvent(dedup_key=f"{user}-{day}-{model}", source="chatgpt", user_email=user, tool_name=model,
                        event_type="chat_message", occurred_at=START + timedelta(days=day),
                        cost_cents=cost, tokens=tokens, raw_payload="{}")


def month_of_usage():
    # 3 active users across 30 days, plus one user who barely touches it
    evs = [event(u, day=d) for u in ("a@x.com", "b@x.com", "c@x.com") for d in range(0, 30, 3)]
    evs.append(event("idle@x.com", model="gpt-4o-mini", cost=1, tokens=100, day=29))
    return evs


def test_report_totals_and_findings():
    report = analyze_bill(month_of_usage())
    assert report["seats"] == 4
    assert report["period_days"] == 29
    assert report["total_cost_cents"] == 30 * 100 + 1
    assert report["underused_seats"] == ["idle@x.com"]
    assert any("premium-tier" in f for f in report["findings"])


def test_report_flags_pending_costs_and_overlap():
    evs = [event("a@x.com", cost=None), event("b@x.com")]
    report = analyze_bill(evs, {"a@x.com": {"Cursor"}})
    assert report["pending_cost_events"] == 1
    assert report["overlap"] == {"a@x.com": ["Cursor"]}


def test_compare_recommends_cheapest_seat_plan_that_fits():
    report = analyze_bill(month_of_usage())
    result = compare_bill("chatgpt", report)
    seat_costs = [o["monthly_cents"] for o in result["options"] if o["pricing"] == "seat"]
    assert result["category"] == "assistant"
    assert all(o["plan_id"] not in ("copilot-business", "cursor-teams") for o in result["options"])
    best = min((o for o in result["options"] if o["pricing"] == "seat" and o["fit"] == "ok"), key=lambda o: o["monthly_cents"])
    assert best["monthly_cents"] == min(seat_costs)
    if result["recommendation"]["plan_id"]:
        assert result["recommendation"]["savings_cents"] == result["current_monthly_cents"] - min(seat_costs)


def test_compare_respects_min_seats():
    report = analyze_bill([event("a@x.com", day=d) for d in range(30)])
    claude = next(o for o in compare_bill("chatgpt", report)["options"] if o["plan_id"] == "claude-team-standard")
    assert claude["monthly_cents"] == 5 * 2500  # 1 user still pays for the 5-seat minimum


def test_compare_estimates_from_list_price_when_bill_has_no_cost():
    evs = [AIUsageEvent(dedup_key=f"k{i}", source="copilot", user_email=f"u{i}@x.com", tool_name="GitHub Copilot",
                        event_type="suggestion_accepted", occurred_at=START + timedelta(days=i),
                        cost_cents=None, tokens=200, raw_payload="{}") for i in range(30)]
    result = compare_bill("copilot", analyze_bill(evs))
    assert result["current_basis"] == "list_price"
    assert result["current_monthly_cents"] == 30 * 1900
    assert {o["vendor"] for o in result["options"]} == {"GitHub", "Cursor"}
    assert result["recommendation"]["plan_id"] is None


def test_short_bill_is_low_confidence():
    result = compare_bill("chatgpt", analyze_bill([event("a@x.com"), event("b@x.com")]))
    assert result["confidence"] == "low"


def test_product_named_exports_skip_model_tier_finding():
    evs = [event("a@x.com", model="Cursor"), event("b@x.com", model="Cursor")]
    report = analyze_bill(evs, names_are_models=False)
    assert not any("premium-tier" in f for f in report["findings"])
    assert report["by_model"][0]["tier"] is None
