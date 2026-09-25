"""External services go behind these interfaces. The default adapters need no keys."""

from typing import Protocol
from uuid import uuid4

from .seed import now_iso


class SiteSource(Protocol):
    def snapshot(self, state: dict) -> dict: ...


class Agent(Protocol):
    def propose(self, context: dict) -> list[dict]: ...


class Wallet(Protocol):
    def execute(self, state: dict, action: dict, autonomous: bool) -> dict: ...


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


class SeededSiteSource:
    def snapshot(self, state):
        return {key: state[key] for key in ("site", "inventory", "suppliers")}


class LocalPlanner:
    """Deterministic planning across stock, schedule and supplier lead time; no LLM."""

    def propose(self, context):
        site = context["site"]
        fan = next(item for item in context["inventory"] if item["sku"] == "X14")
        candidates = [
            s
            for s in context["suppliers"]
            if s["approved"] and s["delivery_days"] <= site["maintenance_days"]
        ]
        actions = []
        if fan["stock"] < fan["minimum"] and candidates:
            supplier = min(candidates, key=lambda s: s["price_cents"])
            quantity = fan["minimum"] - fan["stock"]
            actions.append(
                {
                    "id": "fans-x14",
                    "title": f"Order {quantity} cooling fans",
                    "kind": "purchase",
                    "sku": "X14",
                    "quantity": quantity,
                    "amount_cents": quantity * supplier["price_cents"],
                    "supplier": supplier["name"],
                    "approved_supplier": True,
                    "recipient": supplier["recipient"],
                    "evidence": True,
                    "requires_field": False,
                    "explanation": f"X14 stock is {fan['stock']}. {supplier['name']} is the lowest-priced approved supplier arriving in {supplier['delivery_days']} days, before maintenance in {site['maintenance_days']} days. The cheaper supplier takes 6 days.",
                }
            )
        actions.extend(
            [
                {
                    "id": "work-order",
                    "title": "Schedule inverter maintenance",
                    "kind": "work_order",
                    "amount_cents": 0,
                    "evidence": True,
                    "explanation": "Elevated fan vibration and 13 error events justify a work order for Alex Rivera's scheduled visit.",
                },
                {
                    "id": "filters-p90",
                    "title": "Replenish 20 air filters",
                    "kind": "purchase",
                    "sku": "P90",
                    "quantity": 20,
                    "amount_cents": 82000,
                    "supplier": "Desert Supply",
                    "approved_supplier": True,
                    "recipient": "vendor-a",
                    "evidence": True,
                    "requires_field": False,
                    "explanation": "Filters are below their minimum stock. A bulk order is above the autonomous limit and needs supervisor review.",
                },
                {
                    "id": "inverter-04",
                    "title": "Replace Inverter 04",
                    "kind": "purchase",
                    "sku": "INV4",
                    "quantity": 1,
                    "amount_cents": 470000,
                    "supplier": "Helio Industrial",
                    "approved_supplier": False,
                    "recipient": "vendor-c-new",
                    "evidence": True,
                    "requires_field": True,
                    "explanation": "A simulated fault escalation proposes a complete inverter replacement. The supplier and payment destination are new. A technician must verify the fault before an authorized supervisor can approve.",
                },
            ]
        )
        return actions


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
