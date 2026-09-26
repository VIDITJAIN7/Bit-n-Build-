# Adding external integrations later

No connectors, accounts, RPC subscriptions, API keys, or testnet funds are needed for the current build. Dependency downloads are development tooling, not runtime service integrations.

## Planner / LLM

The current local planner is deterministic: saved triggers and their configured actions decide what work or purchase gets proposed. `policy.evaluate` checks supplier approval, known recipients, per-action and daily budgets, typical purchase size, required field evidence, and wallet balance before the simulated wallet can execute a routine purchase. This is useful automation, but it is not AI.


**Gemini Flash configuration.** Set `WORKKITE_AGENT=ai-commander`, `WORKKITE_RISK_REVIEWER=ai`, `WORKKITE_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `WORKKITE_LLM_MODEL=gemini-flash-latest`, and `WORKKITE_LLM_API_KEY` in the API's server-side environment. Google's OpenAI-compatible Chat Completions endpoint fits the existing adapter without an extra SDK. The `-latest` alias follows Google's latest Flash model; pin a stable model ID when reproducible behavior is more important than automatic upgrades. See [Gemini models](https://ai.google.dev/gemini-api/docs/models), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [API key safety](https://ai.google.dev/gemini-api/docs/api-key).

**Provider switching.** Mistral is supported by changing only `WORKKITE_LLM_BASE_URL` to `https://api.mistral.ai/v1`, `WORKKITE_LLM_MODEL` to `mistral-small-latest`, and `WORKKITE_LLM_API_KEY` to a Mistral key. Keep the key in a server-side secret store, never in a `VITE_*` variable. Model-provider data terms and quotas vary; use the minimized, non-personal review context and check each provider's terms before sending operational data.

The commander receives minimized task, site, equipment, candidate-action, and policy summaries. It chooses whether work should proceed now, be scheduled, or wait for a human; for field work it can choose an allowed assignee and priority. It may set a schedule only up to seven days. The separate optional risk reviewer scores the candidate and can add review friction. Neither model can edit the administrator's action definition, price, supplier, recipient, policy, or approval authority. The deterministic policy is the final execution gate. An unavailable or invalid commander decision routes that item to human review instead of silently treating it as an approval.

Provider swapping is isolated behind `OpenAICompatibleCommander` and `OpenAICompatibleRiskReviewer`. For Gemini or another OpenAI-compatible endpoint, change only `WORKKITE_LLM_BASE_URL`, `WORKKITE_LLM_MODEL`, and `WORKKITE_LLM_API_KEY`. For a provider with a different API, implement the `Commander.decide(context)` and/or `RiskReviewer.review(context)` protocol while keeping `AICommander`, `AIReviewPlanner`, and deterministic policy unchanged.

To make the LLM a true task agent, add a separate, constrained tool loop behind `Agent`, with tools such as `get_asset_readings`, `list_available_workers`, and `propose_field_task`. Each tool must call a typed server-side service, validate site and role access, and return a structured proposal. The app—not the model—executes each tool call. Re-run every proposed action through deterministic validation and `policy.evaluate`; require a human for approvals and any action outside explicit limits. Do not expose wallet keys, direct database access, arbitrary HTTP, code execution, or a tool that can override policy. Gemini's function calling returns tool requests for the application to execute; it does not execute application code itself ([function-calling guide](https://ai.google.dev/gemini-api/docs/function-calling)).

## Trigger-to-worker automation

The automation path is `saved admin task → AI commander → deterministic policy gate → immediate or scheduled action → field task → worker report → human decision when required`. Scheduled work is rechecked against current policy when due. A `work_order` action opens an assigned worker task; a `field_check` action does the same with configured questions and report fields. The commander can select only configured/site technicians and cannot assign arbitrary people.

Production task processing runs on a scheduled API invocation because Vercel Functions do not host a persistent background loop. Configure the Supabase Cron job to call `GET /api/cron/agent` every minute and send `Authorization: Bearer <CRON_SECRET>`. Keep `CRON_SECRET` in Vercel's server environment and Supabase Vault; never put it in the browser or a committed migration. For the deployed Workkite project, the cron invocation must iterate workspaces and call the same policy-checked service.

The admin **Connections** page stores blank provider names and endpoint details for telemetry/SCADA, inventory/purchasing, workforce/dispatch, and wallet/RPC. Admins can enter their chosen vendors later. API tokens and private RPC credentials must be stored in server environment secrets, not workspace records. The wallet page can request an injected browser wallet connection; this only reads the selected account and chain. It does not sign or send transactions. On-chain payments still require a deployed wallet contract, a real RPC and chain configuration, a human-signing design, and a server-side wallet adapter with transaction reconciliation.

For live dispatch, connect a workforce directory or CMMS that returns stable worker IDs, skills, site coverage, availability, and notification preferences. Replace the current display-name assignee with a worker ID, filter the worker portal by the verified identity, and add a delivery adapter for push/email/SMS. Add acknowledgements, reassignment, escalation, and delivery retry/idempotency before relying on bot assignment operationally.

