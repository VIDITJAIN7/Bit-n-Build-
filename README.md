# Workkite

Workkite coordinates operations across distributed sites. Administrators define task rules from workspace data; the background agent creates work, workers record field evidence, and policy routes consequential actions for approval.

## Product areas

- **Overview:** site status, task rules, automation activity, and items needing review.
- **Task rules:** configure data conditions, worker tasks and report fields, notifications, restocking, or purchase requests.
- **Worker tasks:** mobile-first forms with large controls, equipment readback, offline report storage, and retry-safe sync.
- **Review and access:** approve exceptional actions and manage backup/guardian access.
- **Workspace data:** manage sites, assets, readings, inventory, and suppliers. Rules discover fields from saved data.

Rules and task definitions are stored as workspace records and can be created, edited, paused, or deleted through the application. Solar operations are included as editable workspace content; the engine itself is industry-neutral.

## Run locally

Requirements: Node.js 22+, Python 3.11+, and npm.

```powershell
npm run setup
Copy-Item .env.example .env
```

Set `WORKKITE_LOCAL_USERS_JSON` in `.env` to a JSON array of local sign-in users, each with `email`, `password`, and `role` (`admin` or `worker`). Keep `.env` private. Then start the services:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. The API binds to loopback on port 8000. Stop both services with **Ctrl+C**.

## Configuration and integrations

Copyable configuration is in `.env.example`. Provider secrets belong only in the API environment. The AI risk reviewer is an optional adapter; deterministic policy remains authoritative and the model cannot approve or execute actions. See [provider and identity integrations](docs/integrations.md) and the [Vercel + Supabase deployment guide](docs/deployment-vercel-supabase.md).

The current local workspace uses SQLite and a local payment adapter. The local sign-in endpoint only selects a configured role; it does not secure the API. Before public hosting, connect verified authentication, enforce authorization on every API route, replace SQLite with tenant-scoped Postgres/RLS, and connect production telemetry, weather, storage, notifications, and wallet providers as needed.

## Development checks

```powershell
npm run build
npm test
```

The API suite covers task-rule evaluation, policy, reports, recovery, and persistence. The contract suite runs against a private local EVM.

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
