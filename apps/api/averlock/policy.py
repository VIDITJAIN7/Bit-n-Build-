"""Rules grant authority; the risk score is an explanation aid, not permission."""

from .seed import now_iso


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
        action["kind"] not in ("purchase", "work_order")
        or not isinstance(amount, int)
        or amount < 0
    ):
        hard_blocks.append("Unsupported action or invalid amount")
    if not action.get("evidence"):
        reasons.append("Operational evidence is missing")
    if action["kind"] == "purchase":
        supplier = next(
            (s for s in state["suppliers"] if s["name"] == action.get("supplier")), None
        )
        if not supplier or not supplier["approved"]:
            reasons.append("Supplier has not been approved")
        if action.get("recipient") not in policy["known_recipients"]:
            reasons.append("New payment destination")
        elif supplier and action.get("recipient") != supplier["recipient"]:
            reasons.append("Payment destination does not match the supplier record")
        if amount > policy["agent_per_action_cents"]:
            reasons.append("Above the $250 autonomous transaction limit")
        if state["wallet"]["agent_spent_cents"] + amount > policy["agent_daily_cents"]:
            reasons.append("Exceeds the remaining autonomous daily budget")
        if amount > policy["supervisor_limit_cents"]:
            hard_blocks.append("Above the operating wallet's $5,000 transaction limit")
        if amount > state["wallet"]["balance_cents"]:
            hard_blocks.append("Insufficient operating funds")
    if action.get("requires_field") or action.get("sku") == "INV4":
        reasons.append("Physical fault confirmation required")
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
