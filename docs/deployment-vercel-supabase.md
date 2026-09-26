# Deployment path: Vercel + Supabase

Workkite uses a React/Vite frontend and FastAPI API. Local development uses SQLite; hosted mode uses Supabase Auth and Postgres with workspace-scoped access. The Vercel configuration serves the frontend and `/api/*` functions from one project. Keep production locked until all required Vercel environment variables are set and the first administrator has been invited.

## Target layout

```text
Worker/Admin browser
  ├─ Vercel: Vite site and FastAPI functions
  ├─ Supabase Auth: verified sessions and user identity
  ├─ Supabase Postgres: workspace-scoped operations, reports and audit
  └─ Supabase Storage: private field-evidence bucket (direct upload follow-up)

Vercel Functions / API
  ├─ validate Supabase JWT and workspace role on every protected request
  ├─ apply deterministic policy under a transactionally locked workspace record
  └─ never trust browser-supplied roles
```

## Setup sequence

1. Vercel is configured by `vercel.json`: repository root, `npm run build`, and `apps/web/dist`. Vite deep links use the SPA rewrite, which excludes `/api`; `api/[...path].py` exposes FastAPI under `/api/*`. FastAPI's Python runtime is still Beta, so validate a preview deployment before treating this as a production service.
2. The four Supabase migrations recorded in `supabase/migrations/README.md` have been applied to the Workkite project. They provision workspace membership, roles, a locked Postgres state record, media metadata, RLS policies, an Auth bootstrap trigger, and a private evidence bucket. The first invited Auth account becomes the initial workspace admin; later invited accounts become workers.
3. The backend now has a Postgres repository adapter. Local mode remains SQLite; hosted mode requires `WORKKITE_ENV=production` and server-side Supabase settings. State reads/mutations are scoped to the workspace found from the authenticated membership, and PostgreSQL row locks keep updates atomic. Do not deploy until all environment variables are set and Vercel's build passes.
4. The sign-in form uses Supabase Auth when its public URL/key are configured. The API verifies every access token with Supabase Auth, reads the user's RLS-protected workspace membership, protects admin routes, and filters worker data. Role decisions never come from browser storage or user-editable profile metadata.
5. Evidence is still stored through the Postgres media adapter for this first hosted integration. The private Supabase Storage bucket is provisioned, but direct uploads and signed reads remain a follow-up before storing production photos/audio at scale.
6. The local five-second loop is not started in hosted mode. The authenticated cron handler can run deterministic rules across workspaces when scheduled, but no schedule is enabled yet. Vercel Hobby permits daily schedules only; minute-level scheduling requires Pro or Enterprise. Live wallet access, direct media uploads to Storage, AI, and external providers remain disabled. Do not enable automatic purchases until the wallet adapter is implemented and tested.
7. Before inviting anyone, turn off public Auth sign-up and set Supabase Auth's Site URL to `https://workkite.vercel.app` (allow that URL as a redirect). Invite the first admin through Supabase Auth; the database trigger creates the workspace and assigns that invited account admin. Later Auth Dashboard invitations are assigned the worker role automatically. Uninvited sign-ups receive no role or workspace access.

## Repository organization

- `apps/web`: static Vite user interface and offline field shell.
- `apps/api`: FastAPI routes, trigger evaluator, policy gate, and replaceable repository/provider adapters.
- `supabase/migrations`: versioned production schema/RLS migrations.
- `deploy/vercel-supabase`: deployment environment template and platform setup notes.
- `docs/integrations.md`: per-connector contracts and security boundaries.

Platform credentials stay in Vercel environment settings. Keep automatic purchase/wallet execution disabled until a real provider and the remaining transaction safety checks are implemented.

## Environment inventory

| Variable / secret | Where it belongs | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel web build | Supabase Auth client |
| `WORKKITE_ENV=production` | Vercel API runtime | Select production auth and Postgres adapters |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Vercel API runtime | Verify bearer tokens and workspace membership |
| `SUPABASE_DATABASE_URL` | Vercel API runtime only | Supabase transaction-pooler Postgres connection string |
| `CRON_SECRET` | Vercel API runtime | Required only if enabling the scheduled rules endpoint |

The Supabase publishable key is designed for clients. Database and Auth access remains constrained by verified membership and RLS. Database connection strings and other server credentials must never be included in browser bundles.

