import hashlib
import random
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from . import triggers as rules
from .adapters import LocalPlanner, SimulatedFeed, SimulatedWallet
from .anomaly import PurchaseModel, purchase_record
from .policy import backup_remaining, evaluate, money, refresh_daily_budget
from .seed import blank_runtime, initial_state, now_iso, sim_now

MAX_ACTIONS = 300
MAX_AUDIT = 400
MAX_TASKS = 150
MAX_REPORTS = 100
MAX_INCIDENTS = 100
MAX_HISTORY = 400
NOUNS = {"sites": "Site", "assets": "Asset", "inventory": "Inventory item", "suppliers": "Supplier"}
HOMOGLYPHS = (("o", "0"), ("l", "1"), ("i", "1"), ("e", "3"), ("a", "4"), ("s", "5"))
# Rapid approvals earn a speed bump: after this many in the window, read back before approving.
PACE_LIMIT = 3
PACE_WINDOW_SECONDS = 30


class DomainError(ValueError):
    pass


def record(state, event, message, actor="system", action_id=None):
    state["audit"].append(
        {
            "id": uuid4().hex,
            "at": now_iso(),
            "event": event,
            "message": message,
            "actor": actor,
            "action_id": action_id,
        }
    )


def find(items, item_id, noun):
    item = next((i for i in items if i["id"] == item_id), None)
    if not item:
        raise DomainError(f"{noun} not found")
    return item


def find_action(state, action_id):
    return find(state["actions"], action_id, "Action")


def owner_silence(state):
    return (
        sim_now(state) - datetime.fromisoformat(state["supervision"]["last_owner_action"])
    ).total_seconds()


def owner_acted(state):
    """A primary-owner action: refreshes availability and ends any backup absence budget."""
    state["supervision"]["last_owner_action"] = sim_now(state).isoformat()
    state["supervision"]["backup_spent_cents"] = 0


def recent_approvals(state, actor, now):
    pace = state["drills"].setdefault("pace", {}).setdefault(actor, [])
    return [
        t for t in pace if (now - datetime.fromisoformat(t)).total_seconds() < PACE_WINDOW_SECONDS
    ]


def media_meta(attachments):
    """What the workspace document keeps about evidence; the bytes live in the media table."""
    return [
        {
            "kind": item["kind"],
            "name": item["name"],
            "demo_fixture": item["demo_fixture"],
            "sha256": hashlib.sha256(item["data_url"].encode()).hexdigest(),
            "bytes": len(item["data_url"].split(",", 1)[-1]) * 3 // 4,
        }
        for item in attachments
    ]


def readback_target(action):
    """What a reviewer must type when a readback is required: where money goes, else the asset."""
    return action.get("recipient") or action["subject"]["code"]


def plural(count, noun):
    return f"{count} {noun}{'' if count == 1 else 's'}"


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:30] or "item"


def unique_id(items, base):
    taken = {item["id"] for item in items}
    candidate, number = base, 2
    while candidate in taken:
        candidate, number = f"{base}-{number}", number + 1
    return candidate


def lookalike(recipient):
    for original, swap in HOMOGLYPHS:
        if original in recipient:
            return recipient.replace(original, swap, 1)
    return recipient + "-1"


