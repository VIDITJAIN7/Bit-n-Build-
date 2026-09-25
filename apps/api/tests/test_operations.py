from copy import deepcopy

import pytest
from averlock.adapters import SimulatedWallet
from averlock.main import create_app
from averlock.policy import evaluate
from averlock.seed import initial_state
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))


def post(client, path, body=None, status=200):
    response = client.post("/api" + path, json=body or {})
    assert response.status_code == status, response.text
    return response.json()


def scenario(client):
    return post(client, "/scenario/run")["state"]


def report(id="report-unique-001", fault=True):
    return {
        "id": id,
        "action_id": "inverter-04",
        "fault": fault,
        "note": "Observed on front panel",
        "created_at": "2026-09-25T10:00:00+00:00",
        "asset_id": "INV-04",
        "checklist": {
            "asset_matched": True,
            "work_area_checked": True,
            "protective_equipment_checked": True,
        },
        "attachments": [
            {
                "kind": "photo",
                "name": "test.png",
                "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJz0AAAAASUVORK5CYII=",
                "demo_fixture": True,
            }
        ],
    }


def verify(client, fault=True):
    post(client, "/actions/inverter-04/verification")
    return post(client, "/reports", report(fault=fault))


def decision(client, action, actor="supervisor", choice="approve", status=200, readback=""):
    return post(
        client,
        f"/actions/{action}/decision",
        {"actor": actor, "decision": choice, "readback": readback},
        status,
    )


def test_planner_uses_inventory_lead_time_and_is_idempotent(client):
    state = scenario(client)
    fans = next(a for a in state["actions"] if a["id"] == "fans-x14")
    assert fans["supplier"] == "Desert Supply" and fans["amount_cents"] == 13600
    assert fans["status"] == "executed" and fans["execution_mode"] == "autonomous"
    assert state["wallet"]["balance_cents"] == 1500000 - 13600
    repeated = scenario(client)
    assert repeated["actions"] == state["actions"]
    assert repeated["wallet"]["receipts"] == state["wallet"]["receipts"]
    assert {a["policy"]["level"] for a in state["actions"]} == {"low", "review", "high"}


def test_inverter_requires_compliance_evidence_then_single_supervisor(client):
    scenario(client)
    decision(client, "inverter-04", status=409)
    verify(client)
    state = decision(client, "inverter-04")["state"]
    action = next(a for a in state["actions"] if a["id"] == "inverter-04")
    assert action["status"] == "executed" and len(action["approvals"]) == 1
    assert state["wallet"]["balance_cents"] == 1500000 - 13600 - 470000
    decision(client, "inverter-04", status=409)


def test_negative_fault_keeps_replacement_blocked(client):
    scenario(client)
    verify(client, fault=False)
    decision(client, "inverter-04", status=409)


def test_field_retry_is_idempotent_and_conflicting_retry_rejected(client):
    scenario(client)
    original = verify(client)["state"]
    duplicate = post(client, "/reports", report())["state"]
    assert duplicate["reports"] == original["reports"]
    assert len(duplicate["audit"]) == len(original["audit"])
    different = report()
    different["note"] = "changed"
    post(client, "/reports", different, 409)
    decision(client, "inverter-04")
    post(client, "/reports", report())


@pytest.mark.parametrize(
    "mutation", ["missing_check", "wrong_asset", "missing_photo", "wrong_mime"]
)
def test_compliance_requirements_are_enforced_on_server(client, mutation):
    scenario(client)
    post(client, "/actions/inverter-04/verification")
    data = report()
    if mutation == "missing_check":
        data["checklist"]["work_area_checked"] = False
    if mutation == "wrong_asset":
        data["asset_id"] = "INV-99"
    if mutation == "missing_photo":
        data["attachments"][0]["kind"] = "audio"
    if mutation == "wrong_mime":
        data["attachments"][0]["data_url"] = "data:audio/webm;base64,YWJj"
    post(client, "/reports", data, 409)


