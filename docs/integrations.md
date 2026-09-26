# Adding external integrations later

No connectors, accounts, RPC subscriptions, API keys, or testnet funds are needed for the current build. Dependency downloads are development tooling, not runtime service integrations.

## Planner / LLM

The current local planner is deterministic: saved triggers and their configured actions decide what work or purchase gets proposed. `policy.evaluate` checks supplier approval, known recipients, per-action and daily budgets, typical purchase size, required field evidence, and wallet balance before a routine purchase can execute. A local anomaly model (`anomaly.py`, an isolation forest over the workspace's own purchase history) runs without any key and can only escalate a purchase to a person. The optional AI reviewer below adds a second, language-model opinion with the same friction-only authority.


**Mistral is the current starter provider.** Set `WORKKITE_AGENT=ai-risk`, `WORKKITE_LLM_BASE_URL=https://api.mistral.ai/v1`, `WORKKITE_LLM_MODEL=mistral-small-latest`, and `WORKKITE_LLM_API_KEY` in the API's server-side `.env`. Mistral Studio's OpenAI-compatible Chat Completions endpoint fits the existing adapter without adding a provider SDK. Free mode has limited quotas, and Mistral may use free-mode inputs and outputs to improve its models; review the account's data controls and use sanitized workspace data. See [Mistral's API setup](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), [chat API](https://docs.mistral.ai/api/), and [data controls](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-my-artificial-intelligence-models).

**Gemini 3.8 Flash is another compatible option.** Change the base URL to `https://generativelanguage.googleapis.com/v1beta/openai` and the model to `gemini-3.8-flash`. The Gemini free tier may use prompts and responses to improve Google's products, so use sanitized data there as well. See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), and [unpaid-service terms](https://ai.google.dev/gemini-api/terms).

Copy the optional settings from `.env.example` into the API's server-side `.env`, set `WORKKITE_AGENT=ai-risk`, and add an API key created in Google AI Studio. The current integration is an AI risk reviewer: it receives a minimized proposal summary and may raise risk or request human review. It does **not** choose workers, create task definitions, or execute a payment. Provider errors or invalid output require human review.

Provider calls never run inside a database transaction: the service asks `AIReviewPlanner.prepare` to review the records about to fire before it opens the transaction, and proposals the review did not cover (because the data changed in between) wait for a person. Provider swapping is isolated behind the `RiskReviewer` protocol and `OpenAICompatibleRiskReviewer`. For Gemini or another OpenAI-compatible endpoint, change only `WORKKITE_LLM_BASE_URL`, `WORKKITE_LLM_MODEL`, and `WORKKITE_LLM_API_KEY`. For a provider with a different API, implement `RiskReviewer.review(context)` and return the shared assessment fields (`score`, `flags`, `explanation`, `available`); keep `AIReviewPlanner` and policy unchanged. `Agent.propose(context)` is the separate seam for replacing the proposal planner.

To make the LLM a true task agent, add a separate, constrained tool loop behind `Agent`, with tools such as `get_asset_readings`, `list_available_workers`, and `propose_field_task`. Each tool must call a typed server-side service, validate site and role access, and return a structured proposal. The app—not the model—executes each tool call. Re-run every proposed action through deterministic validation and `policy.evaluate`; require a human for approvals and any action outside explicit limits. Do not expose wallet keys, direct database access, arbitrary HTTP, code execution, or a tool that can override policy. Gemini's function calling returns tool requests for the application to execute; it does not execute application code itself ([function-calling guide](https://ai.google.dev/gemini-api/docs/function-calling)).

## Trigger-to-worker automation

The automation path is `saved trigger → background planner → deterministic policy gate → action or field task → worker report → human decision when required`. A `work_order` action now opens an assigned worker task; a `field_check` action does the same with the configured questions and report fields. The assignee set on a trigger takes precedence over the site's default technician. Planner implementations may enrich or propose these structured items, but they must not change assignment permissions, skip policy, or execute a payment.

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

`contracts/src/OperatingWallet.sol` accepts one six-decimal ERC-20 token. It supports approved-recipient agent payments with immutable $250/$1,000 limits, supervisor payments capped at $5,000, a stand-in backup capped at $5,000 per owner absence, owner rotation of the agent, backup, and guardians, signed primary decisions, and guardian recovery that refuses guardians or the backup as candidates. Its interface is compiled by `npm run compile --workspace @workkite/contracts` into ignored `contracts/artifacts/` ABI/bytecode files.

`npm run dev:chain` already wires it to the application on a local Hardhat node through `apps/api/averlock/chain.py` (`WORKKITE_WALLET=local-chain`, `WORKKITE_CHAIN_RPC`). That adapter signs with the node's unlocked development accounts and calls the node inside the workspace transaction; it reconciles an action already paid on chain instead of paying twice. Treat it as a demonstration of the contract rules, not as the production design below.

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

