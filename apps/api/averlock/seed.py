from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def initial_state():
    return {
        "site": {
            "id": "site-07",
            "name": "Desert Ridge",
            "type": "Solar operations",
            "location": "Al Dhafra, UAE",
            "asset": "Inverter 04",
            "temperature": 78,
            "vibration": "Elevated",
            "errors": 13,
            "maintenance_days": 3,
            "technician": "Alex Rivera",
        },
        "inventory": [
            {"sku": "X14", "name": "Cooling fan", "stock": 0, "minimum": 2},
            {"sku": "P90", "name": "Air filter", "stock": 3, "minimum": 5},
            {"sku": "A17", "name": "Fuse", "stock": 14, "minimum": 6},
            {"sku": "G02", "name": "Safety gloves", "stock": 22, "minimum": 8},
            {"sku": "T05", "name": "Temperature sensor", "stock": 4, "minimum": 2},
            {"sku": "C11", "name": "Connector kit", "stock": 9, "minimum": 4},
            {"sku": "INV4", "name": "Inverter assembly", "stock": 0, "minimum": 0},
        ],
        "suppliers": [
            {
                "id": "supplier-a",
                "name": "Desert Supply",
                "price_cents": 6800,
                "delivery_days": 2,
                "approved": True,
                "recipient": "vendor-a",
            },
            {
                "id": "supplier-b",
                "name": "Solar Parts Co.",
                "price_cents": 6100,
                "delivery_days": 6,
                "approved": True,
                "recipient": "vendor-b",
            },
            {
                "id": "supplier-c",
                "name": "Helio Industrial",
                "price_cents": 7400,
                "delivery_days": 1,
                "approved": False,
                "recipient": "vendor-c-new",
            },
        ],
        "policy": {
            "agent_per_action_cents": 25000,
            "agent_daily_cents": 100000,
            "supervisor_limit_cents": 500000,
            "known_recipients": ["vendor-a", "vendor-b"],
            "typical_purchase_cents": 51000,
        },
        "wallet": {
            "mode": "simulated",
            "balance_cents": 1500000,
            "agent_spent_cents": 0,
            "agent_spend_day": now_iso()[:10],
            "owner": "supervisor",
            "receipts": [],
        },
        "actions": [],
        "reports": [],
        "audit": [],
        "scenario_ran": False,
        "clock_offset_seconds": 0,
        "supervision": {
            "last_owner_action": now_iso(),
            "backup_after_seconds": 14400,
            "recovery_after_seconds": 604800,
            "backup": "backup",
        },
        "drills": {"enabled": False, "rate": 0.03, "stats": {}, "next_sequence": 1},
        "weather": {
            "source": "local simulation",
            "scenario": "warm",
            "heat_index_c": 32,
            "high_heat": False,
        },
        "recovery": {
            "stage": "idle",
            "candidate": None,
            "approvals": [],
            "quorum": 2,
            "guardians": ["guardian-1", "guardian-2", "guardian-3"],
            "delay_seconds": 172800,
            "unlock_at": None,
            "clock_offset_seconds": 0,
        },
    }
