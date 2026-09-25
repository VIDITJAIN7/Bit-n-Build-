# Averlock

**Autonomy without losing human control.**

A local field operations demo for a remote solar site. A deterministic planner connects equipment health, inventory, supplier delivery, and maintenance timing. Server-side rules run routine work, route exceptions to review, and prevent the agent from exceeding its spending limits. Technicians record equipment checks offline; only a confirmed fault report enables the supervisor to consider a replacement. An announced payment-destination exercise tests the review flow, a backup handles escalations after four simulated hours, and guardian recovery becomes eligible after a longer owner absence.

The web app, backend, and wallet use local fixtures and simulations. **No external API, account, connector, wallet, RPC node, or testnet funds are required.** Real API and identity adapters are extension points, not working integrations. The Solidity wallet is tested independently and is not connected to the interface.

## Run locally

Requirements: Node.js 22.13 or newer and Python 3.11 or newer. The repository is tested with Node.js 24 and Python 3.13.

```sh
npm install
python scripts/setup.py
npm run dev
```

Open <http://127.0.0.1:5173>. The React app proxies API requests to a local FastAPI service on port 8000. Press **Ctrl+C** to stop both services. The backend listens on loopback only.

The setup script creates `.venv`. Python dependencies are pinned in `apps/api/requirements.txt` and frozen in `apps/api/requirements.lock.txt`. Copy `.env.example` when you want to change local paths; all defaults work as-is.

## Demo in five minutes

1. **Start demo scenario**: the local agent buys two eligible cooling fans for $136 and queues an $820 order and a $4,700 inverter replacement.
2. **Review queue**: inspect the supplier, amount, recipient, policy reasons, and training-drill controls.
3. Request field verification for the inverter. **Field console** records the observation, compliance checklist, photo or labeled sample illustration, timestamp, and optional audio or text note.
4. Save while **Simulate offline** is enabled. The browser stores the report in IndexedDB. Reconnect, and it syncs to SQLite using the same idempotency key on retries.
5. Inspect the received field evidence in Review and authorize the exact replacement once. A single supervisor may approve it within the $5,000 per-transaction cap.
6. Enable the announced attention-drill program and add a demo drill. Approving a lookalike destination reveals the exercise and enables destination readback on later approvals. Drills can never execute or move funds.
7. **Authority & recovery** demonstrates backup eligibility after four simulated hours, and 2-of-3 guardian recovery after seven days of primary-owner inactivity, followed by a cancellable 48-hour timelock.

In heat mode, the checklist controls grow, optional notes collapse, and an equipment-ID readback and one-second confirmation are required. Weather values are simulation scenarios, not a live forecast.

## Tests and preview

```sh
npm test
npm run build
npm run preview --workspace @averlock/web
```

The API suite checks policy gates, field evidence validation, report retries, canary behavior, fail-closed recovery, escalation clocks, and SQLite persistence. The Solidity suite compiles against local `solc` and runs on a private in-process EVM. Neither suite uses an external RPC provider. Run the **production preview** once while online to install the service worker and precache the application shell for offline reloads; the development server does not install a worker.

On Windows PowerShell, replace `python scripts/setup.py` with `py -3 scripts/setup.py` if the `python` command is not on PATH.

## Repository map

```text
apps/
  api/averlock/       FastAPI routes, services, policy, adapters, and SQLite state
  api/tests/          API integration and invariant tests
  web/src/            React/TypeScript app, accessible screens, IndexedDB sync
contracts/
  src/                Solidity limited-purpose wallet and local demo token
  test/               Local EVM contract tests
docs/                 Preserved product brief, design decisions, demo, architecture, integrations
scripts/              Dependency setup, paired dev server, offline-shell build
```

See [docs/architecture.md](docs/architecture.md) for trust boundaries and design details, [docs/demo.md](docs/demo.md) for the walkthrough, and [docs/integrations.md](docs/integrations.md) for future connector APIs. The original longer proposal is preserved in [docs/product-brief.md](docs/product-brief.md).

## Important boundary

This is a local hackathon prototype. Demo role choices are not authentication; local signatures, field evidence, weather, wallet balances, and payments are simulations. The smart contract has not been audited and is not deployed. Do not use the prototype or example evidence to control real equipment, make real payments, or claim regulatory compliance.
