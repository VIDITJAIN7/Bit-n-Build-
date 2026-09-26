# Averlock

**Autonomy without losing human control.**

An operations control plane for teams that run physical sites: solar farms, telecom towers, cold stores, fleets, plants. Operators keep their site data in Averlock (assets and their live readings, inventory, suppliers, sites) and build **triggers**: _when a field crosses a value, do something_. Each trigger appears as a live tile on a control panel, where its threshold can be adjusted in place. A **background agent** evaluates every trigger against the data every few seconds and proposes work orders, restocks, field checks, alerts, and purchases. There is no "run" button.

Every proposal crosses the same deterministic **policy gate**. Routine work runs on its own, exceptions go to a review queue with the reasons attached, and the agent can never exceed its spending limits. Technicians answer field checks offline; a confirmed on-site answer is what unlocks a gated purchase. A backup approver takes over escalations after four simulated hours, and guardian recovery becomes eligible after a longer owner absence.

The sample workspace has three sites in different industries (a solar farm, a telecom tower, and a cold-chain warehouse) with seven triggers. Nothing is industry-specific: add a site, an asset with any reading (for example `pressure_bar`), or a supplier in **Data**, and the trigger builder offers it immediately.

The web app, backend, and wallet use local fixtures and simulations. **No external API, account, connector, wallet, RPC node, or testnet funds are required.** Real API and identity adapters are extension points, not working integrations. The Solidity wallet is tested independently and is not connected to the interface.

## Run locally

Requirements: Node.js 22.13 or newer and Python 3.11 or newer. The repository is tested with Node.js 24 and Python 3.13.

```sh
npm install
python scripts/setup.py
npm run dev
```

Open <http://127.0.0.1:5173>. The React app proxies API requests to a local FastAPI service on port 8000, which also runs the background agent (every 5 seconds; set `AVERLOCK_AGENT_INTERVAL` to change it, or `0` to disable the loop). Press **Ctrl+C** to stop both services. The backend listens on loopback only.

The setup script creates `.venv`. Python dependencies are pinned in `apps/api/requirements.txt` and frozen in `apps/api/requirements.lock.txt`. Copy `.env.example` when you want to change local paths; all defaults work as-is.

## Demo in five minutes

1. **Control panel.** The agent's first cycle has already run: routine restocks, work orders, and a field check are handled, one alert is raised, and two decisions wait: an $820 filter order above the $250 agent limit, and a $4,700 inverter replacement from an unapproved supplier with a new payment destination, 9.2× a typical purchase.
2. **Data.** Change INV-07's temperature to 85. Within one cycle, the "Overheating equipment" tile matches it and the agent files a work order on its own.
3. **Triggers.** Pick the "Battery low → field check" template, set the threshold to 70 %, watch the live preview match BAT-01, and create it. It appears as a tile, and the next cycle dispatches the check.
4. Retune any tile in place (for example, Overheating above 90 °C) or press **Run** on the "Site safety walk" runbook to send checks on demand.
5. **Review queue.** Request verification on the replacement. In **Field console**, pick the INV-04 task, answer, complete the checklist, attach a photo or the labeled demo illustration, and save. With **Simulate offline** on, the report waits in IndexedDB and syncs on reconnect using the same idempotency key.
6. Back in Review, inspect the evidence and authorize the exact replacement once. The simulated wallet pays and a `sim-…` receipt enters the audit log.
7. Enable the announced drill program to insert a lookalike-destination exercise, and use **Authority & recovery** to show backup eligibility after four simulated hours and 2-of-3 guardian recovery after seven days, followed by a cancellable 48-hour timelock.

Turn on **Simulated sensor feed** on the control panel to let readings drift and stock deplete, so triggers keep firing on their own. In heat mode, the field checklist grows, optional notes collapse, and an equipment-ID readback and one-second confirmation are required. Weather values are simulation scenarios, not a live forecast.

## Tests and preview

```sh
npm test
npm run build
npm run preview --workspace @averlock/web
```

The API suite checks trigger validation against live data, edge-triggered background cycles, data-driven firing, manual runbooks, policy gates, field evidence validation and idempotent retries, evidence media stored outside the state document, drills, fail-closed recovery, escalation clocks, the background loop, and SQLite persistence. The Solidity suite compiles against local `solc` and runs on a private in-process EVM. Neither suite uses an external RPC provider. Run the **production preview** once while online to install the service worker and precache the application shell for offline reloads; the development server does not install a worker.

On Windows PowerShell, replace `python scripts/setup.py` with `py -3 scripts/setup.py` if the `python` command is not on PATH.

## Repository map

```text
apps/
  api/averlock/       FastAPI routes, background agent, trigger engine, policy, adapters, SQLite state
  api/tests/          API integration and invariant tests
  web/src/            React/TypeScript app: control panel, trigger builder, data editor,
                      review queue, field console, recovery, activity log
contracts/
  src/                Solidity limited-purpose wallet and local demo token
  test/               Local EVM contract tests
docs/                 Preserved product brief, design decisions, demo, architecture, integrations
scripts/              Dependency setup, paired dev server, offline-shell build
```

See [docs/architecture.md](docs/architecture.md) for trust boundaries and design details, [docs/demo.md](docs/demo.md) for the walkthrough, and [docs/integrations.md](docs/integrations.md) for future connector APIs. The original longer proposal is preserved in [docs/product-brief.md](docs/product-brief.md).

## Important boundary

This is a local hackathon prototype. Demo role choices are not authentication; local signatures, field evidence, sensor readings, weather, wallet balances, and payments are simulations. The smart contract has not been audited and is not deployed. Do not use the prototype or example evidence to control real equipment, make real payments, or claim regulatory compliance.
