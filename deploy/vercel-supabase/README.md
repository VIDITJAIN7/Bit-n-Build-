# Vercel + Supabase deployment workspace

The deployment plan lives in [`../../docs/deployment-vercel-supabase.md`](../../docs/deployment-vercel-supabase.md). Keep deployment-specific notes, Vercel configuration, and environment templates here rather than mixing hosting assumptions into local app code.

This folder is intentionally a setup scaffold. There is no production `vercel.json` yet because the app still needs a Postgres repository, verified authentication and server-side role checks, a production API entry point, and durable scheduled work. Copy `.env.production.example` into platform environment settings by hand; do not commit real values.
