# Demo walkthrough

Start both local services with `npm run dev`. Open `http://127.0.0.1:5173`. The circular-arrow button in the header resets local demo data with confirmation.

## One continuous incident

1. Click **Start demo scenario**. The planner orders two X14 fans for $136 and creates a maintenance work order automatically. The $820 filter order and $4,700 inverter replacement enter review. Metrics are calculated from real local state, not padded demo counters.
2. Open the replacement in **Review queue**. Its evidence, supplier, and payment-destination checks explain the interruption. Approval is disabled until a field fault is confirmed.
3. Choose **Request verification** and open **Field console**.
4. Optionally select **Simulate high heat**. Controls enlarge, optional notes collapse, and the final confirmation requires equipment-ID readback plus a hold.
5. Enable **Simulate offline**. Mark the observed fault, complete the three compliance observations, and attach a photo. **Use demo illustration** creates visibly labeled sample evidence so the walkthrough does not require a camera. Add a voice recording or audio upload if desired; microphone permission is requested only after the user clicks Record.
6. Save. In high heat, enter `INV-04` and hold the button for a second, or activate it twice using Enter/Space. The record appears as **PENDING SYNC · SAVED**.
7. Reconnect by disabling the simulation. Automatic sync changes the record to **CONFIRMED** after server acceptance. **Sync now** retries manually if needed.
8. Return to **Review queue**, inspect technician evidence, check the review acknowledgment, and hold to authorize. A single supervisor approves the $4,700 action. The wallet balance decreases and a `sim-…` receipt enters the audit log. No blockchain transaction has been sent.

## Show meaningful scrutiny

1. Enable the **announced attention-drill program** in Review.
2. Use **Add demo drill**. Compare the approved destination `vendor-a` with submitted `vend0r-a`.
3. Deliberately approve the exercise to demonstrate an immediate reveal. No funds can move. This reviewer's missed-drill count increases, and future approvals require typing the exact payment destination.
4. Alternatively reject it to demonstrate catching the mismatch. Two caught drills in succession clear enhanced friction after a miss.

The demo insertion button makes the presentation repeatable. Normal insertion probability is 3% per new proposal; the small fixture does not attempt to statistically demonstrate that rate.

## Show continuity before recovery

1. Leave an action pending and open **Authority & recovery**.
2. **Advance 4h** activates the backup. Return to Review and select Omar from the demo-authorizer dropdown. Pending actions can be handled within the existing limits; the primary clock stays unchanged.
3. **Advance 7 days** makes guardian recovery eligible. Start it, approve as two distinct guardians, and observe the 48-hour timelock.
4. Either cancel as the original owner or **Advance 48h · demo only**, then finalize. Authority changes while funds stay in the wallet.

The local EVM tests independently check the same timing and spending invariants in Solidity. Blockchain time acceleration exists in tests only, never in the contract.

## Full offline application shell

The development server exercises offline record storage but intentionally does not register a worker. For a production shell:

```sh
npm run build
npm run preview --workspace @averlock/web
```

Keep the local API running on port 8000. Open `http://127.0.0.1:4173`, load a scenario and field task while connected, and let service-worker installation complete. The compiled JS/CSS is precached. A browser Network/Offline setting can then demonstrate an offline reload; the cached snapshot and IndexedDB records remain accessible. Reconnect and sync afterward.

The demo's heat readings are not live weather. An outdoor usability recording should be made by the team on its actual device; this repository does not claim a real sunlight or heat field trial.
