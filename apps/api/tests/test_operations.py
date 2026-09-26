import json
import random
import sqlite3
import time
from copy import deepcopy

import pytest
from averlock.adapters import SimulatedFeed, SimulatedWallet
from averlock.main import create_app
from averlock.policy import evaluate
from averlock.seed import initial_state
from fastapi.testclient import TestClient

PHOTO = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMC"
    "AO+jJz0AAAAASUVORK5CYII="
)


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db", agent_interval=0))


def post(client, path, body=None, status=200, method="post"):
    response = client.request(method.upper(), "/api" + path, json=body or {})
    assert response.status_code == status, response.text
    return response.json()


def cycle(client):
    return post(client, "/agent/cycle")["state"]


def by_trigger(state, trigger_id, subject_id=None):
    return [
        a
        for a in state["actions"]
        if a.get("trigger_id") == trigger_id and subject_id in (None, a["subject"]["id"])
    ]


def replacement(state):
    return by_trigger(state, "trg-replace", "inv-04")[-1]


def draft(**overrides):
    body = {
        "name": "Battery running low",
        "source": "assets",
        "site_id": "all",
        "mode": "auto",
        "match": "all",
        "conditions": [{"field": "battery_pct", "op": "lt", "value": 70}],
        "action": {"type": "field_check", "question": "Is {code} charging?"},
        "cooldown_minutes": 30,
    }
    body.update(overrides)
    return body


def report(task_id, id="report-unique-001", answer=True, code="INV-04"):
    return {
        "id": id,
        "task_id": task_id,
        "answer": answer,
        "note": "Observed on front panel",
        "created_at": "2026-09-26T10:00:00+00:00",
        "asset_code": code,
        "checklist": {
            "asset_matched": True,
            "work_area_checked": True,
            "protective_equipment_checked": True,
        },
        "attachments": [
            {"kind": "photo", "name": "test.png", "data_url": PHOTO, "demo_fixture": True}
        ],
    }


def verify(client, answer=True):
    action = replacement(cycle(client))
    state = post(client, f"/actions/{action['id']}/verification")["state"]
    task = next(t for t in state["field_tasks"] if t["action_id"] == action["id"])
    return action, post(client, "/reports", report(task["id"], answer=answer))


def decision(client, action_id, actor="supervisor", choice="approve", status=200, readback=""):
    return post(
        client,
        f"/actions/{action_id}/decision",
        {"actor": actor, "decision": choice, "readback": readback},
        status,
    )


def test_background_cycle_handles_routine_work_and_escalates_exceptions(client):
    state = cycle(client)
    fans = by_trigger(state, "trg-restock", "stk-x14-solar")[0]
    assert fans["supplier"] == "Desert Supply" and fans["amount_cents"] == 13600
    assert fans["status"] == "executed" and fans["execution_mode"] == "autonomous"
    assert "Solar Parts Co. is cheaper but takes 6 days" in fans["explanation"]
    pending = [a for a in state["actions"] if a["status"] == "pending"]
    assert {a["title"] for a in pending} == {"Order 20 × Air filter", "Replace Inverter 04"}
    assert replacement(state)["policy"]["level"] == "high"
    assert "Purchase is 9.2× larger than typical site purchases" in replacement(state)["policy"]["reasons"]
    assert state["stats"]["auto_handled"] == 6 and state["stats"]["alerts"] == 1
    assert [t["subject_code"] for t in state["field_tasks"]] == ["FRZ-05"]
    assert state["wallet"]["balance_cents"] == 1500000 - 13600 - 9500 - 7800
    stock = {i["sku"]: i["stock"] for i in state["inventory"]}
    assert stock["X14"] == 2 and stock["BATT-C"] == 4 and stock["SEAL-G"] == 3


def test_cycles_are_edge_triggered_and_idempotent(client):
    first = cycle(client)
    second = cycle(client)
    assert len(second["actions"]) == len(first["actions"])
    assert second["agent"]["cycles"] == 2 and second["agent"]["last_cycle_changes"] == 0


