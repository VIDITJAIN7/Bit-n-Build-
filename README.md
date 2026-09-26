# Workkite

Workkite coordinates operations across distributed sites. Administrators define task rules from workspace data; the background agent creates work, workers record field evidence, and policy routes consequential actions for approval.

## Product areas

- **Overview:** open incidents, items needing review, what the agent handled on its own versus what needed a person, and every task rule as a live tile you can run, pause, or retune in place.
- **Task rules:** configure data conditions, worker tasks and report fields, notifications, restocking, or purchase requests.
- **Worker tasks:** mobile-first forms with large controls, equipment readback, offline report storage, and retry-safe sync. Workers can also report an incident (injury, heat illness, fire, spill…) in two taps and a hold, with an optional photo and location; it is saved on the phone first and syncs when a connection returns.
- **Review:** exceptional actions with plain-language reasons, including a workspace-trained anomaly model (an isolation forest over past purchases) that can escalate unusual purchases inside every limit. Announced attention checks and a pace check ask for a readback when approvals become reflexive.
- **Access:** backup approval after 4 hours (capped for the whole absence), guardian recovery after 7 days, and optionally the same rules enforced by the Solidity wallet on a local chain.
- **Workspace data:** manage sites, assets, readings, inventory, and suppliers. Rules discover fields from saved data.

Rules and task definitions are stored as workspace records and can be created, edited, paused, or deleted through the application. Solar operations are included as editable workspace content; the engine itself is industry-neutral.

## Run locally

Requirements: Node.js 22.12+, Python 3.11+, and npm.

```powershell
npm run setup
Copy-Item .env.example .env
```

Set `WORKKITE_LOCAL_USERS_JSON` in `.env` to a JSON array of local sign-in users, each with `email`, `password`, and `role` (`admin` or `worker`). Keep `.env` private. Then start the services:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. The API binds to loopback on port 8000. Stop both services with **Ctrl+C**.

To run payments, owner decisions, and guardian recovery as real transactions against the Solidity wallet, start the stack with a local Hardhat devnet instead:

```powershell
npm run dev:chain
```

This compiles the contracts, starts a node on `127.0.0.1:8545` (or reuses one already running), deploys a demo token and the `OperatingWallet`, and points the API at it. Development accounts on that node are unlocked: it is a demo network, not key management. The **Access** page shows the contract, its owner, and recent transactions; the **Activity** page lists each payment's transaction hash.

The **Simulation controls** at the bottom of the Overview fast-forward normal operations (1, 7, or 30 days), toggle the sensor feed, insert a practice approval, simulate a heat wave, and reset the workspace. The **Access** page can simulate time away to demonstrate backup approval and recovery.

## Configuration and integrations

Copyable configuration is in `.env.example`. Provider secrets belong only in the API environment. The AI risk reviewer is an optional adapter; deterministic policy remains authoritative and the model cannot approve or execute actions. See [provider and identity integrations](docs/integrations.md) and the [Vercel + Supabase deployment guide](docs/deployment-vercel-supabase.md).

The current local workspace uses SQLite and either a simulated payment adapter or the local-chain adapter. The local sign-in endpoint only selects a configured role; it does not secure the API. Before public hosting, connect verified authentication, enforce authorization on every API route, replace SQLite with tenant-scoped Postgres/RLS, and connect production telemetry, weather, storage, notifications, and wallet providers as needed.

## Development checks

```powershell
npm run build
npm test
```

The API suite covers task-rule evaluation, policy, the anomaly model, time-lapse volume, attention and pace checks, reports, incidents, recovery, and persistence. When the npm dependencies are installed it also drives the chain wallet against a real Hardhat node. The contract suite runs against a private local EVM.

## Repository layout

```text
apps/api/       FastAPI service, automation, policy, adapters, and SQLite repository
apps/web/       React interface and offline worker-report queue
contracts/      Solidity operating-wallet reference
supabase/       Production schema planning
scripts/        Local development and verification commands
docs/           Architecture, integrations, and deployment notes
deploy/         Deployment configuration examples
```
