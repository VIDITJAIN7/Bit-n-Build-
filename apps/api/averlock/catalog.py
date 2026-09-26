"""Supplier selection shared by the planner and the seeded purchase history."""


def choose_supplier(state, sku, deadline_days):
    """Cheapest approved supplier arriving before the deadline, then fallbacks.

    Returns (supplier, on_time, approved) or (None, False, False) when nobody carries the SKU.
    """
    carriers = [s for s in state["suppliers"] if sku in s.get("catalog", {})]
    if not carriers:
        return None, False, False
    approved = [s for s in carriers if s["approved"]]
    on_time = [s for s in approved if deadline_days is None or s["lead_days"] <= deadline_days]
    pool = on_time or approved or carriers
    supplier = min(pool, key=lambda s: (s["catalog"][sku], s["lead_days"]))
    return supplier, bool(on_time), bool(approved)