def test_operator_data_change_fires_matching_trigger(client):
    cycle(client)
    post(client, "/data/assets/inv-07", {"metrics": {"temperature_c": 85}}, method="patch")
    state = cycle(client)
    work_order = by_trigger(state, "trg-overheat", "inv-07")[0]
    assert work_order["kind"] == "work_order" and work_order["status"] == "executed"
    assert "temperature 85°C (> 70°C)" in work_order["explanation"]


def test_custom_trigger_is_created_previewed_run_and_removed(client):
    preview = post(client, "/triggers/preview", draft())
    assert preview["count"] == 1 and preview["matches"][0]["code"] == "BAT-01"
    state = post(client, "/triggers", draft())["state"]
    trigger = next(t for t in state["triggers"] if t["name"] == "Battery running low")
    assert trigger["created_by"] == "operator" and trigger["runtime"]["matches"] == ["bat-01"]
    state = cycle(client)
    task = next(t for t in state["field_tasks"] if t["trigger_id"] == trigger["id"])
    assert task["question"] == "Is BAT-01 charging?" and task["status"] == "open"
    post(client, f"/triggers/{trigger['id']}/enabled", {"enabled": False})
    post(client, f"/triggers/{trigger['id']}/run", status=409)
    state = post(client, f"/triggers/{trigger['id']}", method="delete")["state"]
    assert trigger["id"] not in {t["id"] for t in state["triggers"]}


@pytest.mark.parametrize(
    "overrides,status",
    [
        ({"conditions": [{"field": "pressure_bar", "op": "gt", "value": 3}]}, 409),
        ({"conditions": [{"field": "battery_pct", "op": "contains", "value": 3}]}, 409),
        ({"conditions": [{"field": "battery_pct", "op": "lt", "value": "low"}]}, 409),
        ({"conditions": []}, 409),
        ({"site_id": "site-mars"}, 409),
        ({"action": {"type": "restock"}}, 409),
        ({"action": {"type": "purchase", "title": "Spare"}}, 409),
        ({"conditions": [{"field": "Battery", "op": "lt", "value": 3}]}, 422),
        ({"conditions": [{"field": "battery_pct", "op": "between", "value": 3}]}, 422),
        ({"action": {"type": "webhook"}}, 422),
    ],
)
def test_trigger_drafts_are_validated_against_live_data(client, overrides, status):
    post(client, "/triggers", draft(**overrides), status)


def test_manual_runbook_only_runs_on_demand(client):
    state = cycle(client)
    assert not by_trigger(state, "trg-safety-walk")
    state = post(client, "/triggers/trg-safety-walk/run")["state"]
    codes = sorted(t["subject_code"] for t in state["field_tasks"] if t["trigger_id"] == "trg-safety-walk")
    assert codes == ["FRZ-02", "FRZ-05"]
    again = post(client, "/triggers/trg-safety-walk/run")
    assert "Nothing new" in again["message"]


def test_threshold_edit_from_control_panel_respects_cooldown(client):
    state = cycle(client)
    trigger = next(t for t in state["triggers"] if t["id"] == "trg-overheat")
    body = {k: trigger[k] for k in ("name", "description", "source", "site_id", "mode", "match")}
    body.update(
        conditions=[{"field": "temperature_c", "op": "gt", "value": 75}],
        action=trigger["action"],
        cooldown_minutes=trigger["cooldown_minutes"],
    )
    post(client, "/triggers/trg-overheat", body, method="put")
    assert len(by_trigger(cycle(client), "trg-overheat")) == 1


def test_replacement_requires_field_confirmation_then_single_supervisor(client):
    state = cycle(client)
    action = replacement(state)
    decision(client, action["id"], status=409)
    _, submitted = verify(client)
    assert replacement(submitted["state"])["field_confirmed"] is True
    state = decision(client, action["id"])["state"]
    action = replacement(state)
    assert action["status"] == "executed" and len(action["approvals"]) == 1
    assert state["wallet"]["balance_cents"] == 1500000 - 13600 - 9500 - 7800 - 470000
    decision(client, action["id"], status=409)


def test_negative_field_check_keeps_replacement_blocked(client):
    action, _ = verify(client, answer=False)
    decision(client, action["id"], status=409)


