"""External services go behind these interfaces. The default adapters need no keys."""

import random
from typing import Protocol
from uuid import uuid4

from .seed import now_iso
from .triggers import evidence, render


class Agent(Protocol):
    def propose(self, context: dict) -> list[dict]: ...


class Wallet(Protocol):
    def execute(self, state: dict, action: dict, autonomous: bool) -> dict: ...


class Feed(Protocol):
    def step(self, state: dict) -> int: ...


class WeatherSource(Protocol):
    def current(self, site_id: str) -> dict: ...


class SimulatedWeather:
    def current(self, site_id):
        return {
            "source": "local simulation",
            "scenario": "warm",
            "heat_index_c": 32,
            "high_heat": False,
        }


class LocalPlanner:
    """Deterministic planning from an operator trigger and the record it matched; no LLM.

    `context` holds the workspace `state`, the `trigger`, and the matched `record` row.
    """

    def propose(self, context):
        state, trigger, row = context["state"], context["trigger"], context["record"]
        then = trigger["action"]
        site = next(
            (s for s in state["sites"] if s["id"] == row["site_id"]),
            {"name": row.get("site", "this site"), "technician": "", "next_visit_days": None},
        )
        why = evidence(trigger, row)
        matched = f"{row['name']} at {site['name']} matched “{trigger['name']}”"
        matched += f": {why}." if why else "."
        base = {
            "trigger_id": trigger["id"],
            "trigger_name": trigger["name"],
            "site_id": row["site_id"],
            "subject": {
                "source": trigger["source"],
                "id": row["id"],
                "code": row.get("code", ""),
                "label": row.get("name", ""),
            },
            "evidence": True,
            "requires_field_check": False,
            "amount_cents": 0,
        }
        kind = then["type"]
        if kind == "restock":
            return self.restock(state, site, row, base)
        if kind == "purchase":
            return self.purchase(state, then, row, base, matched)
        if kind == "work_order":
            technician = site.get("technician") or "the site technician"
            visit = site.get("next_visit_days")
            timing = f" for the visit in {visit} days" if visit is not None else ""
            return [
                {
                    **base,
                    "kind": "work_order",
                    "title": render(then["title"] or "Inspect {name}", row),
                    "assignee": site.get("technician", ""),
                    "explanation": f"{matched} Work order assigned to {technician}{timing}.",
                }
            ]
        if kind == "field_check":
            question = render(then["question"], row)
            return [
                {
                    **base,
                    "kind": "field_check",
                    "title": f"Field check · {row['name']}",
                    "field_question": question,
                    "explanation": f"{matched} The technician is asked: {question}",
                }
            ]
        if kind == "notify":
            return [
                {
                    **base,
                    "kind": "notify",
                    "title": render(then["title"] or "{name} needs attention", row),
                    "explanation": matched,
                }
            ]
        return []

    def purchase(self, state, then, row, base, matched):
        supplier = next((s for s in state["suppliers"] if s["id"] == then["supplier_id"]), None)
        if not supplier:
            return [
                {
                    **base,
                    "kind": "notify",
                    "title": f"Supplier missing for {row['name']}",
                    "explanation": f"{matched} The trigger's supplier no longer exists.",
                }
            ]
        title = render(then["title"], row)
        gated = bool(then["requires_field_check"])
        notes = []
        if not supplier["approved"]:
            notes.append(f"{supplier['name']} is not an approved supplier")
        if supplier["recipient"] not in state["policy"]["known_recipients"]:
            notes.append("its payment destination is new")
        explanation = f"{matched} Proposed purchase: {title} from {supplier['name']}."
        if notes:
            explanation += " " + "; ".join(notes).capitalize() + "."
        if gated:
            explanation += " A technician must confirm on site before a supervisor can approve."
        return [
            {
                **base,
                "kind": "purchase",
                "title": title,
                "quantity": 1,
                "amount_cents": then["amount_cents"],
                "supplier_id": supplier["id"],
                "supplier": supplier["name"],
                "recipient": supplier["recipient"],
                "requires_field_check": gated,
                "field_question": render(then["question"], row) if gated else "",
                "explanation": explanation,
            }
        ]

    def restock(self, state, site, row, base):
        quantity = max(row["reorder_to"] - row["stock"], row["shortfall"])
        if quantity <= 0:
            return []
        sku = row["sku"]
        carriers = [s for s in state["suppliers"] if sku in s.get("catalog", {})]
        if not carriers:
            return [
                {
                    **base,
                    "kind": "notify",
                    "title": f"No supplier carries {row['name']} ({sku})",
                    "explanation": f"{row['name']} at {site['name']} is below its minimum, "
                    f"but no supplier catalog lists {sku}.",
                }
            ]
        approved = [s for s in carriers if s["approved"]]
        deadline = site.get("next_visit_days")
        on_time = [s for s in approved if deadline is None or s["lead_days"] <= deadline]
        supplier = min(on_time or approved or carriers, key=lambda s: (s["catalog"][sku], s["lead_days"]))
        price = supplier["catalog"][sku]
        if on_time:
            reason = (
                f"{supplier['name']} is the lowest-priced approved supplier arriving in "
                f"{supplier['lead_days']} days"
            )
            reason += f", before the next visit in {deadline} days." if deadline is not None else "."
            cheaper = [s for s in approved if s not in on_time and s["catalog"][sku] < price]
            if cheaper:
                slow = min(cheaper, key=lambda s: s["catalog"][sku])
                reason += f" {slow['name']} is cheaper but takes {slow['lead_days']} days."
        elif approved:
            reason = (
                f"No approved supplier arrives before the next visit; {supplier['name']} is the "
                f"lowest-priced approved option ({supplier['lead_days']} days)."
            )
        else:
            reason = f"No approved supplier carries {sku}; {supplier['name']} is the only option."
        return [
            {
                **base,
                "kind": "purchase",
                "title": f"Order {quantity} × {row['name']}",
                "sku": sku,
                "quantity": quantity,
                "amount_cents": quantity * price,
                "supplier_id": supplier["id"],
                "supplier": supplier["name"],
                "recipient": supplier["recipient"],
                "restock_item_id": row["id"],
                "explanation": f"{row['name']} ({sku}) at {site['name']} has {row['stock']} on hand "
                f"against a minimum of {row['minimum']}; ordering {quantity} to reach "
                f"{row['stock'] + quantity}. {reason}",
            }
        ]


