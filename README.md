# Workkite

Workkite helps teams manage work across multiple sites. Administrators define tasks from workspace data; the operations agent proposes and schedules routine work; deterministic policy controls what can run automatically; workers complete assigned tasks and record field evidence. The same task engine can support different industries by using each workspace's own sites, records, conditions, actions, and report fields.

## What is included

- **Admin workspace:** overview, task creation and editing, workspace data, review queue, access and recovery, activity, and external connection settings.
- **Worker workspace:** assigned work, readable field forms, offline report drafts, and retry-safe sync.
- **Operations agent:** a deterministic rules planner by default, with a replaceable OpenAI-compatible AI commander option for proposing task handling, schedule, priority, and assignee.
- **Policy gate:** checks approved suppliers, known payment destinations, per-action and daily limits, typical purchase size, evidence requirements, and wallet balance. The AI cannot edit policy or directly approve a purchase.
- **Local adapters:** SQLite, local authentication for development, simulated telemetry/weather, and a local wallet adapter.
- **Hosted adapters:** Supabase Auth and workspace-scoped Postgres, FastAPI routes on Vercel, and optional server-side AI configuration.
- **Wallet contract:** Solidity reference implementation and local tests. It is not deployed or connected to the app; the UI does not send real transactions.

The repository includes editable solar-farm records and tasks as starter content. The task system is not limited to solar operations. To start an empty company workspace locally, use the setting described below.

## Requirements

- Node.js 22.12 or newer and npm.
- Python 3.11 or newer.
- Git (for cloning and version control).

## Run locally

From the repository root:

```powershell
npm run setup
Copy-Item .env.example .env
```

Edit the ignored `.env` file. For a clean company workspace without starter sites, assets, inventory, suppliers, or tasks, set:

```dotenv
WORKKITE_LOCAL_EMPTY_WORKSPACE=true
WORKKITE_LOCAL_WORKSPACE_NAME=Your company
WORKKITE_LOCAL_USERS_JSON=[{"username":"admin","password":"change-this","role":"admin","display_name":"Workspace Admin"},{"username":"worker1","password":"change-this-too","role":"worker","display_name":"Field Worker"}]
```

Use your own local-only passwords. `WORKKITE_LOCAL_USERS_JSON` is read only by the local API; the credentials are not included in the browser bundle. Local username sign-in only selects the local interface role and does **not** secure API routes. Never enable local sign-in or use these credentials in a public deployment. Hosted sign-in uses Supabase Auth.

Start the web app and API together:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. The web server is bound to loopback; the FastAPI service runs at `http://127.0.0.1:8000`. Use **Ctrl+C** to stop both. The local API creates its SQLite database under `apps/api/data/`; database files are ignored by Git.

To use the AI commander locally, set these in `.env` using a provider-supported model and a server-side API key:

```dotenv
WORKKITE_AGENT=ai-commander
WORKKITE_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
WORKKITE_LLM_MODEL=gemini-flash-latest
WORKKITE_LLM_API_KEY=your-secret-key
WORKKITE_LLM_REASONING_EFFORT=none
```

For Mistral, use `https://api.mistral.ai/v1` and a Mistral model ID supported by your account. Never put a provider key in a `VITE_*` variable or commit it. `WORKKITE_RISK_REVIEWER=ai` enables the separate optional risk review; it is distinct from the commander. If the AI is unavailable, rate-limited, or returns an invalid decision, the item is routed for human review.

## Production setup

The deployment target is one Vercel project connected to this repository plus one Supabase project. Vercel builds the Vite frontend and serves the FastAPI backend from `api/index.py`; the `/api/*` rewrite preserves nested API paths. Hosted API mode requires Supabase Auth and Postgres configuration and does not start a persistent agent loop. Purchases still use no real wallet: the production wallet is unconfigured until a wallet/RPC adapter is implemented and deliberately connected.

1. Apply every SQL migration in `supabase/migrations/` to the Supabase project. The migration guide explains workspace roles and Auth invitation behavior.
2. Set Supabase Auth's site URL to the production site and disable open self-registration. Invite the first administrator through Supabase Auth; the database bootstrap assigns the first invited account the admin role and later invited accounts the worker role.
3. Import the repository into Vercel with the **repository root** as the project root. The checked-in `vercel.json` provides the build command and output directory. Set these Vercel variables for Production (and Preview if needed):
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the browser Auth client. The publishable key is intentionally public.
   - `WORKKITE_ENV=production`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_DATABASE_URL` for the API. Use Supabase's transaction-pooler connection string for Vercel's serverless runtime.
   - Optional AI: `WORKKITE_AGENT=ai-commander`, `WORKKITE_LLM_BASE_URL`, `WORKKITE_LLM_MODEL`, and secret `WORKKITE_LLM_API_KEY`; optionally `WORKKITE_LLM_REASONING_EFFORT` and `WORKKITE_RISK_REVIEWER=ai`.
   - Optional scheduled processing: create a high-entropy `CRON_SECRET`, store it in Vercel and Supabase Vault, then configure Supabase Cron/`pg_net` to call `GET https://<your-domain>/api/cron/agent` each minute with `Authorization: Bearer <CRON_SECRET>`.
4. Redeploy after setting or changing environment variables. Confirm `/api/health`, authentication, and a complete admin-to-worker task/report flow on the deployed URL.

The production schema stores workspace data in a locked JSONB state row and report media metadata in Postgres. A private Supabase Storage bucket is provisioned, but direct evidence uploads are not wired yet. Keep photos/audio usage modest until the upload path moves to Storage. The Connections page stores administrator-entered provider names and endpoints; those entries do not activate live SCADA, inventory, workforce, weather, notification, or wallet integrations. See [the deployment guide](docs/deployment-vercel-supabase.md) and [migration notes](supabase/migrations/README.md) before changing hosted resources.

## AI and external systems

The AI commander proposes how to handle eligible cases and when to schedule work. The server validates proposals and applies deterministic policy before an action executes. AI risk review is a separate optional adapter. Provider configuration is isolated behind replaceable interfaces; integration details and security limits are in [docs/integrations.md](docs/integrations.md).

The Connections page is prepared for administrators to record the vendor and endpoint they plan to connect for telemetry/SCADA, inventory/procurement, workforce/dispatch, weather, and wallet/RPC. These are integration settings, not working vendor connectors. Before relying on these systems, implement and test the corresponding server-side adapters, authentication, data freshness, retries, and audit behavior. The browser wallet option only reads an injected account/chain; it does not sign or send transactions.

## Checks

```powershell
npm run build
npm test
```

`npm test` runs the FastAPI suite and Solidity wallet tests against a local development environment. The Solidity contract is not deployed by the build. For focused checks, run `npm run test:api` or `npm run test:contracts`.

## Repository map

```text
api/                         Vercel FastAPI entry point
apps/api/averlock/           API, policy, agent, adapters, and repositories
apps/api/tests/              API and operations tests
apps/web/                    React/Vite admin and worker application
contracts/                   Solidity wallet reference and tests
supabase/migrations/         Hosted schema, roles, and RLS migrations
deploy/vercel-supabase/       Production environment template
docs/                         Architecture, decisions, walkthrough, integrations
scripts/                      Setup, local run, tests, and build support
```

## Further documentation

- [Architecture](docs/architecture.md)
- [Product brief](docs/product-brief.md)
- [Implementation decisions](docs/decisions.md)
- [Operator walkthrough](docs/operator-walkthrough.md)
- [AI and connector integration guide](docs/integrations.md)
- [Vercel and Supabase deployment guide](docs/deployment-vercel-supabase.md)
- [Supabase migrations](supabase/migrations/README.md)
