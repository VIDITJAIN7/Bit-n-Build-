"""Rules grant authority; the risk score is an explanation aid, not permission."""

from .seed import now_iso

KINDS = ("purchase", "work_order", "field_check", "notify")


def money(cents):
    return f"${cents / 100:,.0f}" if cents % 100 == 0 else f"${cents / 100:,.2f}"


def refresh_daily_budget(state):
    day = now_iso()[:10]
    if state["wallet"]["agent_spend_day"] != day:
        state["wallet"]["agent_spend_day"] = day
        state["wallet"]["agent_spent_cents"] = 0


def evaluate(state, action):
    policy = state["policy"]
    amount = action["amount_cents"]
    reasons = []
    hard_blocks = []
    if (
        action["kind"] not in KINDS
        or isinstance(amount, bool)
        or not isinstance(amount, int)
        or amount < 0
    ):
        hard_blocks.append("Unsupported action or invalid amount")
    elif action["kind"] != "purchase" and amount:
        hard_blocks.append("Only purchases can move funds")
    if not action.get("evidence"):
        reasons.append("Operational evidence is missing")
    if action["kind"] == "purchase" and not hard_blocks:
        supplier = next(
            (s for s in state["suppliers"] if s["id"] == action.get("supplier_id")), None
        )
        if not supplier or not supplier["approved"]:
            reasons.append("Supplier has not been approved")
        if action.get("recipient") not in policy["known_recipients"]:
            reasons.append("New payment destination")
        elif supplier and action.get("recipient") != supplier["recipient"]:
            reasons.append("Payment destination does not match the supplier record")
        if amount > policy["agent_per_action_cents"]:
            limit = money(policy["agent_per_action_cents"])
            reasons.append(f"Above the {limit} autonomous transaction limit")
        if state["wallet"]["agent_spent_cents"] + amount > policy["agent_daily_cents"]:
            reasons.append("Exceeds the remaining autonomous daily budget")
        typical = policy.get("typical_purchase_cents")
        if typical and amount >= 3 * typical:
            reasons.append(f"Purchase is {amount / typical:.1f}× larger than typical site purchases")
        if amount > policy["supervisor_limit_cents"]:
            limit = money(policy["supervisor_limit_cents"])
            hard_blocks.append(f"Above the operating wallet's {limit} transaction limit")
        if amount > state["wallet"]["balance_cents"]:
            hard_blocks.append("Insufficient operating funds")
    if action.get("requires_field_check"):
        reasons.append("Physical confirmation required")
    score = min(100, 8 + len(reasons) * 16 + len(hard_blocks) * 45)
    level = (
        "high"
        if hard_blocks
        or len(reasons) > 2
        or "New payment destination" in reasons
        or action.get("is_canary")
        else "review"
        if reasons
        else "low"
    )
    return {
        "auto_allowed": not reasons and not hard_blocks and not action.get("is_canary"),
        "level": level,
        "score": score,
        "reasons": hard_blocks + reasons,
        "hard_blocks": hard_blocks,
        "required_approvals": 1,
    }
