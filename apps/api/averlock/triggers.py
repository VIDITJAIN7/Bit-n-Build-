"""Operator-defined triggers: typed conditions over workspace data.

The field list is derived from the records operators keep in the system, so a new metric
(for example `pressure_bar`) becomes available to the trigger builder as soon as it exists.
"""

import re

SOURCES = ("assets", "inventory")
ACTION_TYPES = ("notify", "work_order", "restock", "field_check", "purchase")
OPS_BY_TYPE = {
    "number": {"gt", "gte", "lt", "lte", "eq", "neq"},
    "text": {"eq", "neq", "contains"},
    "boolean": {"eq", "neq"},
}
SYMBOLS = {
    "gt": ">",
    "gte": "≥",
    "lt": "<",
    "lte": "≤",
    "eq": "=",
    "neq": "≠",
    "contains": "contains",
}
IDENTITY = {"id", "site_id"}
RESERVED = {"id", "site_id", "site", "code", "name", "type", "sku", "metrics"}
LABELS = {
    "name": ("Name", ""),
    "code": ("Code", ""),
    "type": ("Type", ""),
    "site": ("Site", ""),
    "sku": ("SKU", ""),
    "stock": ("Stock on hand", "units"),
    "minimum": ("Minimum stock", "units"),
    "reorder_to": ("Reorder level", "units"),
    "shortfall": ("Shortfall below minimum", "units"),
    "temperature_c": ("Temperature", "°C"),
    "fan_vibration_mm_s": ("Fan vibration", "mm/s"),
    "error_events": ("Error events", ""),
    "fuel_pct": ("Fuel level", "%"),
    "battery_pct": ("Battery charge", "%"),
    "door_open_min": ("Door open", "min"),
}
ORDER = ["name", "code", "type", "site", "sku"]
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def humanize(key):
    return key.replace("_", " ").capitalize()


def label(key):
    return LABELS.get(key, (humanize(key), ""))


