"""A workspace-trained anomaly model for proposed purchases.

An isolation forest learns what normal purchasing looks like from this workspace's own
history: amounts, quantities, prices, reorder timing, and how familiar the supplier,
destination, and item are. It can only add friction. A flagged purchase goes to a person
even inside the agent's limits, but the model never approves anything the rules would route
to review.
"""

import math
import random
from datetime import datetime
from statistics import median

FEATURES = (
    "quantity vs this item's usual",
    "unit price vs usual",
    "reorder gap vs this item's usual",
    "destination familiarity",
    "supplier familiarity",
    "item familiarity",
)
CONTAMINATION = 0.03
MIN_THRESHOLD = 0.6
MIN_TRAINING = 12
RATIO_CAP = 4.0
# Familiarity saturates: three past payments make a destination established. Without the
# cap, busy items would look "normal" and slow-moving ones "odd" for no operational reason.
FAMILIAR = 3


def _c(n):
    """Average path length of an unsuccessful search in a binary search tree of n items."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2 * (math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n


def _days(later, earlier):
    return (later - earlier).total_seconds() / 86400


def _at(record):
    return datetime.fromisoformat(record["at"])


class IsolationForest:
    """Liu, Ting and Zhou (2008): anomalies are isolated by fewer random splits."""

    def __init__(self, trees=100, sample=64, seed=7):
        self.tree_count, self.sample, self.seed = trees, sample, seed
        self.trees = []
        self.size = 0

    def fit(self, rows):
        rng = random.Random(self.seed)
        self.size = min(self.sample, len(rows))
        limit = math.ceil(math.log2(max(self.size, 2)))
        self.trees = [
            self._grow(rng.sample(rows, self.size), 0, limit, rng) for _ in range(self.tree_count)
        ]
        return self

    def _grow(self, rows, depth, limit, rng):
        if depth >= limit or len(rows) <= 1:
            return ("leaf", len(rows))
        spans = []
        for index in range(len(rows[0])):
            values = [row[index] for row in rows]
            if max(values) > min(values):
                spans.append((index, min(values), max(values)))
        if not spans:
            return ("leaf", len(rows))
        feature, low, high = rng.choice(spans)
        split = rng.uniform(low, high)
        left = [row for row in rows if row[feature] < split]
        right = [row for row in rows if row[feature] >= split]
        return (
            "node",
            feature,
            split,
            self._grow(left, depth + 1, limit, rng),
            self._grow(right, depth + 1, limit, rng),
        )

    @staticmethod
    def _path(row, node):
        depth = 0
        while node[0] == "node":
            _, feature, split, left, right = node
            node = left if row[feature] < split else right
            depth += 1
        return depth + _c(node[1])

    def score(self, row):
        mean = sum(self._path(row, tree) for tree in self.trees) / len(self.trees)
        return 2 ** (-mean / _c(self.size))


def _gaps(rows):
    return [_days(_at(b), _at(a)) for a, b in zip(rows, rows[1:])]


def features(record, history, at, own=None):
    """Feature vector for a purchase, relative to the history around it.

    Training rows pass their own index so they are compared with every other record, as a
    settled workspace would see them; proposals are compared with the full history.
    """
    others = [h for index, h in enumerate(history) if index != own]
    same = [h for h in others if h["sku"] == record["sku"] and h["site_id"] == record["site_id"]]
    earlier = [h for h in same if _at(h) < at]
    gaps = _gaps(same)
    usual_gap = median(gaps) if gaps else None
    # Ratios to each item's own normal make a burst of cheap reorders as visible as a
    # suspicious bulk order, whether the item turns over every 4 days or every 35.
    gap_ratio = _days(at, _at(earlier[-1])) / usual_gap if earlier and usual_gap else 1.0
    quantities = [h["quantity"] for h in same]
    quantity_ratio = record["quantity"] / median(quantities) if quantities else 1.0
    units = [h["unit_cents"] for h in same]
    usual_unit = median(units) if units else record["unit_cents"]
    # Absolute size is left to the spending limits; the model looks for behaviour that is
    # unusual for this workspace even when every limit is respected.
    return [
        min(quantity_ratio, RATIO_CAP),
        min(record["unit_cents"] / max(usual_unit, 1), RATIO_CAP),
        min(gap_ratio, RATIO_CAP),
        min(sum(h["recipient"] == record["recipient"] for h in others), FAMILIAR),
        min(sum(h["supplier_id"] == record["supplier_id"] for h in others), FAMILIAR),
        min(len(same), FAMILIAR),
    ]


def purchase_record(action):
    quantity = max(1, action.get("quantity") or 1)
    return {
        "site_id": action["site_id"],
        "sku": action.get("sku") or action["subject"]["code"],
        "supplier_id": action.get("supplier_id"),
        "recipient": action.get("recipient"),
        "quantity": quantity,
        "amount_cents": action["amount_cents"],
        "unit_cents": action["amount_cents"] // quantity,
    }


class PurchaseModel:
    name = "Isolation forest"

    def __init__(self):
        self._key = None
        self._fitted = None

    def train(self, history):
        key = (len(history), history[-1]["at"] if history else None)
        if key == self._key:
            return self._fitted
        fitted = None
        if len(history) >= MIN_TRAINING:
            rows = [features(h, history, _at(h), own=index) for index, h in enumerate(history)]
            forest = IsolationForest().fit(rows)
            scores = sorted(forest.score(row) for row in rows)
            cut = scores[min(len(scores) - 1, int(len(scores) * (1 - CONTAMINATION)))]
            fitted = {
                "forest": forest,
                "threshold": max(MIN_THRESHOLD, cut),
                "trained_on": len(rows),
            }
        self._key, self._fitted = key, fitted
        return fitted

    def status(self, history):
        fitted = self.train(history)
        return {
            "model": self.name,
            "features": list(FEATURES),
            "trained_on": fitted["trained_on"] if fitted else len(history),
            "threshold": round(fitted["threshold"], 3) if fitted else None,
            "learning": fitted is None,
            "contamination": CONTAMINATION,
        }

    def assess(self, state, action, now):
        history = state["history"]
        fitted = self.train(history)
        if not fitted:
            return {"model": self.name, "learning": True, "flagged": False, "signals": []}
        record = purchase_record(action)
        score = fitted["forest"].score(features(record, history, now))
        # Two detectors from the same history: the forest catches unusual combinations,
        # per-item baselines catch clear single deviations and explain themselves.
        signals = deviations(state, record, history, now)
        combined = score >= fitted["threshold"]
        if combined and not signals:
            signals = ["Unusual combination of quantity, price, timing, and supplier"]
        return {
            "model": self.name,
            "score": round(score, 3),
            "threshold": round(fitted["threshold"], 3),
            "flagged": bool(signals),
            "trained_on": fitted["trained_on"],
            "signals": signals,
        }


def deviations(state, record, history, now):
    """Deviations from per-item baselines learned from history, in plain language."""
    suppliers = {s["id"]: s["name"] for s in state["suppliers"]}
    same = [h for h in history if h["sku"] == record["sku"] and h["site_id"] == record["site_id"]]
    signals = []
    if not any(h["recipient"] == record["recipient"] for h in history):
        signals.append(f"First payment to {record['recipient']}")
    if not any(h["supplier_id"] == record["supplier_id"] for h in history):
        name = suppliers.get(record["supplier_id"], "this supplier")
        signals.append(f"First purchase from {name}")
    if not same:
        signals.append(f"No purchase history for {record['sku']} at this site")
    else:
        usual_quantity = median(h["quantity"] for h in same)
        if record["quantity"] >= 2 * usual_quantity and record["quantity"] - usual_quantity >= 2:
            signals.append(f"Quantity {record['quantity']} vs usual {usual_quantity:g}")
        gaps = _gaps(same)
        gap = _days(now, _at(same[-1]))
        if gaps and gap < 0.35 * median(gaps):
            signals.append(
                f"Reordered after {gap:.1f} days; usual gap {median(gaps):.0f} days"
            )
        usual_unit = median(h["unit_cents"] for h in same)
        if record["unit_cents"] > 1.15 * usual_unit:
            above = round(100 * (record["unit_cents"] / usual_unit - 1))
            signals.append(f"Unit price {above}% above usual")
    return signals