def test_bad_input_and_failed_approval_are_atomic(client):
    scenario(client)
    post(client, "/demo/clock", {"hours": 4})
    before = client.get("/api/state").json()
    decision(client, "inverter-04", status=409)
    after = client.get("/api/state").json()
    assert after["supervision"]["last_owner_action"] == before["supervision"]["last_owner_action"]
    assert after["audit"] == before["audit"]
    post(client, "/actions/inverter-04/decision", {"actor": "agent", "decision": "approve"}, 422)
    post(
        client,
        "/actions/inverter-04/decision",
        {"actor": "supervisor", "decision": "approve", "bypass": True},
        422,
    )


def test_untrusted_planner_cannot_self_approve_supplier_or_ignore_budget(client):
    state = scenario(client)
    action = deepcopy(state["actions"][0])
    action.update(supplier="Unknown", approved_supplier=True)
    assert evaluate(state, action)["auto_allowed"] is False
    action["supplier"] = "Desert Supply"
    state["wallet"]["agent_spent_cents"] = 99000
    assert evaluate(state, action)["auto_allowed"] is False
    action["amount_cents"] = 500001
    assert evaluate(state, action)["hard_blocks"]


def test_canary_never_pays_and_missed_drill_requires_readback(client):
    scenario(client)
    post(client, "/drills", {"operation": "inject"}, 409)
    post(client, "/drills", {"operation": "enable"})
    state = post(client, "/drills", {"operation": "inject"})["state"]
    balance = state["wallet"]["balance_cents"]
    assert "is_canary" not in state["actions"][-1]
    response = decision(client, "vendor-review-1")
    state = response["state"]
    assert "Training reveal" in response["message"]
    assert state["wallet"]["balance_cents"] == balance
    assert (
        state["actions"][-1]["status"] == "drill_resolved"
        and state["actions"][-1]["receipt"] is None
    )
    assert state["drills"]["stats"]["supervisor"]["enhanced"]
    decision(client, "filters-p90", status=409)
    decision(client, "filters-p90", readback="vendor-a")


def test_two_caught_drills_restore_standard_friction(client):
    scenario(client)
    post(client, "/drills", {"operation": "enable"})
    post(client, "/drills", {"operation": "inject"})
    decision(client, "vendor-review-1")
    for number in (2, 3):
        post(client, "/drills", {"operation": "inject"})
        state = decision(client, f"vendor-review-{number}", choice="reject")["state"]
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
    state = scenario(client)
    assert (
        state["supervision"]["last_owner_action"] == before
        and state["supervision"]["backup_active"]
    )
    state = decision(client, "filters-p90", actor="backup")["state"]
    assert state["supervision"]["last_owner_action"] == before
    state = decision(client, "inverter-04", choice="reject")["state"]
    assert (
        state["supervision"]["last_owner_action"] != before
        and not state["supervision"]["backup_active"]
    )


def test_backup_requires_escalation_window(client):
    scenario(client)
    decision(client, "filters-p90", actor="backup", status=409)
    post(client, "/demo/clock", {"hours": 4})
    decision(client, "filters-p90", actor="backup")


def test_recovery_requires_silence_quorum_timelock_and_revokes_old_owner(client):
    scenario(client)
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
        and state["wallet"]["balance_cents"] == 1486400
    )
    decision(client, "filters-p90", actor="supervisor", status=409)
    decision(client, "filters-p90", actor="replacement-supervisor")


def test_recovery_can_be_cancelled_only_by_owner(client):
    post(client, "/demo/clock", {"hours": 168})
    post(client, "/recovery", {"operation": "start"})
    post(client, "/recovery", {"operation": "cancel", "actor": "guardian-1"}, 409)
    state = post(client, "/recovery", {"operation": "cancel", "actor": "supervisor"})["state"]
    assert state["recovery"]["stage"] == "idle" and not state["supervision"]["backup_active"]
    post(client, "/recovery", {"operation": "finalize"}, 409)


def test_heat_scenario_and_reset(client):
    state = post(client, "/weather/scenario", {"hot": True})["state"]
    assert state["weather"]["high_heat"] and state["weather"]["heat_index_c"] == 46
    state = post(client, "/demo/reset")["state"]
    assert state["actions"] == [] and not state["weather"]["high_heat"]


def test_sqlite_persists_across_application_instances(tmp_path):
    path = tmp_path / "persistent.db"
    state = scenario(TestClient(create_app(path)))
    saved = TestClient(create_app(path)).get("/api/state").json()
    assert saved["actions"] == state["actions"] and saved["wallet"] == state["wallet"]
