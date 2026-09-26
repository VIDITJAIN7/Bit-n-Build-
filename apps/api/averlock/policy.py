"""Rules grant authority; the risk score, the AI reviewer and the anomaly model are
explanation and friction, never permission."""

from .seed import sim_now

KINDS = ("purchase", "work_order", "field_check", "notify")


def money(cents):
    return f"${cents / 100:,.0f}" if cents % 100 == 0 else f"${cents / 100:,.2f}"


def refresh_daily_budget(state):
    # Budgets follow the simulation clock, so a fast-forwarded week has seven budget days.
    day = sim_now(state).date().isoformat()
    if state["wallet"]["agent_spend_day"] != day:
        state["wallet"]["agent_spend_day"] = day
        state["wallet"]["agent_spent_cents"] = 0


def backup_remaining(state):
    """What a stand-in backup approver may still spend during this absence of the owner."""
    limit = state["policy"].get("backup_absence_cents", state["policy"]["supervisor_limit_cents"])
    return max(0, limit - state["supervision"].get("backup_spent_cents", 0))


def evaluate(state, action, actor=None):
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
            reasons.append(
                f"Purchase is {amount / typical:.1f}× larger than typical site purchases"
            )
        ml = action.get("ml") or {}
        if ml.get("flagged"):
            # The model can escalate a purchase that is inside every limit, never the reverse.
            score = f" (anomaly score {ml['score']:.2f})" if ml.get("score") is not None else ""
            reasons.append(f"Unusual for this workspace{score}: {ml['signals'][0]}")
        if amount > policy["supervisor_limit_cents"]:
            limit = money(policy["supervisor_limit_cents"])
            hard_blocks.append(f"Above the operating wallet's {limit} transaction limit")
        if actor == "backup" and amount > backup_remaining(state):
            limit = money(policy.get("backup_absence_cents", policy["supervisor_limit_cents"]))
            hard_blocks.append(
                f"Above the backup approver's {limit} limit for this absence; "
                "the owner or a recovered supervisor must approve"
            )
        if amount > state["wallet"]["balance_cents"]:
            hard_blocks.append("Insufficient operating funds")
    if action.get("requires_field_check"):
        reasons.append("Physical confirmation required")
    score = min(100, 8 + len(reasons) * 16 + len(hard_blocks) * 45)
    ai_risk = action.get("ai_risk") or {}
    ai_score = ai_risk.get("score", 0)
    if isinstance(ai_score, bool) or not isinstance(ai_score, int) or not 0 <= ai_score <= 100:
        ai_score = 100
        ai_risk = {**ai_risk, "flags": [*ai_risk.get("flags", []), "Invalid AI risk assessment"]}
    ai_flags = ai_risk.get("flags", [])
    if ai_risk and (not ai_risk.get("available", True) or ai_flags or ai_score >= 35):
        reasons.extend(ai_flags or ["AI risk assessment recommends human review"])
    score = max(score, ai_score)
    level = (
        "high"
        if hard_blocks
        or ai_score >= 70
        or len(reasons) > 2
        or "New payment destination" in reasons
        or action.get("is_canary")
        else "review"
        if reasons
        else "low"
    )
    return {
        "auto_allowed": (
            not reasons
            and not hard_blocks
            and not action.get("is_canary")
            and (not ai_risk or (ai_risk.get("available", True) and ai_score < 35 and not ai_flags))
        ),
        "level": level,
        "score": score,
        "reasons": hard_blocks + reasons,
        "hard_blocks": hard_blocks,
        "required_approvals": 1,
    }
