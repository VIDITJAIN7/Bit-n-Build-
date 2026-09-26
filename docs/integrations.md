# Adding external integrations later

No connectors, accounts, RPC subscriptions, API keys, or testnet funds are needed for the current build. Dependency downloads are development tooling, not runtime service integrations.

## Planner / LLM

Implement the `Agent.propose(context)` protocol in `apps/api/averlock/adapters.py` and inject it into `OperationsService`. `context` contains the workspace `state`, the operator `trigger` that fired, and the matched `record` row. Return a list of structured proposals with the same fields as `LocalPlanner` (kind, title, amount, supplier, recipient, subject, explanation, optional field-check question). Gemini, OpenAI, Claude, or another provider can be used without changing the trigger engine, policy gate, or frontend; validate provider output before using it. A provider is never given a supervisor key or allowed to call the wallet directly, and whatever it proposes still crosses the same policy gate.

The current planner is deterministic and is labeled that way. Do not relabel it as an LLM until the adapter actually calls a model. Environment selection deliberately fails for unsupported adapters instead of silently pretending a connection exists.

## Site data and telemetry

Operators maintain sites, assets, inventory, and suppliers through `/api/data/{collection}` (create, `PATCH`, delete). A connector can use the same routes, or write through the repository, to keep records current. The trigger builder infers fields from the records, so a new reading (for example `vibration_rms`) becomes available to triggers without code changes. Separate authoritative supplier and recipient records from model-generated content, and reconcile quotes, quantities, live prices, and supplier identifiers before autonomous execution.

Live telemetry belongs behind the `Feed.step(state)` port. `SimulatedFeed` drifts readings and consumes stock for demos; a real feed would apply the latest verified readings with timestamps and freshness checks. The background agent evaluates triggers after each feed step.

## Weather

The weather result shape is `{source, scenario, heat_index_c, high_heat}`. `WeatherSource.current(site_id)` defines the external-service port. The current scenarios use a 32°C or 46°C simulated heat index. The demo switches layout at the scenario's `high_heat` flag; these are interface demonstration settings, not occupational heat-safety thresholds.

When adding a weather provider, compute or use its heat-index value with units and timestamp, include freshness, map coordinates server-side, and keep the last verified reading offline. Add a refresh route that injects the returned weather object into state. The UI already reads this object; it does not need provider-specific code.

## Database / files

Implement the `Repository` contract for Postgres or Supabase: `read()`, `mutate(change, blobs)`, `blob(id)`, and `clear_blobs()`. The mutation contract is atomic: authorization, balance, budget, receipt, evidence media, and audit updates either all commit or all roll back. Use row locking or serializable transactions to preserve those guarantees; the background agent and human commands write concurrently.

Evidence media already lives outside the state document; move it to authenticated object storage and keep the report UUID, SHA-256 fingerprints, and idempotency semantics. Firebase could supply authenticated data and storage if the hackathon requires a Google stack; that requirement has not been assumed. Do not store service credentials in the browser.

## Identity and signed decisions

The local `actor` field is a simulation control, not authentication. Before exposing the API, replace it with a verified identity derived from a session/JWT or a wallet signature. Bind authorization to action ID, amount, destination, evidence digest, nonce, chain ID, and expiration. Re-read current policy and signer authority when executing. Only verified **primary-human** activity should update the primary availability clock. Trigger and data edits should also require an authenticated operator role, since they steer what the agent proposes.

The verifier must distinguish primary supervisor, backup, agent, operator, technician, and guardians. Agent activity and backups must never keep an absent primary supervisor looking active. Remove demo reset/time/role-selection routes and the simulated feed from production configuration.

## Blockchain

`contracts/src/OperatingWallet.sol` accepts one six-decimal ERC-20 token. It supports approved-recipient agent payments with immutable $250/$1,000 limits, supervisor/backup payments capped at $5,000, signed primary decisions, and guardian recovery. Its interface is compiled by `npm run compile --workspace @averlock/contracts` into ignored `contracts/artifacts/` ABI/bytecode files.

Add a wallet connector such as viem/wagmi for human signatures and an RPC-backed implementation of `Wallet.execute` for agent transactions. The UI should keep `simulated` receipts separate from chain transaction hashes and show submitted/confirmed/failed states truthfully. Ensure exact action IDs prevent replay and wait for chain confirmation before marking execution complete.

The synchronous local repository transaction must not be held open across an RPC call. Introduce an outbox transaction: atomically authorize and reserve budget, sign/submit outside the DB lock, then record a confirmed or failed receipt with idempotent reconciliation. A timeout is not proof that a transaction failed.

The contract does not verify off-chain field evidence or enforce canary training. The backend must never send a canary to the signer; it must bind real human authorizations to the evidence and payment. Deploy only after adding authentication, removing simulator endpoints, configuring keys outside the app, and reviewing the contract.

## Suggested integration order

1. Verified human identity and role enforcement, including operator roles for triggers and data.
2. Real database and object storage with matching atomic/idempotent semantics.
3. Telemetry feeds with freshness checks behind the `Feed` port.
4. LLM planner behind the existing gate.
5. Weather feed.
6. Testnet wallet connector and transaction outbox.

No plugin installation by itself completes these integrations. The current application needs no app connector.
