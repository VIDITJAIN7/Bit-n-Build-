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

The local demo uses simulated signatures. The reference contract uses actual EVM caller signatures in local tests. Neither canary outcomes nor a successful signed action prove cognition or physical life; they are limited operational signals.

## Generic operations control plane

These decisions turn the single solar scenario into an industry-neutral platform. They supersede the scripted "start demo scenario" flow.

- The product is a management platform, modeled on control planes such as Cloudflare's: a workspace of sites, operator-owned data, rules, and a dashboard of live controls. Solar is one sample site next to a telecom tower and a cold-chain warehouse.
- Operators own the data the agent works from: sites, assets with arbitrary readings, inventory, and suppliers are editable in the app, and every change is audited.
- Customised triggers replace hard-coded planner fixtures. A trigger is _data source + site scope + typed conditions + action + cooldown_. Each one renders as a tile on the control panel, where its threshold can be adjusted in place; manual triggers render as runbook buttons.
- Agent operations run in the background. A loop in the API process evaluates triggers every few seconds; people see outcomes and exceptions, not a run button.
- Triggers are edge-triggered with a cooldown, and open items suppress duplicates, so continuous conditions do not flood the review queue.
- Triggers propose; policy disposes. No trigger can grant authority. Supplier approval, known destinations, spending limits, and field confirmation stay in the deterministic gate.
- The field check is generic: any trigger can send a yes/no question for any asset, and a purchase can require a confirmed on-site answer before approval.
- A simulated sensor feed stands in for telemetry during demos and is off by default.
- Evidence media moves out of the polled state document into its own table.
