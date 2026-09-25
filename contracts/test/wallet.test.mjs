import { test } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import {
  BrowserProvider,
  ContractFactory,
  encodeBytes32String,
  ZeroAddress,
} from "ethers";
import { compile } from "../compile.mjs";

const artifacts = compile();
const units = (value) => BigInt(value) * 1_000_000n;
const id = (value) => encodeBytes32String(value);

async function fixture(t) {
  const connection = await network.create("local");
  t.after(() => connection.close());
  const provider = new BrowserProvider(connection.provider);
  const signers = await Promise.all(
    Array.from({ length: 9 }, (_, i) => provider.getSigner(i)),
  );
  const [owner, agent, backup, g1, g2, g3, nextOwner, vendor, outsider] =
    signers;
  const token = await new ContractFactory(
    artifacts.MockUSDC.abi,
    artifacts.MockUSDC.evm.bytecode.object,
    owner,
  ).deploy();
  await token.waitForDeployment();
  const wallet = await new ContractFactory(
    artifacts.OperatingWallet.abi,
    artifacts.OperatingWallet.evm.bytecode.object,
    owner,
  ).deploy(
    await token.getAddress(),
    owner.address,
    agent.address,
    backup.address,
    [g1.address, g2.address, g3.address],
  );
  await wallet.waitForDeployment();
  await (await token.mint(await wallet.getAddress(), units(15000))).wait();
  await (await wallet.setRecipient(vendor.address, true)).wait();
  const advance = async (seconds) => {
    await connection.provider.request({
      method: "evm_increaseTime",
      params: [seconds],
    });
    await connection.provider.request({ method: "evm_mine", params: [] });
  };
  return {
    wallet,
    token,
    owner,
    agent,
    backup,
    g1,
    g2,
    g3,
    nextOwner,
    vendor,
    outsider,
    advance,
  };
}

test("agent cannot exceed immutable caps, use unapproved recipients, or replay actions", async (t) => {
  const { wallet, token, agent, vendor, outsider } = await fixture(t);
  await assert.rejects(
    wallet
      .connect(agent)
      .executeAgent.staticCall(id("too-big"), vendor.address, units(251)),
  );
  await assert.rejects(
    wallet
      .connect(agent)
      .executeAgent.staticCall(id("unknown"), outsider.address, units(20)),
  );
  await assert.rejects(
    wallet
      .connect(agent)
      .executeSupervisor.staticCall(
        id("role-bypass"),
        vendor.address,
        units(4700),
      ),
  );
  for (let i = 0; i < 4; i++)
    await (
      await wallet
        .connect(agent)
        .executeAgent(id(`spend-${i}`), vendor.address, units(250))
    ).wait();
  await assert.rejects(
    wallet
      .connect(agent)
      .executeAgent.staticCall(id("daily"), vendor.address, units(1)),
  );
  await assert.rejects(
    wallet
      .connect(agent)
      .executeAgent.staticCall(id("spend-0"), vendor.address, units(1)),
  );
  assert.equal(await token.balanceOf(vendor.address), units(1000));
});

test("agent activity never refreshes owner availability; backup activates after four hours", async (t) => {
  const { wallet, agent, backup, vendor, advance } = await fixture(t);
  const before = await wallet.lastOwnerAction();
  await advance(7200);
  await (
    await wallet
      .connect(agent)
      .executeAgent(id("routine"), vendor.address, units(136))
  ).wait();
  assert.equal(await wallet.lastOwnerAction(), before);
  await assert.rejects(
    wallet
      .connect(backup)
      .executeSupervisor.staticCall(id("early"), vendor.address, units(4700)),
  );
  await advance(7201);
  await (
    await wallet
      .connect(backup)
      .executeSupervisor(id("backup"), vendor.address, units(4700))
  ).wait();
  assert.equal(await wallet.lastOwnerAction(), before);
});

test("signed primary decisions reset availability; others cannot imitate them", async (t) => {
  const { wallet, owner, agent, advance } = await fixture(t);
  await advance(15000);
  assert.equal(await wallet.backupActive(), true);
  await assert.rejects(
    wallet.connect(agent).recordDecision.staticCall(id("fake"), true),
  );
  await (
    await wallet.connect(owner).recordDecision(id("reject-real-request"), false)
  ).wait();
  assert.equal(await wallet.backupActive(), false);
});

test("one supervisor can authorize 4700 but cannot exceed the wallet transaction cap", async (t) => {
  const { wallet, token, owner, vendor, outsider } = await fixture(t);
  await assert.rejects(
    wallet
      .connect(outsider)
      .executeSupervisor.staticCall(
        id("unauthorized"),
        vendor.address,
        units(4700),
      ),
  );
  await assert.rejects(
    wallet
      .connect(owner)
      .executeSupervisor.staticCall(
        id("over-cap"),
        vendor.address,
        units(5001),
      ),
  );
  await (
    await wallet
      .connect(owner)
      .executeSupervisor(id("single-human"), vendor.address, units(4700))
  ).wait();
  assert.equal(await token.balanceOf(vendor.address), units(4700));
  await assert.rejects(
    wallet
      .connect(owner)
      .executeSupervisor.staticCall(
        id("single-human"),
        vendor.address,
        units(4700),
      ),
  );
});

test("recovery requires long silence, unique guardian quorum and elapsed timelock; funds stay put", async (t) => {
  const { wallet, token, owner, g1, g2, nextOwner, vendor, advance } =
    await fixture(t);
  await assert.rejects(
    wallet.connect(g1).initiateRecovery.staticCall(nextOwner.address),
  );
  await advance(7 * 86400 + 1);
  await (await wallet.connect(g1).initiateRecovery(nextOwner.address)).wait();
  await (await wallet.connect(g1).approveRecovery()).wait();
  await assert.rejects(wallet.connect(g1).approveRecovery.staticCall());
  await assert.rejects(wallet.finalizeRecovery.staticCall());
  await (await wallet.connect(g2).approveRecovery()).wait();
  await assert.rejects(wallet.finalizeRecovery.staticCall());
  await advance(48 * 3600 + 1);
  await (await wallet.finalizeRecovery()).wait();
  assert.equal(await wallet.owner(), nextOwner.address);
  assert.equal(await token.balanceOf(await wallet.getAddress()), units(15000));
  await assert.rejects(
    wallet
      .connect(owner)
      .executeSupervisor.staticCall(id("old-owner"), vendor.address, units(10)),
  );
  await (
    await wallet
      .connect(nextOwner)
      .executeSupervisor(id("new-owner"), vendor.address, units(10))
  ).wait();
});

test("owner cancellation invalidates the recovery and guardians cannot replay old votes", async (t) => {
  const { wallet, owner, g1, g2, nextOwner, advance } = await fixture(t);
  await advance(7 * 86400 + 1);
  await (await wallet.connect(g1).initiateRecovery(nextOwner.address)).wait();
  await (await wallet.connect(g1).approveRecovery()).wait();
  await (await wallet.connect(g2).approveRecovery()).wait();
  await (await wallet.connect(owner).cancelRecovery()).wait();
  assert.equal(await wallet.recoveryCandidate(), ZeroAddress);
  await advance(48 * 3600 + 1);
  await assert.rejects(wallet.finalizeRecovery.staticCall());
  assert.equal(await wallet.owner(), owner.address);
  await advance(7 * 86400);
  await (await wallet.connect(g1).initiateRecovery(nextOwner.address)).wait();
  assert.equal(await wallet.recoveryVotes(), 0n);
  await (await wallet.connect(g1).approveRecovery()).wait();
  assert.equal(await wallet.recoveryVotes(), 1n);
});
