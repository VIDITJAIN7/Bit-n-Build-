"""The workspace against the Solidity wallet on a real local EVM (Hardhat node).

Skipped when Node.js or the npm workspace dependencies are not installed.
"""

import json
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from averlock.chain import ChainError, ChainWallet, action_key
from averlock.repository import SQLiteRepository
from averlock.service import OperationsService

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "node_modules" / "hardhat" / "dist" / "src" / "cli.js"


def rpc(url, method, *params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)})
    request = urllib.request.Request(url, body.encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response)["result"]


@pytest.fixture(scope="module")
def chain_url(tmp_path_factory):
    node = shutil.which("node")
    if not node or not CLI.exists():
        pytest.skip("Node.js workspace dependencies are not installed (run npm install)")
    subprocess.run([node, "compile.mjs"], cwd=ROOT / "contracts", check=True, capture_output=True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [node, str(CLI), "node", "--port", str(port)],
        cwd=ROOT / "contracts",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while True:
        try:
            rpc(url, "eth_chainId")
            break
        except OSError:
            if time.monotonic() > deadline or process.poll() is not None:
                process.kill()
                pytest.skip("The local Hardhat node did not start")
            time.sleep(0.3)
    yield url
    process.terminate()
    process.wait(timeout=10)


@pytest.fixture
def service(chain_url, tmp_path):
    service = OperationsService(
        SQLiteRepository(str(tmp_path / "chain.db")), wallet=ChainWallet(chain_url)
    )
    service.prepare()
    return service


def test_routine_and_approved_purchases_are_real_transactions(service):
    state, _ = service.cycle()
    fans = next(a for a in state["actions"] if a["subject"]["id"] == "stk-x14-solar")
    receipt = fans["receipt"]
    assert fans["execution_mode"] == "autonomous" and receipt["tx"].startswith("0x")
    assert receipt["signer"] == "agent" and receipt["block"] > 0
    snapshot = service.snapshot()
    chain = snapshot["chain"]
    assert chain["connected"] and chain["owner_role"] == "supervisor"
    spent = sum(a["amount_cents"] for a in state["actions"] if a.get("receipt"))
    assert snapshot["wallet"]["balance_cents"] == 1500000 - spent
    filters = next(a for a in state["actions"] if a["subject"]["id"] == "stk-p90-solar")
    state, message = service.decide(filters["id"], "approve", "supervisor")
    assert "paid on the local chain" in message
    executed = next(a for a in state["actions"] if a["id"] == filters["id"])
    assert executed["receipt"]["signer"] == "supervisor"
    # The contract refuses to pay the same action twice, even if asked directly.
    wallet = service.wallet
    used = wallet._call(
        state["chain"]["wallet"],
        "OperatingWallet",
        "usedActionIds(bytes32)",
        action_key(filters["id"]),
    )
    assert int(used, 16) == 1


def test_the_contract_caps_the_backup_even_if_the_workspace_did_not(service):
    service.advance(4)
    state = service.repository.read()
    wallet = service.wallet
    first = {
        "id": "act-direct-1",
        "title": "Direct backup payment",
        "amount_cents": 450000,
        "recipient": "vendor-a",
    }
    wallet.execute(state, first, autonomous=False, actor="backup")
    second = {**first, "id": "act-direct-2", "amount_cents": 60000}
    with pytest.raises(ChainError, match="backup absence limit"):
        wallet.execute(state, second, autonomous=False, actor="backup")


def test_guardian_recovery_transfers_authority_on_chain(service):
    service.advance(168)
    service.recover("start")
    service.recover("approve", "guardian-1")
    service.recover("approve", "guardian-2")
    service.recover("advance")
    state, _ = service.recover("finalize")
    assert state["wallet"]["owner"] == "replacement-supervisor"
    chain = service.snapshot()["chain"]
    assert chain["owner_role"] == "replacement-supervisor"
    assert chain["owner"].lower() == state["chain"]["accounts"]["replacement-supervisor"].lower()
    summaries = [entry["summary"] for entry in chain["transactions"]]
    assert "Authority transferred" in summaries