## Site data and telemetry

Operators maintain sites, assets, inventory, and suppliers through `/api/data/{collection}` (create, `PATCH`, delete). A connector can use the same routes, or write through the repository, to keep records current. The trigger builder infers fields from the records, so a new reading (for example `vibration_rms`) becomes available to triggers without code changes. Separate authoritative supplier and recipient records from model-generated content, and reconcile quotes, quantities, live prices, and supplier identifiers before autonomous execution.

Live telemetry belongs behind the `Feed.step(state)` port. `SimulatedFeed` drifts readings and consumes stock for local testing; a real feed would apply the latest verified readings with timestamps and freshness checks. The background agent evaluates triggers after each feed step.

## Weather

The weather result shape is `{source, scenario, heat_index_c, high_heat}`. `WeatherSource.current(site_id)` defines the external-service port. The current scenarios use a 32°C or 46°C simulated heat index. The field UI switches layout at the scenario's `high_heat` flag; these are interface settings, not occupational heat-safety thresholds.

When adding a weather provider, compute or use its heat-index value with units and timestamp, include freshness, map coordinates server-side, and keep the last verified reading offline. Add a refresh route that injects the returned weather object into state. The UI already reads this object; it does not need provider-specific code.

## Database / files

Implement the `Repository` contract for Postgres or Supabase: `read()`, `mutate(change, blobs)`, `blob(id)`, and `clear_blobs()`. The mutation contract is atomic: authorization, balance, budget, receipt, evidence media, and audit updates either all commit or all roll back. Use row locking or serializable transactions to preserve those guarantees; the background agent and human commands write concurrently.

Evidence media already lives outside the state document; move it to authenticated object storage and keep the report UUID, SHA-256 fingerprints, and idempotency semantics. Firebase could supply authenticated data and storage if the hackathon requires a Google stack; that requirement has not been assumed. Do not store service credentials in the browser.

## Identity and signed decisions

Local sign-in reads role assignments from `WORKKITE_LOCAL_USERS_JSON` on the API host, so credentials are not included in the browser bundle. It only routes the interface: it does not protect API routes or issue a production session. Before exposing the API, connect an identity provider (OIDC/OAuth2 such as Supabase Auth, Firebase Auth, or an equivalent) and validate its session/JWT on every protected API request. Derive roles from verified claims, never from the URL or request body. Bind wallet authorization to action ID, amount, destination, evidence digest, nonce, chain ID, and expiration. Re-read current policy and signer authority when executing. Only verified **primary-human** activity should update the primary availability clock. Task-rule and data edits should also require an authenticated operator role, since they steer what the agent proposes.

The verifier must distinguish primary supervisor, backup, agent, operator, worker, and guardians. Agent activity and backups must never keep an absent primary supervisor looking active. Keep local reset/time controls and synthetic feeds out of production configuration.

## Blockchain

`contracts/src/OperatingWallet.sol` accepts one six-decimal ERC-20 token. It supports approved-recipient agent payments with immutable $250/$1,000 limits, supervisor/backup payments capped at $5,000, signed primary decisions, and guardian recovery. Its interface is compiled by `npm run compile --workspace @workkite/contracts` into ignored `contracts/artifacts/` ABI/bytecode files.

Add a wallet connector such as viem/wagmi for human signatures and an RPC-backed implementation of `Wallet.execute` for agent transactions. Keep local operation receipts separate from chain transaction hashes and show submitted/confirmed/failed states truthfully. Ensure exact action IDs prevent replay and wait for chain confirmation before marking execution complete.

The synchronous local repository transaction must not be held open across an RPC call. Introduce an outbox transaction: atomically authorize and reserve budget, sign/submit outside the DB lock, then record a confirmed or failed receipt with idempotent reconciliation. A timeout is not proof that a transaction failed.

The contract does not verify off-chain field evidence or enforce canary training. The backend must never send a canary to the signer; it must bind real human authorizations to the evidence and payment. Deploy only after adding authentication, removing simulator endpoints, configuring keys outside the app, and reviewing the contract.

## Suggested integration order

1. Verified human identity and server-side role enforcement; map users to stable worker IDs.
2. Workforce/CMMS API plus push or messaging delivery for assignment acknowledgement and escalation.
3. Hosted API, real database, and object storage with matching atomic/idempotent semantics.
4. Site/asset/inventory/procurement and telemetry feeds with freshness checks behind the repository and `Feed` ports.
5. Optional LLM planner and weather feed behind their existing adapters.
6. Testnet wallet connector, RPC provider, and transaction outbox if on-chain payments remain in scope.

No plugin installation by itself completes these integrations. The current application needs no app connector.

For the hosted Vercel + Supabase + Firebase sequence and environment inventory, see [deployment-vercel-supabase.md](deployment-vercel-supabase.md).