def test_field_retry_is_idempotent_and_conflicting_retry_rejected(client):
    action, original = verify(client)
    task_id = original["state"]["reports"][-1]["task_id"]
    duplicate = post(client, "/reports", report(task_id))["state"]
    assert duplicate["reports"] == original["state"]["reports"]
    assert len(duplicate["audit"]) == len(original["state"]["audit"])
    different = report(task_id)
    different["note"] = "changed"
    post(client, "/reports", different, 409)
    decision(client, action["id"])
    post(client, "/reports", report(task_id))


@pytest.mark.parametrize("mutation", ["missing_check", "wrong_asset", "missing_photo", "wrong_mime"])
def test_compliance_requirements_are_enforced_on_server(client, mutation):
    action = replacement(cycle(client))
    state = post(client, f"/actions/{action['id']}/verification")["state"]
    data = report(state["field_tasks"][-1]["id"])
    if mutation == "missing_check":
        data["checklist"]["work_area_checked"] = False
    if mutation == "wrong_asset":
        data["asset_code"] = "INV-99"
    if mutation == "missing_photo":
        data["attachments"][0]["kind"] = "audio"
    if mutation == "wrong_mime":
        data["attachments"][0]["data_url"] = "data:audio/webm;base64,YWJj"
    post(client, "/reports", data, 409)


def test_evidence_media_is_served_outside_the_state_document(client):
    _, submitted = verify(client)
    stored = submitted["state"]["reports"][-1]
    assert "data_url" not in json.dumps(submitted["state"])
    assert stored["attachments"][0]["sha256"] and stored["action_id"]
    photo = client.get(f"/api/reports/{stored['id']}/media/photo")
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/png"
    assert client.get(f"/api/reports/{stored['id']}/media/audio").status_code == 404


def test_human_approved_restock_updates_inventory_and_credits_approver(client):
    state = cycle(client)
    filters = by_trigger(state, "trg-restock", "stk-p90-solar")[0]
    state = decision(client, filters["id"])["state"]
    assert next(i for i in state["inventory"] if i["sku"] == "P90")["stock"] == 23
    executed = [e for e in state["audit"] if e["event"] == "action.executed"][-1]
    assert executed["actor"] == "supervisor"


def test_agent_can_be_paused_and_resumed(client):
    post(client, "/agent", {"enabled": False})
    state = cycle(client)
    assert state["agent"]["cycles"] == 0 and state["actions"] == []
    post(client, "/agent", {"enabled": True})
    assert cycle(client)["agent"]["cycles"] == 1


def test_exhausted_agent_budget_routes_routine_purchases_to_review(client):
    service = client.app.state.service

    def spend(state):
        state["wallet"]["agent_spent_cents"] = 99000

    service.repository.mutate(spend)
    fans = by_trigger(cycle(client), "trg-restock", "stk-x14-solar")[0]
    assert fans["status"] == "pending"
    assert "Exceeds the remaining autonomous daily budget" in fans["policy"]["reasons"]


def test_edited_supplier_destination_cannot_be_paid_autonomously(client):
    cycle(client)
    post(client, "/data/suppliers/sup-desert", {"recipient": "vendor-a-new"}, method="patch")
    post(client, "/data/inventory/stk-x14-solar", {"stock": 0}, method="patch")
    post(client, "/demo/clock", {"hours": 4})
    fans = by_trigger(cycle(client), "trg-restock", "stk-x14-solar")[-1]
    assert fans["status"] == "pending" and fans["policy"]["level"] == "high"
    assert "New payment destination" in fans["policy"]["reasons"]


def test_operator_data_is_validated(client):
    asset = {"site_id": "site-cold", "code": "FRZ-09", "name": "Freezer 09", "type": "Freezer"}
    post(client, "/data/assets", {**asset, "metrics": {"name": 1}}, 409)
    post(client, "/data/assets", {**asset, "site_id": "site-mars"}, 409)
    post(client, "/data/assets", {**asset, "code": "bad code!"}, 422)
    state = post(client, "/data/assets", {**asset, "metrics": {"humidity_pct": 40}})["state"]
    post(client, "/data/assets", asset, 409)
    humidity = next(f for f in state["schema"]["assets"] if f["key"] == "humidity_pct")
    assert humidity["type"] == "number" and humidity["label"] == "Humidity pct"
    post(client, "/data/sites/site-cold", method="delete", status=409)


