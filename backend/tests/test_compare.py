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


def test_compare_only_lists_plans_in_the_same_category():
    result = compare_bill("chatgpt", analyze_bill(month_of_usage()))
    assert result["category"] == "assistant"
    assert all(o["plan_id"] not in ("copilot-business", "cursor-teams") for o in result["options"])


def expensive_chat_month(users=8):
    # $30 per user per month on a per-message bill at a plausible token rate: seat plans undercut it
    return [event(f"u{u}@x.com", cost=100, tokens=50_000, day=d) for u in range(users) for d in range(0, 30, 1)]


def test_recommendation_stays_with_the_same_kind_of_product():
    result = compare_bill("chatgpt", analyze_bill(expensive_chat_month()))
    rec = result["recommendation"]
    chosen = next(o for o in result["options"] if o["plan_id"] == rec["plan_id"])
    assert chosen["product_type"] == "chat_assistant"
    # Workspace is cheaper per seat but is an office suite: mentioned, never recommended
    assert rec["plan_id"] != "workspace-business-standard"
    assert "Workspace" in rec["alt_tip"]
    cheapest_chat = min(o["monthly_cents"] for o in result["options"] if o["product_type"] == "chat_assistant")
    assert chosen["monthly_cents"] == cheapest_chat
    assert rec["savings_cents"] == result["current_monthly_cents"] - cheapest_chat


def test_unusual_token_rates_are_flagged():
    absurd = [event("a@x.com", cost=50_000, tokens=1_000, day=d) for d in range(30)]  # $500 per 1K tokens
    result = compare_bill("chatgpt", analyze_bill(absurd))
    assert "Check the file" in result["recommendation"]["warning"]
    assert result["recommendation"]["plan_id"] is None
    assert result["confidence"] == "low"
    plausible = compare_bill("chatgpt", analyze_bill(expensive_chat_month()))
    assert "warning" not in plausible["recommendation"]


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


def test_min_seat_pricing_is_explained_in_fit():
    report = analyze_bill([event("a@x.com", day=d) for d in range(30)])
    claude = next(o for o in compare_bill("chatgpt", report)["options"] if o["plan_id"] == "claude-team-standard")
    assert "5-seat minimum" in claude["fit"]


def test_seat_billed_export_is_not_reported_as_pending():
    evs = [event(f"u{i}@x.com", cost=None, day=d) for i in range(6) for d in range(0, 30, 2)]
    report = analyze_bill(evs)
    assert "seat-billed" in report["findings"][0]
    result = compare_bill("chatgpt", report)
    assert result["current_basis"] == "list_price"
    assert not any("pending" in r for r in result["reasons"])


def test_underused_seats_are_priced_only_on_seat_billed_bills():
    seat_billed = [event(u, cost=None, day=d) for u in ("a@x.com", "b@x.com", "c@x.com") for d in range(0, 30, 3)]
    seat_billed.append(event("idle@x.com", cost=None, tokens=100, day=29))
    tip = compare_bill("chatgpt", analyze_bill(seat_billed))["recommendation"]["seat_tip"]
    assert "1 of 4 seats is barely used (idle@x.com)" in tip
    assert "$25.00/month" in tip  # one ChatGPT Business seat at list price
    usage_billed = compare_bill("chatgpt", analyze_bill(month_of_usage()))
    assert "seat_tip" not in usage_billed["recommendation"]
