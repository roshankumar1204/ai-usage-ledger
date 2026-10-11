"""Re-prices a team's usage (from a bill, or from the plan they say they're on) under every catalog plan."""
from app.pricing.catalog import COMPATIBLE_TYPES, SOURCE_PROFILE, TYPE_LABELS, load_catalog

DAYS_PER_MONTH = 30
# Exports only give total tokens; assume this share is input (prompts + context) and the rest output
INPUT_SHARE = 0.75
# Rough heuristic: above this many tokens per seat per month, low-tier seats tend to hit usage caps
HEAVY_TOKENS_PER_SEAT = 2_000_000
# Less data than this and the monthly projection is shaky
MIN_DAYS_FOR_CONFIDENCE = 28
# A bill paying more than this multiple of the priciest API list rate is almost certainly a bad file
UNUSUAL_RATE_MULTIPLE = 3


def _seat_cost(plan: dict, seats: int) -> int:
    return max(seats, plan.get("min_seats", 1)) * plan["monthly_cents"]


def _token_cost(plan: dict, monthly_tokens: float) -> int:
    return round(monthly_tokens / 1_000_000 * _blended_rate(plan))


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
    if report["pending_cost_events"] and current_basis == "bill":
        reasons.append("Some costs are still pending, so current spend is understated.")
    warning = None
    if source == "chatgpt" and current_basis == "bill":
        warning = _unusual_rate_warning(report["total_cost_cents"], report["total_tokens"])
        if warning:
            reasons.insert(0, warning)
    result = compare_usage(profile["category"], profile["vendor"], profile["product_type"], seats, monthly_tokens,
                           current, current_basis, reasons)
    if warning:
        # Savings computed from implausible prices would be misleading: show the plans, recommend nothing
        result["recommendation"] = {
            "plan_id": None,
            "headline": "We can't recommend a switch until this bill's prices look right.",
            "reason": "Your current spend is read from the bill, so any savings figure would inherit its wrong prices. "
                      "The plans below are listed for reference.",
            "savings_cents": 0,
            "warning": warning,
        }
        return result
    # Only seat-billed plans charge for idle seats; on a usage-billed bill an idle person costs next to nothing
    idle = report["underused_seats"]
    if idle and current_basis == "list_price" and seats > len(idle):
        per_seat = current / seats
        verb = "is" if len(idle) == 1 else "are"
        result["recommendation"]["seat_tip"] = (
            f"{len(idle)} of {seats} seats {verb} barely used ({', '.join(idle)}). Removing "
            f"{'it' if len(idle) == 1 else 'them'} would save about ${len(idle) * per_seat / 100:,.2f}/month "
            f"on your current plan, before any switch.")
    return result


def _blended_rate(plan: dict) -> float:
    """Cents per million tokens at our input/output split."""
    return INPUT_SHARE * plan["input_per_mtok_cents"] + (1 - INPUT_SHARE) * plan["output_per_mtok_cents"]


def _unusual_rate_warning(cost_cents: int, tokens: int) -> str | None:
    """Per-token bills (ChatGPT exports carry per-message cost) can be checked against API list prices."""
    if not cost_cents or not tokens:
        return None
    rate = cost_cents / tokens * 1_000_000
    ceiling = max(_blended_rate(p) for p in load_catalog()["plans"] if p["pricing"] == "token")
    if rate <= UNUSUAL_RATE_MULTIPLE * ceiling:
        return None
    return (f"This bill works out to ${rate / 100:,.2f} per million tokens, {rate / ceiling:,.0f}x the priciest "
            f"API list rate we track (${ceiling / 100:,.2f}). Check the file before acting on these savings.")


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
    result = compare_usage(plan["category"], plan["vendor"], plan["product_type"], seats, 0, current, basis, reasons)
    result["current_plan_id"] = plan_id
    return result


def find_plan(plan_id: str) -> dict | None:
    return next((p for p in load_catalog()["plans"] if p["id"] == plan_id), None)


def compare_usage(category: str, vendor: str, product_type: str, seats: int, monthly_tokens: float,
                  current: int, current_basis: str, reasons: list[str]) -> dict:
    catalog = load_catalog()
    compatible = COMPATIBLE_TYPES.get(product_type, {product_type})
    heavy = seats and monthly_tokens / seats > HEAVY_TOKENS_PER_SEAT
    options = []
    for plan in catalog["plans"]:
        if plan["category"] != category:
            continue
        if plan["pricing"] == "seat":
            cost = _seat_cost(plan, seats)
            fit = "may hit usage caps" if heavy and plan["tier"] == "low" else "ok"
            if seats < plan.get("min_seats", 1):
                fit += f" · priced at the {plan['min_seats']}-seat minimum"
        else:
            if not monthly_tokens:
                continue
            cost = _token_cost(plan, monthly_tokens)
            fit = "needs your own app or API client"
        options.append({
            "plan_id": plan["id"],
            "vendor": plan["vendor"],
            "product": plan["product"],
            "product_type": plan["product_type"],
            "note": plan["note"],
            "same_kind": plan["product_type"] in compatible,
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

    # Recommend only drop-in replacements: seat plans of a compatible kind with no usage-cap risk
    drop_ins = [o for o in options if o["pricing"] == "seat" and o["same_kind"] and o["fit"].startswith("ok")]
    best = drop_ins[0] if drop_ins else None
    label = TYPE_LABELS.get(product_type, "plan")
    if best and best["savings_cents"] > 0:
        recommendation = {
            "plan_id": best["plan_id"],
            "headline": f"Switch to {best['product']} and save about ${best['savings_cents'] / 100:,.2f}/month.",
            "reason": f"It's the cheapest {label} for {seats} seat{'s' if seats != 1 else ''} at your usage. {best['note']}",
            "savings_cents": best["savings_cents"],
        }
    else:
        recommendation = {
            "plan_id": None,
            "headline": f"You're already paying less than any other {label} would cost for this usage.",
            "reason": f"We compared {len(drop_ins)} {label} plan{'s' if len(drop_ins) != 1 else ''} at the same seat count.",
            "savings_cents": 0,
        }

    # Cheaper, but a different kind of product: worth knowing, never the headline
    floor = best["monthly_cents"] if best else current
    other = next((o for o in options if o["pricing"] == "seat" and not o["same_kind"] and o["fit"].startswith("ok")
                  and o["monthly_cents"] < min(floor, current)), None)
    if other:
        recommendation["alt_tip"] = (f"{other['product']} would cost ${other['monthly_cents'] / 100:,.2f}/month, but it's a "
                                     f"different kind of product: {other['note']}")
    cheapest_api = next((o for o in options if o["pricing"] == "token"), None)
    if cheapest_api and cheapest_api["monthly_cents"] < min(current, floor):
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
            "Only plans of the same kind as yours are recommended; others are listed for reference.",
            f"Prices as of {catalog['as_of']}.",
        ],
        "options": options,
        "recommendation": recommendation,
    }
