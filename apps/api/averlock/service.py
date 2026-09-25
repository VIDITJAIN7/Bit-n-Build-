import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from .adapters import LocalPlanner, SeededSiteSource, SimulatedWallet
from .policy import evaluate, refresh_daily_budget
from .seed import initial_state, now_iso


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


def find_action(state, action_id):
    action = next((a for a in state["actions"] if a["id"] == action_id), None)
    if not action:
        raise DomainError("Action not found")
    return action


def recovery_now(state):
    return datetime.now(timezone.utc) + timedelta(seconds=state["clock_offset_seconds"])


def owner_silence(state):
    return (
        recovery_now(state) - datetime.fromisoformat(state["supervision"]["last_owner_action"])
    ).total_seconds()


class OperationsService:
    def __init__(self, repository, agent=None, source=None, wallet=None):
        self.repository = repository
        self.agent = agent or LocalPlanner()
        self.source = source or SeededSiteSource()
        self.wallet = wallet or SimulatedWallet()

    def run(self):
        def change(state):
            if state["scenario_ran"]:
                return "Scenario already planned; no duplicate actions created."
            refresh_daily_budget(state)
            for proposal in self.agent.propose(self.source.snapshot(state)):
                # Adapters return proposals only. Every action crosses the same gate.
                if (
                    not isinstance(proposal.get("amount_cents"), int)
                    or proposal["amount_cents"] < 0
                ):
                    raise DomainError("Planner proposed an invalid amount")
                action = {
                    **proposal,
                    "created_at": now_iso(),
                    "approvals": [],
                    "verification_requested": False,
                    "field_fault": None,
                    "receipt": None,
                }
                action["policy"] = evaluate(state, action)
                action["status"] = "blocked" if action["policy"]["hard_blocks"] else "pending"
                state["actions"].append(action)
                record(state, "action.proposed", action["title"], "local-planner", action["id"])
                if action["policy"]["auto_allowed"]:
                    self.execute(state, action, autonomous=True)
                if state["drills"]["enabled"] and random.random() < state["drills"]["rate"]:
                    self.add_canary(state)
            state["scenario_ran"] = True
            record(
                state,
                "agent.completed",
                "Site planning complete; exceptions routed to human review.",
                "local-planner",
            )
            return "Site planning complete. Routine actions executed within policy."

        return self.repository.mutate(change)

    def execute(self, state, action, autonomous=False):
        # Recheck at the moment of execution, inside the repository transaction.
        refresh_daily_budget(state)
        policy = evaluate(state, action)
        if policy["hard_blocks"] or (autonomous and not policy["auto_allowed"]):
            raise DomainError("Current policy does not allow this execution")
        if action["kind"] == "purchase":
            action["receipt"] = self.wallet.execute(state, action, autonomous)
        action["status"] = "executed"
        action["execution_mode"] = "autonomous" if autonomous else "human"
        action["executed_at"] = now_iso()
        record(
            state,
            "action.executed",
            f"{action['title']} — {'simulated payment' if action['kind'] == 'purchase' else 'local work order created'}",
            "agent" if autonomous else state["wallet"]["owner"],
            action["id"],
        )

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
            if (
                decision == "approve"
                and stats.get("enhanced", False)
                and readback.strip() != action.get("recipient", "internal")
            ):
                raise DomainError("Enhanced review: read back the exact payment destination")
            if is_owner:
                state["supervision"]["last_owner_action"] = recovery_now(state).isoformat()
                record(
                    state,
                    "supervision.owner_action",
                    "Primary supervisor action refreshed the availability clock (simulated signature).",
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
                    "Training reveal: lookalike destination vend0r-a differs from vendor-a. No payment could execute.",
                    actor,
                    action_id,
                )
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
                record(state, "action.rejected", action["title"], actor, action_id)
                return "Action rejected. No funds moved."
            refresh_daily_budget(state)
            policy = evaluate(state, action)
            if policy["hard_blocks"]:
                raise DomainError("; ".join(policy["hard_blocks"]))
            if (action.get("requires_field") or action.get("sku") == "INV4") and action[
                "field_fault"
            ] is not True:
                raise DomainError("A confirmed field fault is required before approval")
            if actor in action["approvals"]:
                raise DomainError("This authorizer has already approved")
            action["approvals"].append(actor)
            record(state, "action.approved", action["title"], actor, action_id)
            if len(action["approvals"]) >= policy["required_approvals"]:
                self.execute(state, action)
                return "Required approvals received. Local execution completed."
            return "Approval recorded. A separate second authorizer is required."

        return self.repository.mutate(change)

    def request_verification(self, action_id):
        def change(state):
            action = find_action(state, action_id)
            if action["status"] != "pending" or not action.get("requires_field"):
                raise DomainError("This action does not need a field verification")
            if not action["verification_requested"]:
                action["verification_requested"] = True
                record(
                    state,
                    "field.requested",
                    "Inspect Inverter 04 red fault indicator",
                    state["wallet"]["owner"],
                    action_id,
                )
            return "Verification task sent to the local field console."

        return self.repository.mutate(change)

    def submit_report(self, report):
        def change(state):
            existing = next((r for r in state["reports"] if r["id"] == report["id"]), None)
            if existing:
                if any(existing[key] != report[key] for key in report):
                    raise DomainError("A report with this ID already contains different data")
                return "Report already confirmed; duplicate retry ignored."
            action = find_action(state, report["action_id"])
            if not action["verification_requested"] or action["status"] != "pending":
                raise DomainError("No pending verification task for this action")
            if report["asset_id"].strip().upper() != "INV-04" or not all(
                report["checklist"].values()
            ):
                raise DomainError("Match asset INV-04 and complete all compliance observations")
            if not any(a["kind"] == "photo" for a in report["attachments"]):
                raise DomainError("Attach a photo or the clearly labeled demo evidence fixture")
            if any(
                (a["kind"] == "photo") != a["data_url"].startswith("data:image/")
                for a in report["attachments"]
            ):
                raise DomainError("Attachment type does not match its content type")
            state["reports"].append({**report, "confirmed_at": now_iso()})
            action["field_fault"] = report["fault"]
            # Changed evidence invalidates any sign-offs taken against earlier evidence.
            action["approvals"] = []
            record(
                state,
                "field.confirmed",
                "Fault indicator " + ("active" if report["fault"] else "not active"),
                "technician",
                action["id"],
            )
            return "Field evidence confirmed by the local server."

        return self.repository.mutate(change)

    def recover(self, operation, actor=None):
        def change(state):
            recovery = state["recovery"]
            stage = recovery["stage"]
            if operation == "start":
                if stage != "idle":
                    raise DomainError("A recovery is already active or completed")
                if owner_silence(state) < state["supervision"]["recovery_after_seconds"]:
                    raise DomainError(
                        "Long-term recovery becomes eligible after 7 days without primary-supervisor actions"
                    )
                recovery.update(
                    stage="voting", candidate="replacement-supervisor", approvals=[], unlock_at=None
                )
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
                        recovery_now(state) + timedelta(seconds=recovery["delay_seconds"])
                    ).isoformat()
            elif operation == "advance":
                if stage != "timelock":
                    raise DomainError("Guardian quorum must start the timelock first")
                state["clock_offset_seconds"] += recovery["delay_seconds"]
            elif operation == "finalize":
                if stage != "timelock" or recovery_now(state) < datetime.fromisoformat(
                    recovery["unlock_at"]
                ):
                    raise DomainError("Guardian quorum and the full timelock are required")
                state["wallet"]["owner"] = recovery["candidate"]
                state["supervision"]["last_owner_action"] = recovery_now(state).isoformat()
                recovery["stage"] = "complete"
                # Old-owner approvals must not survive a change of authority.
                for action in state["actions"]:
                    if action["status"] == "pending":
                        action["approvals"] = []
            elif operation == "cancel":
                if actor != state["wallet"]["owner"] or stage not in ("voting", "timelock"):
                    raise DomainError("Only the current owner can cancel an active recovery")
                recovery.update(stage="idle", candidate=None, approvals=[], unlock_at=None)
                state["supervision"]["last_owner_action"] = recovery_now(state).isoformat()
            else:
                raise DomainError("Unknown recovery operation")
            record(
                state,
                "recovery." + operation,
                f"Recovery {operation}; authority: {state['wallet']['owner']}",
                actor or "demo-operator",
            )
            return "Recovery state updated in the local simulator."

        return self.repository.mutate(change)

    def advance(self, hours):
        def change(state):
            state["clock_offset_seconds"] += hours * 3600
            record(state, "demo.clock", f"Advanced availability simulation by {hours} hours.")
            return "Simulation clock advanced. No real time or funds changed."

        return self.repository.mutate(change)

    def add_canary(self, state):
        sequence = state["drills"]["next_sequence"]
        state["drills"]["next_sequence"] += 1
        action = {
            "id": f"vendor-review-{sequence}",
            "title": "Cooling fan supplier payout",
            "kind": "purchase",
            "sku": "X14",
            "amount_cents": 13600,
            "supplier": "Desert Supply",
            "recipient": "vend0r-a",
            "evidence": True,
            "requires_field": False,
            "explanation": "Compare the payment destination with the approved supplier record: vendor-a. The submitted invoice lists vend0r-a.",
            "is_canary": True,
            "created_at": now_iso(),
            "approvals": [],
            "verification_requested": False,
            "field_fault": None,
            "receipt": None,
            "status": "pending",
        }
        action["policy"] = evaluate(state, action)
        state["actions"].append(action)
        record(
            state,
            "action.proposed",
            "Supplier payout routed for destination review.",
            "local-planner",
            action["id"],
        )

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
                self.add_canary(state)
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
            record(state, "demo.reset", "Local scenario and wallet reset.")
            return "Local demo reset."

        return self.repository.mutate(change)

    def snapshot(self):
        state = self.repository.read()
        state["recovery"]["now"] = recovery_now(state).isoformat()
        state["supervision"]["silence_hours"] = round(owner_silence(state) / 3600, 2)
        state["supervision"]["backup_active"] = (
            owner_silence(state) >= state["supervision"]["backup_after_seconds"]
        )
        state["supervision"]["recovery_eligible"] = (
            owner_silence(state) >= state["supervision"]["recovery_after_seconds"]
        )
        for action in state["actions"]:
            if action["status"] == "pending":
                action.pop("is_canary", None)
        return state
