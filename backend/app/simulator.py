"""Re-prices a team's usage (from a bill, or from the plan they say they're on) under every catalog plan."""
from app.pricing.catalog import SOURCE_PROFILE, load_catalog

DAYS_PER_MONTH = 30
# Exports only give total tokens; assume this share is input (prompts + context) and the rest output
INPUT_SHARE = 0.75
# Rough heuristic: above this many tokens per seat per month, low-tier seats tend to hit usage caps
HEAVY_TOKENS_PER_SEAT = 2_000_000
# Less data than this and the monthly projection is shaky
MIN_DAYS_FOR_CONFIDENCE = 28


def _seat_cost(plan: dict, seats: int) -> int:
    return max(seats, plan.get("min_seats", 1)) * plan["monthly_cents"]


def _token_cost(plan: dict, monthly_tokens: float) -> int:
    mtok = monthly_tokens / 1_000_000
    return round(mtok * (INPUT_SHARE * plan["input_per_mtok_cents"] + (1 - INPUT_SHARE) * plan["output_per_mtok_cents"]))


def compare_bill(source: str, report: dict) -> dict:
    profile = SOURCE_PROFILE[source]
    catalog = load_catalog()
    days = report["period_days"]
    scale = DAYS_PER_MONTH / days
    seats = report["seats"]
    monthly_tokens = report["total_tokens"] * scale

    reasons = []
    current = round(report["total_cost_cents"] * scale)
    current_basis = "bill"
    if current == 0:
        # Seat-billed exports often carry no per-event cost: fall back to the vendor's list price
        list_plan = next(p for p in catalog["plans"]
                         if p["vendor"] == profile["vendor"] and p["pricing"] == "seat" and p["tier"] == "low")
        current = _seat_cost(list_plan, seats)
        current_basis = "list_price"
        reasons.append(f"Bill has no costs, so current spend is estimated from {list_plan['product']} list price.")
    if days < MIN_DAYS_FOR_CONFIDENCE:
        reasons.append(f"Only {days} day(s) of data; monthly figures are projected and may be off.")
    if report["pending_cost_events"]:
        reasons.append("Some costs are still pending, so current spend is understated.")
    return compare_usage(profile["category"], profile["vendor"], seats, monthly_tokens, current, current_basis, reasons)


def compare_manual(plan_id: str, seats: int, monthly_spend_cents: int | None = None) -> dict:
    """No export: the team tells us which seat plan they're on, how many seats, and optionally what they pay."""
    plan = find_plan(plan_id)
    if not plan or plan["pricing"] != "seat":
        raise ValueError(f"Unknown seat plan '{plan_id}'")
    if monthly_spend_cents is None:
        current, basis = seats * plan["monthly_cents"], "list_price"
        reasons = [f"Current spend estimated as {seats} \u00d7 {plan['product']} list price."]
    else:
        current, basis, reasons = monthly_spend_cents, "entered", []
    result = compare_usage(plan["category"], plan["vendor"], seats, 0, current, basis, reasons)
    result["current_plan_id"] = plan_id
    return result


def find_plan(plan_id: str) -> dict | None:
    return next((p for p in load_catalog()["plans"] if p["id"] == plan_id), None)


def compare_usage(category: str, vendor: str, seats: int, monthly_tokens: float,
                  current: int, current_basis: str, reasons: list[str]) -> dict:
    catalog = load_catalog()
    heavy = seats and monthly_tokens / seats > HEAVY_TOKENS_PER_SEAT
    options = []
    for plan in catalog["plans"]:
        if plan["category"] != category:
            continue
        if plan["pricing"] == "seat":
            cost = _seat_cost(plan, seats)
            fit = "may hit usage caps" if heavy and plan["tier"] == "low" else "ok"
        else:
            if not monthly_tokens:
                continue
            cost = _token_cost(plan, monthly_tokens)
            fit = "needs your own app or API client"
        options.append({
            "plan_id": plan["id"],
            "vendor": plan["vendor"],
            "product": plan["product"],
            "pricing": plan["pricing"],
            "tier": plan["tier"],
            "monthly_cents": cost,
            "savings_cents": current - cost,
            "is_current_vendor": plan["vendor"] == vendor,
            "fit": fit,
            "confidence": plan["confidence"],
            "official_url": plan["official_url"],
        })
    options.sort(key=lambda o: o["monthly_cents"])

    # Recommend among drop-in seat plans first; token plans need engineering work to adopt
    candidates = [o for o in options if o["pricing"] == "seat" and o["fit"] == "ok"] or options
    best = min(candidates, key=lambda o: o["monthly_cents"], default=None)
    if best and best["savings_cents"] > 0:
        recommendation = {
            "plan_id": best["plan_id"],
            "headline": f"Switch to {best['product']} and save about ${best['savings_cents'] / 100:,.2f}/month.",
            "savings_cents": best["savings_cents"],
        }
    else:
        recommendation = {"plan_id": None, "headline": "Your current spend is already lower than any plan that fits this usage.", "savings_cents": 0}
    cheapest_api = next((o for o in options if o["pricing"] == "token"), None)
    if cheapest_api and cheapest_api["monthly_cents"] < min(current, best["monthly_cents"] if best else current):
        recommendation["api_tip"] = (f"If your team can use an API directly, {cheapest_api['product']} would cost about "
                                     f"${cheapest_api['monthly_cents'] / 100:,.2f}/month for the same tokens.")

    return {
        "category": category,
        "current_monthly_cents": current,
        "current_basis": current_basis,
        "monthly_tokens": round(monthly_tokens),
        "seats": seats,
        "confidence": "low" if reasons else "normal",
        "reasons": reasons,
        "assumptions": [
            f"{int(INPUT_SHARE * 100)}% of tokens are input, {100 - int(INPUT_SHARE * 100)}% output.",
            "Seat plans priced at monthly billing; annual billing is usually cheaper.",
            f"Prices as of {catalog['as_of']}.",
        ],
        "options": options,
        "recommendation": recommendation,
    }