class OperationsService:
    def __init__(self, repository, agent=None, wallet=None, feed=None, rng=None, model=None):
        self.repository = repository
        self.agent = agent or LocalPlanner()
        self.wallet = wallet or SimulatedWallet()
        self.random = rng or random.Random()
        self.feed = feed or SimulatedFeed(self.random)
        self.model = model or PurchaseModel()
        self.interval = 0

    def prepare(self):
        """Connect the wallet adapter (deploying the contracts on a fresh local chain)."""

        def change(state):
            self.wallet.prepare(state)
            return f"Wallet ready ({self.wallet.mode})."

        return self.repository.mutate(change)

    # Background agent ---------------------------------------------------------------

    def cycle(self):
        """One background pass: the optional sensor feed, then every enabled automatic trigger."""
        state = self.repository.read()
        if not state["agent"]["enabled"]:
            return None, "The background agent is paused."
        if state["agent"]["live_feed"]:
            # Readings move in their own short transaction, so a risk review running ahead
            # of the trigger pass sees the data that pass will evaluate.
            state, _ = self.repository.mutate(self.feed.step)
        self._review_ahead(state, lambda trigger: trigger["enabled"] and trigger["mode"] == "auto")

        def change(state):
            agent = state["agent"]
            refresh_daily_budget(state)
            created = self._evaluate_all(state)
            agent["cycles"] += 1
            agent["last_cycle_at"] = now_iso()
            agent["last_cycle_changes"] = created
            self._trim(state)
            return f"Agent cycle complete: {plural(created, 'new action')}."

        return self.repository.mutate(change)

    def _evaluate_all(self, state, planner=None):
        created = 0
        for trigger in state["triggers"]:
            if trigger["enabled"] and trigger["mode"] == "auto":
                created += self._evaluate(state, trigger, manual=False, planner=planner)
        return created

    def time_lapse(self, hours):
        """Fast-forward normal operations an hour at a time with the supervisor around.

        Usage, wear, and completed work come from the simulated feed; every proposal still
        crosses the same policy gate and anomaly model. The queue shows what a day or a week
        of operations would have asked of a person. Simulated hours use the local planner:
        an optional AI reviewer is only called for real cycles.
        """
        planner = getattr(self.agent, "planner", self.agent)

        def change(state):
            stats = state["stats"]
            before = {key: stats[key] for key in ("auto_handled", "alerts", "field_dispatched")}
            known = {action["id"] for action in state["actions"]}
            for _ in range(hours):
                state["clock_offset_seconds"] += 3600
                self.wallet.advance_time(state, 3600)
                refresh_daily_budget(state)
                self.feed.step(state, hours=1)
                self._evaluate_all(state, planner=planner)
            # A normal stretch of operations: the supervisor kept working throughout.
            owner_acted(state)
            self.wallet.record_decision(state, state["wallet"]["owner"], "presence-heartbeat", True)
            state["agent"]["simulated_hours"] += hours
            fresh = [action for action in state["actions"] if action["id"] not in known]
            review = [action for action in fresh if action["status"] == "pending"]
            flagged = sum(1 for action in review if (action.get("ml") or {}).get("flagged"))
            handled = stats["auto_handled"] - before["auto_handled"]
            span = f"{hours // 24} days" if hours >= 48 else f"{hours} hours"
            message = (
                f"Fast-forwarded {span}: {plural(handled, 'routine action')} handled "
                f"autonomously, {len(review)} routed to people"
            )
            if flagged:
                message += f" ({flagged} escalated by the anomaly model)"
            message += (
                f", {plural(stats['alerts'] - before['alerts'], 'alert')}, "
                f"{plural(stats['field_dispatched'] - before['field_dispatched'], 'worker task')}."
            )
            record(state, "demo.time_lapse", message, "demo-operator")
            self._trim(state)
            return message

        return self.repository.mutate(change)

    def _evaluate(self, state, trigger, manual, planner=None):
        """Edge-triggered: a record fires when it starts matching, once per cooldown window."""
        planner = planner or self.agent
        runtime = trigger["runtime"]
        now = sim_now(state)
        rows = rules.evaluate(state, trigger)
        created = 0
        for row in rows:
            record_id = row["id"]
            if not manual and record_id in runtime["firing"]:
                continue
            if self._has_open_item(state, trigger["id"], record_id):
                runtime["firing"].setdefault(record_id, now.isoformat())
                continue
            if self._cooling_down(trigger, record_id, now, manual):
                continue
            for proposal in planner.propose({"state": state, "trigger": trigger, "record": row}):
                self._admit(state, proposal, trigger)
                created += 1
            runtime["firing"][record_id] = now.isoformat()
            runtime["last_fired"][record_id] = now.isoformat()
            runtime["last_fired_at"] = now.isoformat()
            runtime["stats"]["fired"] += 1
        # Re-evaluate after execution: an action that resolved its condition (a completed
        # restock, say) re-arms the record immediately instead of waiting to be seen clear.
        current = (
            [row["id"] for row in rules.evaluate(state, trigger)]
            if created
            else [row["id"] for row in rows]
        )
        for record_id in list(runtime["firing"]):
            if record_id not in current:
                del runtime["firing"][record_id]
        runtime["matches"] = current
        runtime["evaluated_at"] = now_iso()
        return created

    @staticmethod
    def _cooling_down(trigger, record_id, now, manual):
        last = trigger["runtime"]["last_fired"].get(record_id)
        return (
            not manual
            and last is not None
            and (now - datetime.fromisoformat(last)).total_seconds()
            < trigger["cooldown_minutes"] * 60
        )

    def _review_ahead(self, state, selected, manual=False):
        """Give an optional risk reviewer the records about to fire, outside any transaction.

        Provider calls can take seconds; holding the SQLite write lock that long would stall
        approvals and worker reports. Proposals the review did not cover wait for a person.
        """
        prepare = getattr(self.agent, "prepare", None)
        if not prepare:
            return
        now = sim_now(state)
        prepare(
            [
                {"state": state, "trigger": trigger, "record": row}
                for trigger in state["triggers"]
                if selected(trigger)
                for row in rules.evaluate(state, trigger)
                if (manual or row["id"] not in trigger["runtime"]["firing"])
                and not self._has_open_item(state, trigger["id"], row["id"])
                and not self._cooling_down(trigger, row["id"], now, manual)
            ]
        )

    @staticmethod
    def _has_open_item(state, trigger_id, record_id):
        return any(
            a["status"] == "pending"
            and a.get("trigger_id") == trigger_id
            and a["subject"]["id"] == record_id
            for a in state["actions"]
        ) or any(
            t["status"] == "open"
            and t.get("trigger_id") == trigger_id
            and t["subject_id"] == record_id
            for t in state["field_tasks"]
        )

    def _admit(self, state, proposal, trigger=None):
        # Proposals from any planner cross the same deterministic gate.
        action = {
            **proposal,
            "id": self._next_id(state, "action", "act"),
            "created_at": now_iso(),
            "approvals": [],
            "verification_requested": False,
            "field_task_id": None,
            "field_confirmed": None,
            "receipt": None,
        }
        if action["kind"] == "purchase":
            action["ml"] = self.model.assess(state, action, sim_now(state))
            if action["ml"]["flagged"]:
                state["stats"]["ml_flagged"] += 1
        action["policy"] = evaluate(state, action)
        action["status"] = "blocked" if action["policy"]["hard_blocks"] else "pending"
        state["actions"].append(action)
        record(state, "action.proposed", action["title"], "agent", action["id"])
        outcome = "blocked" if action["status"] == "blocked" else "review"
        if outcome == "review" and action["policy"]["auto_allowed"]:
            try:
                self.execute(state, action, autonomous=True)
                outcome = "auto"
            except (DomainError, ValueError) as error:
                action["status"] = "blocked"
                action["policy"]["hard_blocks"].append(str(error))
                outcome = "blocked"
        if outcome == "blocked":
            state["stats"]["blocked"] += 1
            reasons = "; ".join(action["policy"]["hard_blocks"])
            record(
                state, "action.blocked", f"{action['title']} — {reasons}", "policy", action["id"]
            )
        elif outcome == "review" and (action.get("ml") or {}).get("flagged"):
            record(
                state,
                "model.escalated",
                f"{action['title']}: {'; '.join(action['ml']['signals'])}",
                "anomaly-model",
                action["id"],
            )
        if trigger:
            trigger["runtime"]["stats"][outcome] += 1
        if state["drills"]["enabled"] and self.random.random() < state["drills"]["rate"]:
            self.add_canary(state)
        return action

    def execute(self, state, action, autonomous=False, actor="agent"):
        # Recheck at the moment of execution, inside the repository transaction.
        refresh_daily_budget(state)
        actor = "agent" if autonomous else actor
        policy = evaluate(state, action, actor=None if autonomous else actor)
        if policy["hard_blocks"] or (autonomous and not policy["auto_allowed"]):
            raise DomainError(
                "; ".join(policy["hard_blocks"]) or "Current policy does not allow this execution"
            )
        kind = action["kind"]
        outcome = {
            "purchase": "simulated payment",
            "work_order": "work order created",
            "field_check": "field check dispatched",
            "notify": "alert raised",
        }[kind]
        if kind == "purchase":
            receipt = self.wallet.execute(state, action, autonomous, actor)
            action["receipt"] = receipt
            if receipt.get("tx"):
                outcome = (
                    f"paid on the local chain · tx {receipt['tx'][:10]}… block {receipt['block']}"
                )
            if actor == "backup":
                state["supervision"]["backup_spent_cents"] = (
                    state["supervision"].get("backup_spent_cents", 0) + action["amount_cents"]
                )
            state["history"] = [
                *state["history"],
                {**purchase_record(action), "at": sim_now(state).isoformat(), "source": "executed"},
            ][-MAX_HISTORY:]
            item = next(
                (i for i in state["inventory"] if i["id"] == action.get("restock_item_id")), None
            )
            if item:
                item["stock"] += action["quantity"]
                outcome += f"; {action['quantity']} received into stock (simulated delivery)"
        elif kind in ("field_check", "work_order"):
            # Work orders are worker-facing tasks too: let the agent turn the
            # administrator's saved trigger into an assigned field job.
            action["field_task_id"] = self._open_task(state, action, actor)["id"]
        elif kind == "notify":
            state["stats"]["alerts"] += 1
        action["status"] = "executed"
        action["execution_mode"] = "autonomous" if autonomous else "human"
        action["executed_at"] = now_iso()
        action["executed_sim_at"] = sim_now(state).isoformat()
        if not autonomous:
            state["stats"]["human_executed"] += 1
        elif kind != "notify":
            state["stats"]["auto_handled"] += 1
        record(state, "action.executed", f"{action['title']} — {outcome}", actor, action["id"])

    def _open_task(self, state, action, actor):
        subject = action["subject"]
        question = (
            action.get("field_question")
            or action.get("question")
            or (action.get("title") if action["kind"] == "work_order" else None)
            or f"Is the reported condition visible on {subject['code']}?"
        )
        task = {
            "id": self._next_id(state, "task", "task"),
            "action_id": action["id"],
            "trigger_id": action.get("trigger_id"),
            "site_id": action["site_id"],
            "subject_id": subject["id"],
            "subject_code": subject["code"],
            "subject_label": subject["label"],
            "question": question,
            "instructions": action.get("title", ""),
            "assignee": action.get("assignee", ""),
            "priority": action.get("priority", "normal"),
            "report_fields": action.get("report_fields", []),
            "gates_decision": action["kind"] == "purchase",
            "status": "open",
            "created_at": now_iso(),
            "answer": None,
            "answered_at": None,
            "report_id": None,
        }
        state["field_tasks"].append(task)
        state["stats"]["field_dispatched"] += 1
        record(state, "field.requested", f"{subject['label']}: {question}", actor, action["id"])
        return task

    @staticmethod
    def _next_id(state, counter, prefix):
        state["counters"][counter] += 1
        return f"{prefix}-{state['counters'][counter]:05d}"

    @staticmethod
    def _trim(state):
        def keep_latest(items, limit, is_open):
            if len(items) <= limit:
                return items
            room = max(0, limit - sum(1 for item in items if is_open(item)))
            closed = [item for item in items if not is_open(item)]
            dropped = {item["id"] for item in closed[: len(closed) - room]}
            return [item for item in items if item["id"] not in dropped]

        state["actions"] = keep_latest(
            state["actions"], MAX_ACTIONS, lambda a: a["status"] == "pending"
        )
        state["field_tasks"] = keep_latest(
            state["field_tasks"], MAX_TASKS, lambda t: t["status"] == "open"
        )
        state["incidents"] = keep_latest(
            state["incidents"], MAX_INCIDENTS, lambda i: i["status"] == "open"
        )
        state["audit"] = state["audit"][-MAX_AUDIT:]
        state["reports"] = state["reports"][-MAX_REPORTS:]
        state["wallet"]["receipts"] = state["wallet"]["receipts"][-MAX_ACTIONS:]

    def set_agent(self, enabled=None, live_feed=None):
        def change(state):
            agent = state["agent"]
            parts = []
            if enabled is not None and enabled != agent["enabled"]:
                agent["enabled"] = enabled
                parts.append("background agent " + ("resumed" if enabled else "paused"))
            if live_feed is not None and live_feed != agent["live_feed"]:
                agent["live_feed"] = live_feed
                parts.append("simulated sensor feed " + ("on" if live_feed else "off"))
            if not parts:
                return "Agent settings unchanged."
            message = "; ".join(parts).capitalize() + "."
            record(state, "agent.settings", message, "operator")
            return message

        return self.repository.mutate(change)

    # Triggers -----------------------------------------------------------------------

    def create_trigger(self, draft):
        def change(state):
            trigger = rules.normalize(state, draft)
            trigger.update(
                id=f"trg-{uuid4().hex[:8]}",
                created_by="operator",
                created_at=now_iso(),
                runtime=blank_runtime(),
            )
            state["triggers"].append(trigger)
            record(
                state,
                "trigger.created",
                f"“{trigger['name']}” created: when {rules.describe(trigger)}",
                "operator",
            )
            if trigger["mode"] == "manual":
                return f"“{trigger['name']}” is ready as a runbook on the control panel."
            return f"“{trigger['name']}” is live. The background agent evaluates it every cycle."

        return self.repository.mutate(change)

    def update_trigger(self, trigger_id, draft):
        def change(state):
            trigger = find(state["triggers"], trigger_id, "Trigger")
            updated = rules.normalize(state, draft)
            logic = ("source", "site_id", "match", "conditions", "action")
            changed = any(trigger[key] != updated[key] for key in logic)
            trigger.update(updated)
            if changed:
                # New logic starts from a clean slate; open items and cooldowns still apply.
                trigger["runtime"]["firing"] = {}
            self._sync_open_field_tasks(state, trigger)
            record(
                state,
                "trigger.updated",
                f"“{trigger['name']}” updated: when {rules.describe(trigger)}",
                "operator",
            )
            return f"“{trigger['name']}” saved."

        return self.repository.mutate(change)

    @staticmethod
    def _sync_open_field_tasks(state, trigger):
        """Keep active worker forms aligned with edits to their task definition.

        Completed tasks and reports remain historical records. Tasks whose source record
        disappeared or changed data source also retain their original assignment.
        """
        action = trigger["action"]
        kind = action["type"]
        has_worker_task = kind in ("field_check", "work_order") or (
            kind == "purchase" and action.get("requires_field_check", False)
        )
        if not has_worker_task:
            return
        rows = {
            row["id"]: row
            for row in rules.records(state, trigger["source"], trigger["site_id"])
        }
        sites = {site["id"]: site for site in state["sites"]}
        for task in state["field_tasks"]:
            if task.get("trigger_id") != trigger["id"] or task["status"] != "open":
                continue
            row = rows.get(task["subject_id"])
            if not row:
                continue
            site = sites.get(row["site_id"], {})
            old_fields = task.get("report_fields", [])
            new_fields = action.get("report_fields", [])
            history = task.setdefault("report_fields_history", [])
            if old_fields != new_fields and old_fields not in history:
                history.append([dict(field) for field in old_fields])
            if kind == "field_check":
                task["question"] = rules.render(action["question"], row)
            elif kind == "work_order":
                task["question"] = rules.render(action["title"] or "Inspect {name}", row)
            else:
                task["question"] = rules.render(action["question"], row)
            task["site_id"] = row["site_id"]
            task["subject_code"] = row.get("code", task["subject_code"])
            task["subject_label"] = row.get("name", task["subject_label"])
            task["assignee"] = action.get("assignee") or site.get("technician", "")
            task["priority"] = action.get("priority", "normal")
            task["report_fields"] = [dict(field) for field in action.get("report_fields", [])]
            task["gates_decision"] = kind == "purchase"

    def set_trigger_enabled(self, trigger_id, enabled):
        def change(state):
            trigger = find(state["triggers"], trigger_id, "Trigger")
            trigger["enabled"] = enabled
            verb = "enabled" if enabled else "paused"
            record(state, f"trigger.{verb}", f"“{trigger['name']}” {verb}", "operator")
            return f"“{trigger['name']}” {verb}."

        return self.repository.mutate(change)

    def delete_trigger(self, trigger_id):
        def change(state):
            trigger = find(state["triggers"], trigger_id, "Trigger")
            state["triggers"].remove(trigger)
            record(state, "trigger.deleted", f"“{trigger['name']}” deleted", "operator")
            return f"“{trigger['name']}” deleted. Its past actions stay in the audit trail."

        return self.repository.mutate(change)

    def run_trigger(self, trigger_id):
        self._review_ahead(
            self.repository.read(),
            lambda trigger: trigger["id"] == trigger_id and trigger["enabled"],
            manual=True,
        )

        def change(state):
            trigger = find(state["triggers"], trigger_id, "Trigger")
            if not trigger["enabled"]:
                raise DomainError("Enable this trigger before running it")
            refresh_daily_budget(state)
            created = self._evaluate(state, trigger, manual=True)
            record(
                state,
                "trigger.run",
                f"“{trigger['name']}” run on demand: {plural(created, 'new action')}",
                "operator",
            )
            self._trim(state)
            if not created:
                return f"“{trigger['name']}” ran. Nothing new: no match, or items already open."
            return (
                f"“{trigger['name']}” ran: {plural(created, 'new action')} through the policy gate."
            )

        return self.repository.mutate(change)

    def preview_trigger(self, draft):
        state = self.repository.read()
        trigger = rules.normalize(state, draft)
        rows = rules.evaluate(state, trigger)
        return {
            "expression": rules.describe(trigger),
            "count": len(rows),
            "matches": [
                {
                    "id": row["id"],
                    "code": row.get("code", ""),
                    "name": row["name"],
                    "site": row["site"],
                    "evidence": rules.evidence(trigger, row),
                }
                for row in rows[:25]
            ],
        }

    # Operator data ------------------------------------------------------------------

    @staticmethod
    def _require_site(state, site_id):
        find(state["sites"], site_id, "Site")

    @staticmethod
    def _check_metrics(metrics):
        for key in metrics:
            if key in rules.RESERVED:
                raise DomainError(f"{key} is reserved; choose another metric name")

    def create_record(self, collection, data):
        def change(state):
            items = state[collection]
            if collection == "sites":
                item = {"id": unique_id(items, "site-" + slug(data["name"])), **data}
                title = data["name"]
            elif collection == "assets":
                self._require_site(state, data["site_id"])
                code = data["code"].strip().upper()
                if any(a["code"].upper() == code for a in items):
                    raise DomainError(f"An asset with code {code} already exists")
                self._check_metrics(data["metrics"])
                item = {**data, "id": unique_id(items, code.lower()), "code": code}
                title = code
            elif collection == "inventory":
                self._require_site(state, data["site_id"])
                sku = data["sku"].strip().upper()
                if any(i["sku"] == sku and i["site_id"] == data["site_id"] for i in items):
                    raise DomainError(f"{sku} is already tracked at this site")
                base = f"stk-{sku.lower()}-{data['site_id'].removeprefix('site-')}"
                reorder = data.get("reorder_to") or data["minimum"]
                item = {**data, "id": unique_id(items, base), "sku": sku, "reorder_to": reorder}
                title = f"{data['name']} ({sku})"
            else:
                catalog = {sku.upper(): price for sku, price in data["catalog"].items()}
                item = {
                    **data,
                    "id": unique_id(items, "sup-" + slug(data["name"])),
                    "catalog": catalog,
                }
                title = data["name"]
            items.append(item)
            record(state, "data.created", f"{NOUNS[collection]} {title} added", "operator")
            return f"{title} added. Triggers evaluate it on the next agent cycle."

        return self.repository.mutate(change)

    def update_record(self, collection, record_id, patch):
        def change(state):
            item = find(state[collection], record_id, NOUNS[collection])
            changes = []
            for key, value in patch.items():
                if key == "metrics":
                    self._check_metrics(value)
                    baselines = item.setdefault("baselines", {})
                    for metric, new in value.items():
                        old = item["metrics"].get(metric)
                        if new is None:
                            if metric in item["metrics"]:
                                del item["metrics"][metric]
                                baselines.pop(metric, None)
                                changes.append(f"{metric} removed")
                        elif old != new:
                            item["metrics"][metric] = new
                            baselines[metric] = new
                            changes.append(
                                f"{metric} {old} → {new}"
                                if old is not None
                                else f"{metric} = {new}"
                            )
                elif key == "catalog":
                    for sku, price in value.items():
                        sku = sku.upper()
                        if price is None:
                            if item["catalog"].pop(sku, None) is not None:
                                changes.append(f"{sku} removed from catalog")
                        elif item["catalog"].get(sku) != price:
                            item["catalog"][sku] = price
                            changes.append(f"{sku} price {price / 100:.2f}")
                elif item.get(key) != value:
                    if key == "site_id":
                        self._require_site(state, value)
                    changes.append(f"{key} {item.get(key)} → {value}")
                    item[key] = value
            if not changes:
                return "No changes to save."
            title = item.get("code") or item.get("sku") or item["name"]
            record(state, "data.updated", f"{title}: {', '.join(changes)}", "operator")
            return f"{title} updated. Triggers re-evaluate on the next agent cycle."

        return self.repository.mutate(change)

    def delete_record(self, collection, record_id):
        def change(state):
            item = find(state[collection], record_id, NOUNS[collection])
            if collection == "sites" and any(
                row["site_id"] == record_id for row in state["assets"] + state["inventory"]
            ):
                raise DomainError("Move or delete this site's assets and inventory first")
            state[collection].remove(item)
            for task in state["field_tasks"]:
                if task["status"] == "open" and task["subject_id"] == record_id:
                    task["status"] = "cancelled"
            title = item.get("code") or item.get("sku") or item["name"]
            record(state, "data.deleted", f"{NOUNS[collection]} {title} deleted", "operator")
            return f"{title} deleted."

        return self.repository.mutate(change)

    # Human decisions and field evidence -----------------------------------------------

    def decide(self, action_id, decision, actor, readback=""):
        def change(state):
            is_owner = actor == state["wallet"]["owner"]
            backup_active = owner_silence(state) >= state["supervision"]["backup_after_seconds"]
            if not is_owner and not (actor == "backup" and backup_active):
                raise DomainError("This role is not an active authorizer")
            action = find_action(state, action_id)
            if action["status"] != "pending":
                raise DomainError("This action is no longer awaiting a decision")
            stats = state["drills"]["stats"].get(actor, {})
            real_now = datetime.now(timezone.utc)
            recent = recent_approvals(state, actor, real_now)
            pace_check = decision == "approve" and len(recent) >= PACE_LIMIT
            what = "payment destination" if action.get("recipient") else "equipment code"
            if (
                decision == "approve"
                and (stats.get("enhanced", False) or pace_check)
                and readback.strip().casefold() != readback_target(action).casefold()
            ):
                if stats.get("enhanced", False):
                    raise DomainError(f"Enhanced review: type the exact {what} to approve")
                raise DomainError(
                    f"Pace check: {PACE_LIMIT} approvals in under {PACE_WINDOW_SECONDS} seconds. "
                    f"Type the exact {what} to continue."
                )
            if decision == "approve":
                # A readback resets the pace window; otherwise remember this approval's time.
                state["drills"]["pace"][actor] = (
                    [] if pace_check else [*recent, real_now.isoformat()]
                )
            if is_owner:
                owner_acted(state)
                record(
                    state,
                    "supervision.owner_action",
                    "Primary supervisor action refreshed the availability clock.",
                    actor,
                )
            if action.get("is_canary"):
                stats = state["drills"]["stats"].setdefault(
                    actor, {"caught": 0, "missed": 0, "enhanced": False, "pass_streak": 0}
                )
                caught = decision == "reject"
                stats["caught" if caught else "missed"] += 1
                stats["pass_streak"] = stats["pass_streak"] + 1 if caught else 0
                stats["enhanced"] = (
                    False if stats["pass_streak"] >= 2 else stats["enhanced"] or not caught
                )
                action["status"] = "drill_resolved"
                action["drill_result"] = "caught" if caught else "missed"
                record(
                    state,
                    "drill." + action["drill_result"],
                    f"Training reveal: lookalike destination {action['recipient']} differs from "
                    f"{action['canary_expected']}. No payment could execute.",
                    actor,
                    action_id,
                )
                self.wallet.record_decision(state, actor, action_id, not caught)
                return (
                    "Training reveal: "
                    + (
                        "you caught the altered destination."
                        if caught
                        else "you approved the altered destination. Enhanced review is now active."
                    )
                    + " This was a non-executable drill."
                )
            if decision == "reject":
                action["status"] = "rejected"
                state["stats"]["rejected"] += 1
                for task in state["field_tasks"]:
                    if task["action_id"] == action_id and task["status"] == "open":
                        task["status"] = "cancelled"
                record(state, "action.rejected", action["title"], actor, action_id)
                self.wallet.record_decision(state, actor, action_id, False)
                return "Action rejected. No funds moved."
            refresh_daily_budget(state)
            policy = evaluate(state, action, actor=actor)
            if policy["hard_blocks"]:
                raise DomainError("; ".join(policy["hard_blocks"]))
            if action.get("requires_field_check") and action.get("field_confirmed") is not True:
                raise DomainError("A technician must confirm this on site before approval")
            if actor in action["approvals"]:
                raise DomainError("This authorizer has already approved")
            action["approvals"].append(actor)
            record(state, "action.approved", action["title"], actor, action_id)
            if len(action["approvals"]) >= policy["required_approvals"]:
                self.execute(state, action, actor=actor)
                receipt = action.get("receipt") or {}
                if is_owner and not receipt:
                    # No payment signed this approval, so record the owner's presence on chain.
                    self.wallet.record_decision(state, actor, action_id, True)
                if receipt.get("tx"):
                    return (
                        f"Authorized and paid on the local chain: tx {receipt['tx'][:10]}… "
                        f"in block {receipt['block']}."
                    )
                if actor == "backup" and action["amount_cents"]:
                    left = money(backup_remaining(state))
                    return f"Approved by the backup. {left} of backup authority left this absence."
                return "Required approvals received. Local execution completed."
            return "Approval recorded. A separate second authorizer is required."

        return self.repository.mutate(change)

    def request_verification(self, action_id):
        def change(state):
            action = find_action(state, action_id)
            if action["status"] != "pending" or not action.get("requires_field_check"):
                raise DomainError("This action does not need a field check")
            if any(
                t["action_id"] == action_id and t["status"] == "open" for t in state["field_tasks"]
            ):
                return "A field check is already waiting in the field console."
            task = self._open_task(state, action, state["wallet"]["owner"])
            action["verification_requested"] = True
            action["field_task_id"] = task["id"]
            return "Field check sent to the field console."

        return self.repository.mutate(change)

    def submit_report(self, report):
        blobs = [
            (f"{report['id']}:{item['kind']}", report["id"], item["kind"], item["data_url"])
            for item in report["attachments"]
        ]
        entry = {**report, "attachments": media_meta(report["attachments"])}

        def change(state):
            existing = next((r for r in state["reports"] if r["id"] == report["id"]), None)
            if existing:
                if any(existing.get(key) != entry[key] for key in entry):
                    raise DomainError("A report with this ID already contains different data")
                return "Report already confirmed; duplicate retry ignored."
            task = find(state["field_tasks"], report["task_id"], "Field task")
            if task["status"] != "open":
                raise DomainError("This field task is no longer open")
            if report["asset_code"].strip().upper() != task["subject_code"].upper() or not all(
                report["checklist"].values()
            ):
                raise DomainError(
                    f"Match {task['subject_code']} and complete all compliance observations"
                )
            responses = report.get("responses", {})
            schemas = [task.get("report_fields", []), *task.get("report_fields_history", [])]
            valid_schema = False
            unknown_fields = True
            missing_labels = []
            invalid_labels = []
            for schema in schemas:
                definitions = {field["key"]: field for field in schema}
                if set(responses) - set(definitions):
                    continue
                unknown_fields = False
                missing = []
                invalid = []
                for key, definition in definitions.items():
                    value = responses.get(key)
                    if definition["required"] and (value is None or value == ""):
                        missing.append(definition["label"])
                        continue
                    if value is None:
                        continue
                    valid_type = (
                        isinstance(value, str) and len(value) <= 500
                        if definition["type"] == "text"
                        else isinstance(value, bool)
                        if definition["type"] == "yes_no"
                        else isinstance(value, (int, float)) and not isinstance(value, bool)
                    )
                    if not valid_type:
                        invalid.append(definition["label"])
                if not missing and not invalid:
                    valid_schema = True
                    break
                if not missing:
                    missing_labels = []
                elif not missing_labels:
                    missing_labels = missing
                if not invalid:
                    invalid_labels = []
                elif not invalid_labels:
                    invalid_labels = invalid
            if not valid_schema and unknown_fields:
                raise DomainError("This report contains fields that were not requested")
            if not valid_schema and missing_labels:
                raise DomainError(f"Complete the required field: {missing_labels[0]}")
            if not valid_schema and invalid_labels:
                raise DomainError(f"Use the requested response type for: {invalid_labels[0]}")
            kinds = [a["kind"] for a in report["attachments"]]
            if "photo" not in kinds:
                raise DomainError("Attach a photo or the clearly labeled demo evidence fixture")
            if len(set(kinds)) != len(kinds):
                raise DomainError("Attach at most one photo and one audio note")
            if any(
                (a["kind"] == "photo") != a["data_url"].startswith("data:image/")
                for a in report["attachments"]
            ):
                raise DomainError("Attachment type does not match its content type")
            state["reports"].append(
                {**entry, "action_id": task["action_id"], "confirmed_at": now_iso()}
            )
            task.update(
                status="answered",
                answer=report["answer"],
                answered_at=now_iso(),
                report_id=report["id"],
            )
            action = next((a for a in state["actions"] if a["id"] == task["action_id"]), None)
            if action:
                action["field_confirmed"] = report["answer"]
                if action["status"] == "pending":
                    # Changed evidence invalidates any sign-offs taken against earlier evidence.
                    action["approvals"] = []
            record(
                state,
                "field.confirmed",
                f"{task['subject_label']}: {'yes' if report['answer'] else 'no'} · {task['question']}",
                "technician",
                task["action_id"],
            )
            return "Field evidence confirmed by the local server."

        return self.repository.mutate(change, blobs=blobs)

    def report_incident(self, incident):
        """An unscheduled emergency or safety report from the field; never waits for a task."""
        blobs = [
            (f"{incident['id']}:{item['kind']}", incident["id"], item["kind"], item["data_url"])
            for item in incident["attachments"]
        ]
        entry = {**incident, "attachments": media_meta(incident["attachments"])}

        def change(state):
            existing = next((i for i in state["incidents"] if i["id"] == incident["id"]), None)
            if existing:
                if any(existing.get(key) != entry[key] for key in entry):
                    raise DomainError("An incident with this ID already contains different data")
                return "Incident already received; duplicate retry ignored."
            site = find(state["sites"], incident["site_id"], "Site")
            kinds = [a["kind"] for a in incident["attachments"]]
            if len(set(kinds)) != len(kinds):
                raise DomainError("Attach at most one photo and one audio note")
            if any(
                (a["kind"] == "photo") != a["data_url"].startswith("data:image/")
                for a in incident["attachments"]
            ):
                raise DomainError("Attachment type does not match its content type")
            state["incidents"].append(
                {
                    **entry,
                    "status": "open",
                    "received_at": now_iso(),
                    "acknowledged_by": None,
                    "acknowledged_at": None,
                }
            )
            state["stats"]["incidents"] += 1
            record(
                state,
                "incident.reported",
                f"{incident['severity'].capitalize()} {incident['kind']} incident "
                f"at {site['name']}",
                "technician",
            )
            self._trim(state)
            return "Incident received. Supervisors see it at the top of the overview."

        return self.repository.mutate(change, blobs=blobs)

    def acknowledge_incident(self, incident_id, actor):
        def change(state):
            incident = find(state["incidents"], incident_id, "Incident")
            if incident["status"] != "open":
                raise DomainError("This incident has already been acknowledged")
            incident.update(status="acknowledged", acknowledged_by=actor, acknowledged_at=now_iso())
            record(
                state,
                "incident.acknowledged",
                f"{incident['kind'].capitalize()} incident acknowledged",
                actor,
            )
            return "Incident acknowledged. The worker's device shows it on the next sync."

        return self.repository.mutate(change)

    def media(self, owner_id, kind):
        return self.repository.blob(f"{owner_id}:{kind}")

    # Authority, drills, and simulation controls ------------------------------------

    def recover(self, operation, actor=None):
        def change(state):
            recovery = state["recovery"]
            stage = recovery["stage"]
            if operation == "start":
                if stage in ("voting", "timelock"):
                    raise DomainError("A recovery is already in progress")
                if owner_silence(state) < state["supervision"]["recovery_after_seconds"]:
                    days = state["supervision"]["recovery_after_seconds"] // 86400
                    raise DomainError(
                        f"Long-term recovery becomes eligible after {days} days without "
                        "primary-supervisor actions"
                    )
                # Authority passes to the other designated supervisor, never to a guardian or
                # the backup, so recovery can run again after a completed one.
                candidate = (
                    "supervisor"
                    if state["wallet"]["owner"] == "replacement-supervisor"
                    else "replacement-supervisor"
                )
                recovery.update(stage="voting", candidate=candidate, approvals=[], unlock_at=None)
            elif operation == "approve":
                if (
                    stage != "voting"
                    or actor not in recovery["guardians"]
                    or actor in recovery["approvals"]
                ):
                    raise DomainError("A distinct designated guardian must approve during voting")
                recovery["approvals"].append(actor)
                if len(recovery["approvals"]) >= recovery["quorum"]:
                    recovery["stage"] = "timelock"
                    recovery["unlock_at"] = (
                        sim_now(state) + timedelta(seconds=recovery["delay_seconds"])
                    ).isoformat()
            elif operation == "advance":
                if stage != "timelock":
                    raise DomainError("Guardian quorum must start the timelock first")
                state["clock_offset_seconds"] += recovery["delay_seconds"]
            elif operation == "finalize":
                if stage != "timelock" or sim_now(state) < datetime.fromisoformat(
                    recovery["unlock_at"]
                ):
                    raise DomainError("Guardian quorum and the full timelock are required")
                state["wallet"]["owner"] = recovery["candidate"]
                owner_acted(state)
                recovery["stage"] = "complete"
                # Old-owner approvals must not survive a change of authority.
                for action in state["actions"]:
                    if action["status"] == "pending":
                        action["approvals"] = []
            elif operation == "cancel":
                if actor != state["wallet"]["owner"] or stage not in ("voting", "timelock"):
                    raise DomainError("Only the current owner can cancel an active recovery")
                recovery.update(stage="idle", candidate=None, approvals=[], unlock_at=None)
                owner_acted(state)
            else:
                raise DomainError("Unknown recovery operation")
            self.wallet.recover(state, operation, actor)
            record(
                state,
                "recovery." + operation,
                f"Recovery {operation}; authority: {state['wallet']['owner']}",
                actor or "demo-operator",
            )
            return "Recovery state updated."

        return self.repository.mutate(change)

    def advance(self, hours):
        def change(state):
            state["clock_offset_seconds"] += hours * 3600
            self.wallet.advance_time(state, hours * 3600)
            record(state, "demo.clock", f"Advanced availability simulation by {hours} hours.")
            return "Simulation clock advanced. No real time or funds changed."

        return self.repository.mutate(change)

    def add_canary(self, state):
        """Insert a non-executable restock that pays a lookalike of a known supplier.

        The local planner writes it exactly as it would write a real restock (quantity,
        supplier choice, explanation) for an item with no order already waiting, so the
        payment destination is the only thing that differs from routine work.
        """
        known = set(state["policy"]["known_recipients"])
        restock = next(
            (t for t in state["triggers"] if t["action"]["type"] == "restock"),
            {
                "id": None,
                "name": "Restock below minimum",
                "source": "inventory",
                "conditions": [],
                "match": "all",
                "action": {"type": "restock"},
            },
        )
        waiting = {
            a["subject"]["id"].split("#")[0] for a in state["actions"] if a["status"] == "pending"
        }
        approved = {s["id"] for s in state["suppliers"] if s["approved"]}
        options = {True: [], False: []}
        for row in rules.records(state, "inventory"):
            if row["id"] in waiting:
                continue
            context = {"state": state, "trigger": restock, "record": row}
            for proposal in LocalPlanner().propose(context):
                if (
                    proposal["kind"] == "purchase"
                    and proposal.get("supplier_id") in approved
                    and proposal.get("recipient") in known
                ):
                    # Items genuinely below minimum make the most ordinary-looking reorder.
                    options[row["shortfall"] > 0].append(proposal)
        pool = options[True] or options[False]
        if not pool:
            return None
        proposal = self.random.choice(pool)
        action = {
            **proposal,
            "id": self._next_id(state, "action", "act"),
            # A distinct subject keeps the exercise from blocking the item's real restock.
            "subject": {**proposal["subject"], "id": f"{proposal['subject']['id']}#review"},
            "recipient": lookalike(proposal["recipient"]),
            "canary_expected": proposal["recipient"],
            "is_canary": True,
            "created_at": now_iso(),
            "approvals": [],
            "verification_requested": False,
            "field_task_id": None,
            "field_confirmed": None,
            "receipt": None,
            "status": "pending",
        }
        # Same model assessment as a real proposal, so nothing marks the exercise out.
        action["ml"] = self.model.assess(state, action, sim_now(state))
        action["policy"] = evaluate(state, action)
        state["actions"].append(action)
        record(state, "action.proposed", action["title"], "agent", action["id"])
        return action

    def drills(self, operation):
        def change(state):
            if operation in ("enable", "disable"):
                state["drills"]["enabled"] = operation == "enable"
                record(
                    state,
                    "drill.program",
                    f"Announced training program {operation}d. Target sampling rate: 3%.",
                )
            elif operation == "inject":
                if not state["drills"]["enabled"]:
                    raise DomainError("Announce and enable the drill program first")
                if not self.add_canary(state):
                    raise DomainError("No approved supplier with a known destination to imitate")
            return "Training program updated. Exercises can never execute payments."

        return self.repository.mutate(change)

    def set_weather(self, hot):
        def change(state):
            state["weather"] = {
                "source": "local simulation",
                "scenario": "hot" if hot else "warm",
                "heat_index_c": 46 if hot else 32,
                "high_heat": hot,
            }
            return "Local heat scenario updated. No live weather service is connected."

        return self.repository.mutate(change)

    def reset(self):
        def change(state):
            state.clear()
            state.update(initial_state())
            # A fresh chain wallet too: action IDs restart, and the contract refuses reuse.
            self.wallet.prepare(state, fresh=True)
            record(state, "demo.reset", "Local workspace, triggers, and wallet reset.")
            return "Local demo reset. The background agent starts over on its next cycle."

        result = self.repository.mutate(change)
        self.repository.clear_blobs()
        return result

    def snapshot(self):
        state = self.repository.read()
        state["recovery"]["now"] = sim_now(state).isoformat()
        silence = owner_silence(state)
        supervision = state["supervision"]
        supervision["silence_hours"] = round(silence / 3600, 2)
        supervision["backup_active"] = silence >= supervision["backup_after_seconds"]
        supervision["recovery_eligible"] = silence >= supervision["recovery_after_seconds"]
        supervision["backup_remaining_cents"] = backup_remaining(state)
        real_now = datetime.now(timezone.utc)
        # Who must type a readback on their next approval, and why.
        supervision["readback"] = {
            actor: "pace"
            for actor in state["drills"].get("pace", {})
            if len(recent_approvals(state, actor, real_now)) >= PACE_LIMIT
        } | {
            actor: "enhanced"
            for actor, stats in state["drills"]["stats"].items()
            if stats.get("enhanced")
        }
        supervision["pace"] = {"limit": PACE_LIMIT, "window_seconds": PACE_WINDOW_SECONDS}
        for action in state["actions"]:
            if action["status"] == "pending":
                action.pop("is_canary", None)
                action.pop("canary_expected", None)
        for item in state["assets"]:
            item.pop("baselines", None)
        for trigger in state["triggers"]:
            trigger["runtime"]["matches"] = [row["id"] for row in rules.evaluate(state, trigger)]
        state["schema"] = rules.schema(state)
        state["agent"]["interval_seconds"] = self.interval
        state["agent"]["planner"] = getattr(self.agent, "mode", "rules")
        # The purchase history trains the model; the panel only needs its summary.
        state["ml"] = self.model.status(state["history"])
        state["history_size"] = len(state.pop("history"))
        chain = self.wallet.status(state)
        if chain.get("connected"):
            state["wallet"]["balance_cents"] = chain["balance_cents"]
        state["chain"] = chain
        return state