def test_bad_input_and_failed_approval_are_atomic(client):
    action = replacement(cycle(client))
    post(client, "/demo/clock", {"hours": 4})
    before = client.get("/api/state").json()
    decision(client, action["id"], status=409)
    after = client.get("/api/state").json()
    assert after["supervision"]["last_owner_action"] == before["supervision"]["last_owner_action"]
    assert after["audit"] == before["audit"]
    post(client, f"/actions/{action['id']}/decision", {"actor": "agent", "decision": "approve"}, 422)
    post(
        client,
        f"/actions/{action['id']}/decision",
        {"actor": "supervisor", "decision": "approve", "bypass": True},
        422,
    )


def test_untrusted_planner_cannot_self_approve_supplier_or_ignore_budget(client):
    state = cycle(client)
    action = deepcopy(by_trigger(state, "trg-restock", "stk-x14-solar")[0])
    action.update(supplier_id="sup-unknown", approved_supplier=True)
    assert evaluate(state, action)["auto_allowed"] is False
    action["supplier_id"] = "sup-desert"
    state["wallet"]["agent_spent_cents"] = 99000
    assert evaluate(state, action)["auto_allowed"] is False
    action["amount_cents"] = 500001
    assert evaluate(state, action)["hard_blocks"]
    assert evaluate(state, {**action, "kind": "work_order", "amount_cents": 500})["hard_blocks"]


def test_canary_never_pays_and_missed_drill_requires_readback(client):
    state = cycle(client)
    filters = by_trigger(state, "trg-restock", "stk-p90-solar")[0]
    post(client, "/drills", {"operation": "inject"}, 409)
    post(client, "/drills", {"operation": "enable"})
    state = post(client, "/drills", {"operation": "inject"})["state"]
    canary = state["actions"][-1]
    assert canary["id"].startswith("act-") and canary["status"] == "pending"
    assert "is_canary" not in canary and "canary_expected" not in canary
    balance = state["wallet"]["balance_cents"]
    response = decision(client, canary["id"])
    state = response["state"]
    assert "Training reveal" in response["message"]
    resolved = next(a for a in state["actions"] if a["id"] == canary["id"])
    assert resolved["status"] == "drill_resolved" and resolved["receipt"] is None
    assert resolved["canary_expected"] != resolved["recipient"]
    assert state["wallet"]["balance_cents"] == balance
    assert state["drills"]["stats"]["supervisor"]["enhanced"]
    decision(client, filters["id"], status=409)
    decision(client, filters["id"], readback="vendor-a")


def test_two_caught_drills_restore_standard_friction(client):
    post(client, "/drills", {"operation": "enable"})
    canary = post(client, "/drills", {"operation": "inject"})["state"]["actions"][-1]
    decision(client, canary["id"])
    for _ in range(2):
        canary = post(client, "/drills", {"operation": "inject"})["state"]["actions"][-1]
        state = decision(client, canary["id"], choice="reject")["state"]
    assert state["drills"]["stats"]["supervisor"] == {
        "caught": 2,
        "missed": 1,
        "enhanced": False,
        "pass_streak": 2,
    }


def test_wallet_adapter_also_blocks_canaries():
    with pytest.raises(ValueError, match="never execute"):
        SimulatedWallet().execute(initial_state(), {"is_canary": True}, False)


def test_only_primary_human_action_refreshes_availability(client):
    before = client.get("/api/state").json()["supervision"]["last_owner_action"]
    post(client, "/demo/clock", {"hours": 4})
    state = cycle(client)
    assert (
        state["supervision"]["last_owner_action"] == before
        and state["supervision"]["backup_active"]
    )
    filters = by_trigger(state, "trg-restock", "stk-p90-solar")[0]
    state = decision(client, filters["id"], actor="backup")["state"]
    assert state["supervision"]["last_owner_action"] == before
    executed = [e for e in state["audit"] if e["event"] == "action.executed"][-1]
    assert executed["actor"] == "backup"
    state = decision(client, replacement(state)["id"], choice="reject")["state"]
    assert (
        state["supervision"]["last_owner_action"] != before
        and not state["supervision"]["backup_active"]
    )


