# Product decisions applied after the original brief

The original brief is preserved in `product-brief.md`. These decisions supersede conflicting parts of that document.

- Three routing tiers: low, review, high. Removed the five-tier table.
- Single supervisor authorization within a $5,000 per-action ceiling. Removed the >$2,500 two-person rule.
- Announced canary program and per-reviewer drill outcomes, with non-executable exercises and extra readback after a miss.
- Four-hour backup eligibility provides continuity before the longer recovery process.
- Seven-day primary inactivity eligibility for guardian recovery; 2-of-3 quorum and 48-hour owner-cancellable timelock remain.
- Only primary-human decisions affect primary availability. Agent transactions and backup actions do not.
- Field verification is a compliance record with equipment ID, checklist, timestamp, image, optional audio/text, offline persistence, and server-confirmed sync.
- Heat-adapted UI uses explicit local weather scenarios until a real provider is connected.
- The chain is an independent cap on agent authority, not the product's reason for paying suppliers in cryptocurrency.
- No Google-track judging requirement has been confirmed. The provider ports allow Gemini/Firebase integration later without changing the product workflow.

The local workspace uses simulated signatures. The reference contract uses actual EVM caller signatures in local tests. Neither canary outcomes nor a successful signed action prove cognition or physical life; they are limited operational signals.

## Generic operations control plane

These decisions turn the single solar scenario into an industry-neutral platform. They supersede the scripted "start demo scenario" flow.

- The product is a management platform, modeled on control planes such as Cloudflare's: a workspace of sites, operator-owned data, rules, and a dashboard of live controls. Solar is one sample site next to a telecom tower and a cold-chain warehouse.
- Operators own the data the agent works from: sites, assets with arbitrary readings, inventory, and suppliers are editable in the app, and every change is audited.
- Task rules are saved workspace records, editable like other workspace data. Each contains a data source, site scope, typed conditions, an action, and a cooldown.
- Agent operations run in the background. People see completed work and exceptions in the overview and review queue.
- Task rules are edge-triggered with a cooldown, and open items suppress duplicates, so continuous conditions do not flood the review queue.
- Task rules create proposals; policy evaluates them. A task rule cannot grant authority. Supplier approval, known destinations, spending limits, and field confirmation stay in the deterministic gate.
- Field work is configurable: task rules can assign questions and report fields for any asset, and a purchase can require a confirmed on-site answer before approval.
- A simulated sensor feed stands in for telemetry during local testing and is off by default.
- Evidence media moves out of the polled state document into its own table.

