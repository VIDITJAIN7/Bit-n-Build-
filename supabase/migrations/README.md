# Supabase schema migrations

The applied migration sequence matches the Supabase project history:

- `20260926132302_production_workspace_core.sql` creates workspaces, user membership/roles, the transactionally locked workspace state record, report evidence metadata, RLS policies, and a private evidence bucket.
- `20260926132819_invited_workspace_members.sql` assigns the first *invited* Auth account as administrator; later invited accounts start as workers. Open self-sign-ups do not receive workspace access.
- `20260926132908_tighten_workspace_permissions.sql` limits state writes to administrators.
- `20260926132938_revoke_public_rls_helper.sql` removes public execution rights from the RLS helper.

The application keeps its SQLite adapter for development and selects Postgres only when `WORKKITE_ENV=production`.

Operational data is stored in versioned JSONB for this prototype and is always scoped by the authenticated workspace. Move high-volume operational collections into normalized tables as they evolve. Evidence currently remains in the Postgres media adapter; the private Storage bucket is provisioned for the follow-up direct-upload migration.