class SimulatedFeed:
    """Stands in for live telemetry: small drifts, rare excursions and stock consumption."""

    COUNTERS = ("_events", "_count")
    NON_NEGATIVE = ("_pct", "_min", "_events", "_count")

    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def step(self, state):
        changed = 0
        for item in state["assets"]:
            baselines = item.setdefault("baselines", {})
            for key, value in list(item["metrics"].items()):
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                if key.endswith(self.COUNTERS):
                    new = value + (1 if self.rng.random() < 0.01 else 0)
                else:
                    base = baselines.setdefault(key, value)
                    spread = max(abs(base) * 0.03, 0.5)
                    if self.rng.random() < 0.02:
                        target = value + self.rng.choice((-1, 1)) * spread * 6
                    else:
                        target = value + (base - value) * 0.25 + self.rng.gauss(0, spread)
                    new = round(target) if isinstance(value, int) else round(target, 1)
                    if key.endswith(self.NON_NEGATIVE):
                        new = max(0, new)
                    if key.endswith("_pct"):
                        new = min(100, new)
                if new != value:
                    item["metrics"][key] = new
                    changed += 1
        stocked = [item for item in state["inventory"] if item["stock"] > 0]
        if stocked and self.rng.random() < 0.3:
            self.rng.choice(stocked)["stock"] -= 1
            changed += 1
        return changed


class SimulatedWallet:
    def execute(self, state, action, autonomous):
        if action.get("is_canary"):
            raise ValueError("Training canaries can never execute")
        if action.get("receipt"):
            return action["receipt"]
        amount = action["amount_cents"]
        if amount > state["wallet"]["balance_cents"]:
            raise ValueError("Operating wallet has insufficient funds")
        state["wallet"]["balance_cents"] -= amount
        if autonomous:
            state["wallet"]["agent_spent_cents"] += amount
        receipt = {
            "id": "sim-" + uuid4().hex[:16],
            "mode": "simulated",
            "amount_cents": amount,
            "at": now_iso(),
            "recipient": action.get("recipient", "internal"),
            "action_id": action["id"],
        }
        state["wallet"]["receipts"].append(receipt)
        return receipt