def kind_of(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "text"


def records(state, source, site_id="all"):
    """Flatten operator data into rows a trigger can test."""
    sites = {site["id"]: site["name"] for site in state["sites"]}
    rows = []
    if source == "assets":
        for item in state["assets"]:
            rows.append(
                {
                    "id": item["id"],
                    "site_id": item["site_id"],
                    "name": item["name"],
                    "code": item["code"],
                    "type": item["type"],
                    "site": sites.get(item["site_id"], ""),
                    **item.get("metrics", {}),
                }
            )
    elif source == "inventory":
        for item in state["inventory"]:
            rows.append(
                {
                    "id": item["id"],
                    "site_id": item["site_id"],
                    "name": item["name"],
                    "code": item["sku"],
                    "sku": item["sku"],
                    "site": sites.get(item["site_id"], ""),
                    "stock": item["stock"],
                    "minimum": item["minimum"],
                    "reorder_to": item.get("reorder_to", item["minimum"]),
                    "shortfall": max(0, item["minimum"] - item["stock"]),
                }
            )
    else:
        raise ValueError(f"Unknown data source: {source}")
    return [row for row in rows if site_id in ("all", row["site_id"])]


def schema(state):
    """Fields the trigger builder can offer, inferred from live records."""
    result = {}
    for source in SOURCES:
        fields = {}
        for row in records(state, source):
            for key, value in row.items():
                if key in IDENTITY:
                    continue
                name, unit = label(key)
                entry = fields.setdefault(
                    key,
                    {"key": key, "label": name, "unit": unit, "type": kind_of(value), "values": []},
                )
                if entry["type"] == "text" and value not in entry["values"]:
                    if len(entry["values"]) < 12:
                        entry["values"].append(value)
        result[source] = sorted(
            fields.values(),
            key=lambda f: (ORDER.index(f["key"]) if f["key"] in ORDER else len(ORDER), f["key"]),
        )
    return result


def compare(op, actual, expected):
    if isinstance(actual, str) or isinstance(expected, str):
        actual, expected = str(actual).casefold(), str(expected).casefold()
        if op == "contains":
            return expected in actual
    if op == "eq":
        return actual == expected
    if op == "neq":
        return actual != expected
    if op == "gt":
        return actual > expected
    if op == "gte":
        return actual >= expected
    if op == "lt":
        return actual < expected
    if op == "lte":
        return actual <= expected
    return False


def matches(trigger, row):
    results = []
    for condition in trigger["conditions"]:
        if condition["field"] not in row:
            results.append(False)
            continue
        try:
            results.append(compare(condition["op"], row[condition["field"]], condition["value"]))
        except TypeError:
            results.append(False)
    if not results:
        # A manual runbook without conditions targets every record in its scope.
        return True
    return all(results) if trigger["match"] == "all" else any(results)


def evaluate(state, trigger):
    return [
        row
        for row in records(state, trigger["source"], trigger["site_id"])
        if matches(trigger, row)
    ]


def render(template, row):
    return PLACEHOLDER.sub(lambda m: str(row.get(m.group(1), m.group(0))), template).strip()


def format_value(key, value):
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    unit = label(key)[1]
    if unit in ("", "units"):
        return str(value)
    if unit == "%" or unit.startswith("°"):
        return f"{value}{unit}"
    return f"{value} {unit}"


def describe(trigger):
    joiner = " and " if trigger["match"] == "all" else " or "
    parts = [
        f"{label(c['field'])[0].lower()} {SYMBOLS[c['op']]} {format_value(c['field'], c['value'])}"
        for c in trigger["conditions"]
    ]
    return joiner.join(parts) if parts else "every record in scope"


def evidence(trigger, row):
    """Explain which observed values satisfied the trigger."""
    parts = []
    for c in trigger["conditions"]:
        if c["field"] in row:
            name = label(c["field"])[0].lower()
            observed = format_value(c["field"], row[c["field"]])
            parts.append(
                f"{name} {observed} ({SYMBOLS[c['op']]} {format_value(c['field'], c['value'])})"
            )
    return ", ".join(parts)


def coerce(kind, value):
    if kind == "number":
        if isinstance(value, bool):
            raise ValueError("Use a number for this field")
        if isinstance(value, (int, float)):
            return value
        try:
            number = float(str(value).strip())
        except ValueError as error:
            raise ValueError(f"{value!r} is not a number") from error
        return int(number) if number.is_integer() else number
    if kind == "boolean":
        if isinstance(value, bool):
            return value
        if str(value).strip().lower() in ("true", "yes", "1"):
            return True
        if str(value).strip().lower() in ("false", "no", "0"):
            return False
        raise ValueError(f"{value!r} is not true or false")
    text = str(value).strip()
    if not text:
        raise ValueError("A text condition needs a value")
    return text


def normalize(state, draft):
    """Validate a builder draft against the live schema and supplier list."""
    source = draft["source"]
    if source not in SOURCES:
        raise ValueError("Choose assets or inventory as the data source")
    if draft["site_id"] != "all" and draft["site_id"] not in {s["id"] for s in state["sites"]}:
        raise ValueError("Choose an existing site or all sites")
    if draft["mode"] == "auto" and not draft["conditions"]:
        raise ValueError("Automatic triggers need at least one condition")
    fields = {f["key"]: f for f in schema(state)[source]}
    conditions = []
    for condition in draft["conditions"]:
        field = fields.get(condition["field"])
        if not field:
            raise ValueError(f"No {source} record has a field called {condition['field']}")
        if condition["op"] not in OPS_BY_TYPE[field["type"]]:
            raise ValueError(f"{field['label']} cannot use the {SYMBOLS[condition['op']]} operator")
        conditions.append(
            {
                "field": field["key"],
                "op": condition["op"],
                "value": coerce(field["type"], condition["value"]),
            }
        )
    then = dict(draft["action"])
    kind = then["type"]
    if kind not in ACTION_TYPES:
        raise ValueError("Unsupported trigger action")
    if kind == "restock" and source != "inventory":
        raise ValueError("Restocking needs inventory as the data source")
    if kind == "field_check" and not then["question"].strip():
        raise ValueError("Write the question the technician should answer")
    if kind == "purchase":
        supplier = next((s for s in state["suppliers"] if s["id"] == then.get("supplier_id")), None)
        if not supplier:
            raise ValueError("Choose a supplier for the purchase")
        if not then.get("amount_cents"):
            raise ValueError("Enter the purchase amount")
        if not then["title"].strip():
            raise ValueError("Name the item being purchased")
        if then["requires_field_check"] and not then["question"].strip():
            raise ValueError("Write the confirmation question for the technician")
    else:
        then.update(supplier_id=None, amount_cents=None, requires_field_check=False)
    needs_field_form = kind == "field_check" or (
        kind == "purchase" and then["requires_field_check"]
    )
    report_fields = then.get("report_fields", []) if needs_field_form else []
    keys = [field["key"] for field in report_fields]
    if len(keys) != len(set(keys)):
        raise ValueError("Each worker report field needs a unique key")
    then["report_fields"] = report_fields
    return {
        "name": draft["name"].strip(),
        "description": draft.get("description", "").strip(),
        "source": source,
        "site_id": draft["site_id"],
        "mode": draft["mode"],
        "match": draft["match"],
        "conditions": conditions,
        "action": then,
        "cooldown_minutes": draft["cooldown_minutes"],
        "enabled": draft.get("enabled", True),
    }
