# Supabase schema migrations

Production schema and Row Level Security policies will be added here alongside the Postgres repository adapter. The current local SQLite state is stored as one serialized workspace record and cannot be safely translated by deploying an empty schema. Do not point a hosted app at Supabase until migrations cover workspace membership, operational records, reports/evidence metadata, audit history, idempotency, and scheduled-job/outbox state, with tested workspace-scoped policies.
