# Vercel + Supabase

The production API entry point, Vercel routing, Supabase migrations, verified authentication, and Postgres adapter are in place. Read [`../../docs/deployment-vercel-supabase.md`](../../docs/deployment-vercel-supabase.md) for the remaining account setup before deployment.

Add values from `.env.production.example` to Vercel's Production environment. Do not commit real credentials. First invite the workspace owner from Supabase Auth; the database trigger assigns the initial invited account administrator access.
