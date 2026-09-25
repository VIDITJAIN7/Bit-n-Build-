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