def test_backup_requires_escalation_window(client):
    filters = by_trigger(cycle(client), "trg-restock", "stk-p90-solar")[0]
    decision(client, filters["id"], actor="backup", status=409)
    post(client, "/demo/clock", {"hours": 4})
    decision(client, filters["id"], actor="backup")


def test_recovery_requires_silence_quorum_timelock_and_revokes_old_owner(client):
    state = cycle(client)
    balance = state["wallet"]["balance_cents"]
    filters = by_trigger(state, "trg-restock", "stk-p90-solar")[0]
    post(client, "/recovery", {"operation": "start"}, 409)
    post(client, "/demo/clock", {"hours": 168})
    post(client, "/recovery", {"operation": "start"})
    post(client, "/recovery", {"operation": "approve", "actor": "guardian-1"})
    post(client, "/recovery", {"operation": "approve", "actor": "guardian-1"}, 409)
    post(client, "/recovery", {"operation": "advance"}, 409)
    post(client, "/recovery", {"operation": "approve", "actor": "guardian-2"})
    post(client, "/recovery", {"operation": "finalize"}, 409)
    post(client, "/recovery", {"operation": "advance"})
    state = post(client, "/recovery", {"operation": "finalize"})["state"]
    assert (
        state["wallet"]["owner"] == "replacement-supervisor"
        and state["wallet"]["balance_cents"] == balance
    )
    decision(client, filters["id"], actor="supervisor", status=409)
    decision(client, filters["id"], actor="replacement-supervisor")


def test_recovery_can_be_cancelled_only_by_owner(client):
    post(client, "/demo/clock", {"hours": 168})
    post(client, "/recovery", {"operation": "start"})
    post(client, "/recovery", {"operation": "cancel", "actor": "guardian-1"}, 409)
    state = post(client, "/recovery", {"operation": "cancel", "actor": "supervisor"})["state"]
    assert state["recovery"]["stage"] == "idle" and not state["supervision"]["backup_active"]
    post(client, "/recovery", {"operation": "finalize"}, 409)


def test_heat_scenario_and_reset(client):
    cycle(client)
    state = post(client, "/weather/scenario", {"hot": True})["state"]
    assert state["weather"]["high_heat"] and state["weather"]["heat_index_c"] == 46
    state = post(client, "/demo/reset")["state"]
    assert state["actions"] == [] and not state["weather"]["high_heat"]
    assert len(state["triggers"]) == len(initial_state()["triggers"])


def test_sqlite_persists_across_application_instances(tmp_path):
    path = tmp_path / "persistent.db"
    state = TestClient(create_app(path, agent_interval=0)).post("/api/agent/cycle").json()["state"]
    saved = TestClient(create_app(path, agent_interval=0)).get("/api/state").json()
    assert saved["actions"] == state["actions"] and saved["wallet"] == state["wallet"]


def test_databases_from_the_previous_version_are_reseeded(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)")
        db.execute("INSERT INTO state VALUES (1, ?)", (json.dumps({"scenario_ran": True}),))
    db.close()
    state = TestClient(create_app(path, agent_interval=0)).get("/api/state").json()
    assert state["triggers"] and "scenario_ran" not in state


def test_background_loop_runs_without_user_commands(tmp_path):
    with TestClient(create_app(tmp_path / "loop.db", agent_interval=0.05)) as live:
        deadline = time.monotonic() + 5
        while live.get("/api/state").json()["agent"]["cycles"] < 2:
            assert time.monotonic() < deadline, "background agent never cycled"
            time.sleep(0.05)
        assert live.get("/api/state").json()["stats"]["auto_handled"] == 6


def test_simulated_feed_is_bounded_and_reproducible():
    first, second = initial_state(), initial_state()
    feed_a, feed_b = SimulatedFeed(random.Random(4)), SimulatedFeed(random.Random(4))
    changes = sum(feed_a.step(first) for _ in range(200))
    for _ in range(200):
        feed_b.step(second)
    assert changes and first["assets"] == second["assets"]
    assert first["inventory"] == second["inventory"]
    metrics = [m for a in first["assets"] for m in a["metrics"].items()]
    assert all(0 <= v <= 100 for k, v in metrics if k.endswith("_pct"))
    assert all(i["stock"] >= 0 for i in first["inventory"])
