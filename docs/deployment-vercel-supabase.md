# Deployment path: Vercel + Supabase + Firebase Cloud Messaging

This is the intended hosted stack for the current React/Vite product. Vercel can host the compiled frontend without a Next.js migration. The Python runtime can host FastAPI, but the current backend is intentionally local-only: it stores a single SQLite state record, starts a five-second background loop, and has no verified identity or role checks. Do not deploy that configuration as-is.

## Target layout

```text
Worker/Admin browser
  ├─ Vercel: Vite static site, HTTPS, service worker
  ├─ Supabase Auth: verified sessions and user identity
  ├─ Supabase Postgres: tenant-scoped records, triggers, actions, reports, audit, outbox
  ├─ Supabase Storage: field photos/audio (private buckets, scoped policies)
  └─ FCM: push notification delivery

Vercel Functions / API
  ├─ validate Supabase JWT and workspace role on every protected request
  ├─ apply database-backed deterministic policy and validated AI risk assessments
  └─ process idempotent event/outbox work; never trust browser-supplied roles
```

## Setup sequence

1. Create the Vercel project from this repository with the repository root as the project root. Use `npm install` for dependency installation, `npm run build` for the build command, and `apps/web/dist` as the output directory. Keep the API as a separately configured Python function or service; do not proxy it to the local `127.0.0.1:8000` development API. Vercel's Python runtime can host FastAPI but is currently marked Beta, so treat it as a deployment decision to validate in staging.
2. Create a Supabase project and apply versioned SQL migrations from `supabase/migrations/`. The migrations must cover workspace membership/roles, sites, assets, inventory, suppliers, triggers, actions, field tasks/reports, audit events, idempotency keys, and an outbox/job table. Enable RLS on every browser-accessible table and write policies that scope data by verified workspace membership. Preserve atomic policy checks, budget reservation, and audit updates in database transactions.
3. Replace `SQLiteRepository` with a Postgres repository implementation. The current one-record SQLite repository is a local adapter, not a production schema. Move attachments to a private Supabase Storage bucket. Upload directly from the worker browser using short-lived signed access; store object paths, content hashes, report IDs, and idempotency keys in Postgres. Never fetch all image data on every state refresh.
4. Connect the sign-in form to Supabase Auth. Store roles in trusted workspace membership or server-managed app metadata, never user-editable profile metadata. Validate the JWT on every API call, protect admin mutation endpoints, and filter worker tasks by the authenticated worker ID. Delete the local account constants before any hosted build. Keep the same single sign-in page; route after the server verifies the user's role.
5. Add the Firebase web app and FCM web-push certificate. Configure the HTTPS site, notification permission flow, root `firebase-messaging-sw.js`, and public VAPID key. Store each user's device registration in a user-scoped table and send from a server-side notification adapter with Firebase Admin credentials held only in server environment variables. Push is a delivery hint; database task state remains authoritative.
6. Replace the local 5-second loop with durable, idempotent event processing. Write a job/outbox row in the same transaction as each trigger-worthy update, then process it through a scheduled function or a dedicated worker. Vercel Cron can call `GET /api/cron/agent` with `CRON_SECRET` as a bearer header; this repository includes the local FastAPI route and the secret check. Before enabling it in production, move that handler to the deployed API runtime and add Postgres advisory locking/leases, unique event keys, retries, and reconciliation for missed or duplicated invocations. Cron is best-effort and Vercel does not retry failures automatically.
7. Choose schedule frequency against the actual escalation service level. Vercel Hobby permits one daily cron run; Pro and Enterprise permit a minimum interval of one minute. Neither supports the current five-second polling behavior. Use a durable queue or always-on worker if dispatch and reassignment need sub-minute response.
8. Add provider adapters for live telemetry/SCADA, CMMS/workforce directory, inventory/procurement, and weather only when those accounts and API details are available. Keep each behind an interface and ship mock fixtures for local development. Configure the LLM endpoint/model/key server-side if AI risk review is enabled; AI may add risk or request review, while database policy alone authorizes actions.
9. Configure production secrets in Vercel/Supabase secret settings. Never use `VITE_*` variables for server credentials. At minimum, plan for Supabase URL and anon key (browser), Supabase server connection credentials (server only), `CRON_SECRET`, Firebase server credentials, optional LLM base URL/model/API key, and provider credentials. Rotate the temporary local passwords and never ship local account values.
10. Before opening the site to users: apply migrations to a staging project, add automated tests for RLS and cross-workspace access, verify signed-upload limits and offline sync conflict behavior, test repeated/overlapping job execution, check logs/alerts/backups, set CORS and Auth redirect URLs to the real domains, then promote the same migration and build to production.

## Repository organization

- `apps/web`: static Vite user interface and offline field shell.
- `apps/api`: FastAPI routes, trigger evaluator, policy gate, and replaceable repository/provider adapters.
- `supabase/migrations`: production schema/RLS migrations (to be added with the Postgres adapter, before first hosted deployment).
- `deploy/vercel-supabase`: deployment environment template and deployment-specific configuration (to be added once the hosted API entry point is selected).
- `docs/integrations.md`: per-connector contracts and security boundaries.

Keep deployment wiring out of local application logic. The eventual Vercel configuration should point at a small API entry point and the Vite build, while credentials stay in platform environment settings. Do not add a live `vercel.json` or claim one-command production deployment until the Postgres repository, verified auth, and deployed API routes exist.

## Environment inventory

| Variable / secret | Where it belongs | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel web build | Public Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel web build | Public client key, restricted by RLS |
| `SUPABASE_DATABASE_URL` or managed connection string | API runtime only | Postgres connection; use pooler settings suitable for serverless |
| `CRON_SECRET` | API runtime and Vercel Cron settings | Authenticate scheduled invocations |
| `FIREBASE_PROJECT_ID`, service credentials | API runtime only | FCM server sends |
| `VITE_FIREBASE_*`, `VITE_FIREBASE_VAPID_KEY` | Vercel web build | Firebase client config and public web-push key |
| `WORKKITE_LLM_BASE_URL`, `WORKKITE_LLM_MODEL`, `WORKKITE_LLM_API_KEY` | API runtime only | Optional AI risk reviewer |
| `SCADA_*`, `CMMS_*`, `SUPPLIER_*`, `WEATHER_*` | API runtime only | Only for integrations that are selected and provisioned |

The Supabase publishable key and Firebase web config are designed for clients, but database access must still be constrained by RLS. Service-role, database, Firebase Admin, LLM, scheduler, and vendor API secrets must never be included in browser bundles.

