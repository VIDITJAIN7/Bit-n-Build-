import random
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from .catalog import choose_supplier

# Bump when the stored state shape changes; supported local states are migrated in place.
SCHEMA_VERSION = 5
WORKSPACE_NAME = "Workkite operations workspace"
# Typical daily use of the seeded consumables; drives time-lapse consumption and history.
DAILY_USAGE = {
    "stk-x14-solar": 0.12,
    "stk-p90-solar": 0.55,
    "stk-a17-solar": 0.9,
    "stk-g02-solar": 2.5,
    "stk-batt-c-tower": 0.1,
    "stk-fuel-20-tower": 1.6,
    "stk-seal-g-cold": 0.25,
    "stk-r404a-cold": 0.06,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sim_now(state):
    """The simulation clock: real time plus any demo fast-forward."""
    return datetime.now(timezone.utc) + timedelta(seconds=state.get("clock_offset_seconds", 0))


def blank_runtime():
    return {
        "firing": {},
        "last_fired": {},
        "matches": [],
        "evaluated_at": None,
        "last_fired_at": None,
        "stats": {"fired": 0, "auto": 0, "review": 0, "blocked": 0},
    }


def action(
    kind,
    title="",
    question="",
    supplier_id=None,
    amount_cents=None,
    field_check=False,
    report_fields=None,
):
    return {
        "type": kind,
        "title": title,
        "question": question,
        "supplier_id": supplier_id,
        "amount_cents": amount_cents,
        "requires_field_check": field_check,
        "report_fields": report_fields or [],
    }


def trigger(trigger_id, name, source, conditions, then, **options):
    return {
        "id": trigger_id,
        "name": name,
        "description": options.get("description", ""),
        "source": source,
        "site_id": options.get("site_id", "all"),
        "mode": options.get("mode", "auto"),
        "match": options.get("match", "all"),
        "conditions": [{"field": f, "op": op, "value": v} for f, op, v in conditions],
        "action": then,
        "cooldown_minutes": options.get("cooldown", 30),
        "enabled": True,
        "created_by": options.get("creator", "template"),
        "created_at": now_iso(),
        "runtime": blank_runtime(),
    }


def asset(code, site_id, name, kind, **metrics):
    return {
        "id": code.lower(),
        "site_id": site_id,
        "code": code,
        "name": name,
        "type": kind,
        "metrics": metrics,
    }


def stock(sku, site_id, name, on_hand, minimum, reorder_to):
    item_id = f"stk-{sku.lower()}-{site_id.removeprefix('site-')}"
    return {
        "id": item_id,
        "site_id": site_id,
        "sku": sku,
        "name": name,
        "stock": on_hand,
        "minimum": minimum,
        "reorder_to": reorder_to,
        "daily_usage": DAILY_USAGE.get(item_id, 0),
    }


def purchase_history(state, days=120, seed=7):
    """Synthetic past orders produced by the same usage-and-reorder rule the agent follows.

    Built backwards from today's stock: the last delivery topped each item up to its reorder
    level, and usage since then explains the current count. The anomaly model learns what
    normal purchasing looks like from these records and every purchase executed afterwards.
    """
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    sites = {site["id"]: site for site in state["sites"]}
    records = []
    for item in state["inventory"]:
        usage = item.get("daily_usage") or 0
        site = sites.get(item["site_id"])
        supplier, _, _ = choose_supplier(state, item["sku"], site and site["next_visit_days"])
        if not supplier or usage <= 0:
            continue
        price = supplier["catalog"][item["sku"]]
        # The agent orders the moment stock dips below minimum, back up to the reorder level.
        usual = max(item["reorder_to"] - item["minimum"] + 1, 1)
        at = now - timedelta(days=max(item["reorder_to"] - item["stock"], 1) / usage)
        while at > now - timedelta(days=days):
            # Fast-moving items sometimes drop two below minimum before the order goes out.
            quantity = usual + (1 if usage >= 1 and rng.random() < 0.3 else 0)
            records.append(
                {
                    "at": at.isoformat(),
                    "site_id": item["site_id"],
                    "sku": item["sku"],
                    "supplier_id": supplier["id"],
                    "recipient": supplier["recipient"],
                    "quantity": quantity,
                    "unit_cents": price,
                    "amount_cents": quantity * price,
                    "source": "seeded history",
                }
            )
            at -= timedelta(days=quantity / usage * rng.uniform(0.85, 1.15))
    return sorted(records, key=lambda record: record["at"])


def initial_state():
    state = {
        "schema_version": SCHEMA_VERSION,
        "workspace": {"name": WORKSPACE_NAME},
        "sites": [
            {
                "id": "site-solar",
                "name": "Desert Ridge",
                "industry": "Solar farm",
                "location": "Al Dhafra, UAE",
                "technician": "Alex Rivera",
                "next_visit_days": 3,
            },
            {
                "id": "site-tower",
                "name": "Tower TX-114",
                "industry": "Telecom tower",
                "location": "Hatta, UAE",
                "technician": "Priya Nair",
                "next_visit_days": 5,
            },
            {
                "id": "site-cold",
                "name": "Harbor Cold Store",
                "industry": "Cold-chain warehouse",
                "location": "Jebel Ali, UAE",
                "technician": "Sam Okafor",
                "next_visit_days": 2,
            },
        ],
        "assets": [
            asset(
                "INV-04",
                "site-solar",
                "Inverter 04",
                "Inverter",
                temperature_c=78,
                fan_vibration_mm_s=7.8,
                error_events=13,
            ),
            asset(
                "INV-07",
                "site-solar",
                "Inverter 07",
                "Inverter",
                temperature_c=61,
                fan_vibration_mm_s=2.1,
                error_events=1,
            ),
            asset(
                "PV-01",
                "site-solar",
                "PV Array 01",
                "Solar array",
                panel_temp_c=54,
                soiling_pct=18,
                string_voltage_v=980,
            ),
            asset(
                "GEN-01",
                "site-tower",
                "Backup generator",
                "Generator",
                fuel_pct=22,
                temperature_c=44,
                error_events=0,
            ),
            asset(
                "BAT-01",
                "site-tower",
                "Battery bank",
                "Battery",
                battery_pct=64,
                temperature_c=36,
                error_events=0,
            ),
            asset(
                "FRZ-02",
                "site-cold",
                "Freezer 02",
                "Freezer",
                temperature_c=-18.4,
                door_open_min=2,
                error_events=0,
            ),
            asset(
                "FRZ-05",
                "site-cold",
                "Freezer 05",
                "Freezer",
                temperature_c=-12.6,
                door_open_min=14,
                error_events=2,
            ),
        ],
        "inventory": [
            stock("X14", "site-solar", "Cooling fan", 1, 2, 2),
            stock("P90", "site-solar", "Air filter", 3, 5, 23),
            stock("A17", "site-solar", "Fuse", 14, 6, 20),
            stock("G02", "site-solar", "Safety gloves", 22, 8, 30),
            stock("BATT-C", "site-tower", "Battery cell", 3, 4, 4),
            stock("FUEL-20", "site-tower", "Diesel can (20 L)", 8, 6, 12),
            stock("SEAL-G", "site-cold", "Door gasket", 2, 3, 3),
            stock("R404A", "site-cold", "Refrigerant R404A", 2, 2, 3),
        ],
        "suppliers": [
            {
                "id": "sup-desert",
                "name": "Desert Supply",
                "approved": True,
                "recipient": "vendor-a",
                "lead_days": 2,
                "catalog": {"X14": 6800, "P90": 4100, "A17": 900, "G02": 800},
            },
            {
                "id": "sup-solarparts",
                "name": "Solar Parts Co.",
                "approved": True,
                "recipient": "vendor-b",
                "lead_days": 6,
                "catalog": {"X14": 6100, "P90": 3900},
            },
            {
                "id": "sup-helio",
                "name": "Helio Industrial",
                "approved": False,
                "recipient": "vendor-c-new",
                "lead_days": 1,
                "catalog": {"X14": 7400, "INV-UNIT": 470000},
            },
            {
                "id": "sup-gulfpower",
                "name": "Gulf Power Systems",
                "approved": True,
                "recipient": "vendor-d",
                "lead_days": 1,
                "catalog": {"BATT-C": 9500, "FUEL-20": 3000},
            },
            {
                "id": "sup-coldline",
                "name": "Coldline Services",
                "approved": True,
                "recipient": "vendor-e",
                "lead_days": 1,
                "catalog": {"SEAL-G": 2600, "R404A": 18000},
            },
        ],
        "triggers": [
            trigger(
                "trg-restock",
                "Restock below minimum",
                "inventory",
                [("shortfall", "gt", 0)],
                action("restock"),
                description="Keep consumables above their minimum at every site.",
                cooldown=10,
            ),
            trigger(
                "trg-overheat",
                "Overheating equipment",
                "assets",
                [("temperature_c", "gt", 70)],
                action("work_order", title="Inspect cooling on {name}"),
                description="Schedule an inspection before heat damages equipment.",
            ),
            trigger(
                "trg-replace",
                "Repeated faults → replacement",
                "assets",
                [("type", "eq", "Inverter"), ("error_events", "gte", 10)],
                action(
                    "purchase",
                    title="Replace {name}",
                    question="Is the red fault indicator on {code} active?",
                    supplier_id="sup-helio",
                    amount_cents=470000,
                    field_check=True,
                    report_fields=[
                        {
                            "key": "fault_indicator",
                            "label": "Fault indicator visible?",
                            "type": "yes_no",
                            "required": True,
                        },
                        {
                            "key": "measured_temperature",
                            "label": "Measured casing temperature (°C)",
                            "type": "number",
                            "required": True,
                        },
                        {
                            "key": "technician_notes",
                            "label": "Technician findings",
                            "type": "text",
                            "required": False,
                        },
                    ],
                ),
                site_id="site-solar",
                description="Propose a replacement, gated on a technician's confirmation.",
            ),
            trigger(
                "trg-fuel",
                "Generator fuel low",
                "assets",
                [("fuel_pct", "lt", 25)],
                action("work_order", title="Refuel {name} at {site}"),
            ),
            trigger(
                "trg-solar-array-check",
                "PV array inspection",
                "assets",
                [("type", "eq", "Solar array")],
                action(
                    "field_check",
                    question="Inspect {name} for soiling, cracked modules, and loose connections.",
                    report_fields=[
                        {
                            "key": "module_damage",
                            "label": "Visible module or glass damage?",
                            "type": "yes_no",
                            "required": True,
                        },
                        {
                            "key": "soiling_pct",
                            "label": "Estimated soiling (% of surface)",
                            "type": "number",
                            "required": True,
                        },
                        {
                            "key": "string_voltage",
                            "label": "String voltage reading (V)",
                            "type": "number",
                            "required": False,
                        },
                        {
                            "key": "cleaning_notes",
                            "label": "Cleaning or repair notes",
                            "type": "text",
                            "required": False,
                        },
                    ],
                ),
                mode="manual",
                site_id="site-solar",
                description="Runbook for recording visible panel condition and measured string voltage.",
                creator="operator",
            ),
            trigger(
                "trg-solar-soiling",
                "High array soiling → field inspection",
                "assets",
                [("soiling_pct", "gte", 25)],
                action(
                    "field_check",
                    question="Inspect the soiling level on {name} and record the site reading.",
                    report_fields=[
                        {
                            "key": "soiling_pct",
                            "label": "Observed soiling (%)",
                            "type": "number",
                            "required": True,
                        },
                        {
                            "key": "cleaning_required",
                            "label": "Cleaning required?",
                            "type": "yes_no",
                            "required": True,
                        },
                        {
                            "key": "field_note",
                            "label": "Field note",
                            "type": "text",
                            "required": False,
                        },
                    ],
                ),
                site_id="site-solar",
                description="Dispatch a field report when array soiling crosses the service threshold.",
                creator="operator",
            ),
            trigger(
                "trg-freezer",
                "Freezer running warm",
                "assets",
                [("type", "eq", "Freezer"), ("temperature_c", "gt", -15)],
                action("field_check", question="Is the door of {code} fully closed and sealed?"),
                description="Send a technician to check before stock spoils.",
            ),
            trigger(
                "trg-door",
                "Door left open",
                "assets",
                [("door_open_min", "gt", 10)],
                action("notify", title="{name} door open too long"),
                cooldown=15,
            ),
            trigger(
                "trg-safety-walk",
                "Site safety walk",
                "assets",
                [],
                action("field_check", question="Is the area around {code} clear, lit and safe?"),
                mode="manual",
                site_id="site-cold",
                description="Runbook: ask the technician to walk every asset at the site.",
            ),
        ],
        "policy": {
            "agent_per_action_cents": 25000,
            "agent_daily_cents": 100000,
            "supervisor_limit_cents": 500000,
            # A stand-in backup approver's total spend while the owner is away.
            "backup_absence_cents": 500000,
            "known_recipients": ["vendor-a", "vendor-b", "vendor-d", "vendor-e"],
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
        "agent": {
            "enabled": True,
            "live_feed": False,
            "cycles": 0,
            "simulated_hours": 0,
            "last_cycle_at": None,
            "last_cycle_changes": 0,
        },
        "actions": [],
        "field_tasks": [],
        "reports": [],
        "incidents": [],
        "audit": [],
        "history": [],
        "counters": {"action": 0, "task": 0},
        "stats": {
            "auto_handled": 0,
            "human_executed": 0,
            "rejected": 0,
            "blocked": 0,
            "alerts": 0,
            "field_dispatched": 0,
            "ml_flagged": 0,
            "incidents": 0,
        },
        "clock_offset_seconds": 0,
        "supervision": {
            "last_owner_action": now_iso(),
            "backup_after_seconds": 14400,
            "recovery_after_seconds": 604800,
            "backup": "backup",
            "backup_spent_cents": 0,
        },
        "drills": {"enabled": False, "rate": 0.03, "stats": {}, "pace": {}},
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
        },
    }
    state["history"] = purchase_history(state)
    return state


def migrate_state(state):
    """Upgrade the workspace without discarding operator-edited data."""
    if state.get("schema_version", 0) >= SCHEMA_VERSION:
        return state
    defaults = initial_state()
    existing_assets = {item["id"] for item in state.get("assets", [])}
    for asset_record in defaults["assets"]:
        if asset_record["id"] == "pv-01" and asset_record["id"] not in existing_assets:
            state.setdefault("assets", []).append(deepcopy(asset_record))
    existing_triggers = {item["id"] for item in state.get("triggers", [])}
    for trigger_record in defaults["triggers"]:
        if trigger_record["id"] not in existing_triggers and trigger_record["id"] in {
            "trg-solar-array-check",
            "trg-solar-soiling",
        }:
            state.setdefault("triggers", []).append(deepcopy(trigger_record))
    templates = {item["id"]: item for item in defaults["triggers"]}
    for trigger_record in state.get("triggers", []):
        current_action = trigger_record.setdefault("action", {})
        current_action.setdefault("assignee", "")
        if "report_fields" not in current_action:
            current_action["report_fields"] = deepcopy(
                templates.get(trigger_record["id"], {}).get("action", {}).get("report_fields", [])
            )
    for task in state.get("field_tasks", []):
        task.setdefault("report_fields", [])
        task.setdefault("assignee", "")
        task.setdefault("instructions", "")
        task.setdefault("priority", "normal")
    for item in state.get("inventory", []):
        item.setdefault("daily_usage", DAILY_USAGE.get(item["id"], 0))
    state.setdefault("policy", {}).setdefault("backup_absence_cents", 500000)
    state.setdefault("supervision", {}).setdefault("backup_spent_cents", 0)
    state.setdefault("drills", {}).setdefault("pace", {})
    state.setdefault("stats", {}).setdefault("ml_flagged", 0)
    state["stats"].setdefault("incidents", 0)
    state.setdefault("incidents", [])
    state.setdefault("agent", {}).setdefault("simulated_hours", 0)
    if "history" not in state:
        state["history"] = purchase_history(state)
    if state.get("workspace", {}).get("name") in (
        "Averlock demo workspace",
        "Averlock operations workspace",
    ):
        state["workspace"]["name"] = WORKSPACE_NAME
    state["schema_version"] = SCHEMA_VERSION
    return state
