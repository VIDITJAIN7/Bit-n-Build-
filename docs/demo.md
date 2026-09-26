# Demo walkthrough

Start both local services with `npm run dev`. Open `http://127.0.0.1:5173`. The circular-arrow button in the header restores the sample workspace with confirmation.

## The agent works in the background

1. Open the **Control panel**. The background agent has already run: the header reads "6 routine actions handled · 2 need your attention", and the agent bar shows its cycle count and last run. Nothing had to be started.
2. Each trigger is a tile: its condition (with an editable threshold), its action, the records matching right now, and how often it fired, was handled, or went to review. Use the site strip (or the sidebar selector) to focus on one site; the panel, review queue, field console, and data editor all follow it.
3. Point out the two decisions waiting: the $820 filter order (above the $250 agent limit) and the $4,700 inverter replacement (unapproved supplier, new payment destination, 9.2× a typical purchase, field confirmation required).

## Operators change data; the agent reacts

1. Open **Data** and set INV-07's temperature to 85.
2. Return to the Control panel. Within one cycle, the "Overheating equipment" tile lists INV-07 and the activity feed shows the agent filing a work order. No approval was needed: it moves no money.
3. Optionally set a supplier's payment destination to a new value. The next restock through that supplier is routed to review as a new destination instead of paid.

## Build a trigger

1. Open **Triggers** and choose the "Battery low → field check" template.
2. Change the threshold to 70. The live preview, evaluated by the server, matches BAT-01 at 64 %.
3. Create it. It appears on the Control panel, and the next cycle sends the question to the field console.
4. On any tile, type a new threshold (for example Overheating above 90) and press Enter to retune it in place. Press **Run** on the "Site safety walk" runbook to send a check to every freezer at Harbor Cold Store.

## Field evidence unlocks the gated purchase

1. In **Review queue**, choose **Request verification** on the replacement, then open **Field console**.
2. Optionally select **Simulate high heat**. Controls enlarge, optional notes collapse, and the final confirmation requires equipment-ID readback plus a hold.
3. Enable **Simulate offline**. Pick the INV-04 task, answer the question, complete the three compliance observations, and attach a photo. **Use demo illustration** creates visibly labeled sample evidence so the walkthrough does not require a camera.
4. Save. In high heat, enter `INV-04` and hold the button for a second, or activate it twice using Enter/Space. The record appears as **PENDING SYNC · SAVED**.
5. Reconnect by disabling the simulation. Automatic sync changes the record to **CONFIRMED** after server acceptance.
6. Return to **Review queue**, inspect the technician evidence, check the review acknowledgment, and hold to authorize. The wallet balance decreases and a `sim-…` receipt enters the audit log. No blockchain transaction has been sent.

## Show meaningful scrutiny

1. Enable the **announced attention-drill program** in Review.
2. Use **Add demo drill**. It looks like a routine restock, but the payment destination is a lookalike of an approved supplier's.
3. Approve it to demonstrate an immediate reveal. No funds can move. This reviewer's missed-drill count increases, and future approvals require typing the exact payment destination.
4. Alternatively reject it to demonstrate catching the mismatch. Two caught drills in succession clear enhanced friction after a miss.

Normal insertion probability is 3% per new proposal; the demo button makes the presentation repeatable.

## Show continuity before recovery

1. Leave an action pending and open **Authority & recovery**.
2. **Advance 4h** activates the backup. Return to Review and select Omar from the demo-authorizer dropdown. Pending actions can be handled within the existing limits; the primary clock stays unchanged.
3. **Advance 7 days** makes guardian recovery eligible. Start it, approve as two distinct guardians, and observe the 48-hour timelock.
4. Either cancel as the original owner or **Advance 48h · demo only**, then finalize. Authority changes while funds stay in the wallet.

The local EVM tests independently check the same timing and spending invariants in Solidity. Blockchain time acceleration exists in tests only, never in the contract.

## Keep it moving

Turn on **Simulated sensor feed** on the Control panel. Readings drift, occasional excursions cross thresholds, and consumables deplete, so restocks, work orders, and alerts keep arriving on their own while the review queue only grows when policy requires a person. Use **Run cycle now** to skip the five-second wait, or pause the agent with its switch.

## Full offline application shell

The development server exercises offline record storage but intentionally does not register a worker. For a production shell:

```sh
npm run build
npm run preview --workspace @averlock/web
```

Keep the local API running on port 8000. Open `http://127.0.0.1:4173`, load a field task while connected, and let service-worker installation complete. The compiled JS/CSS is precached. A browser Network/Offline setting can then demonstrate an offline reload; the cached snapshot and IndexedDB records remain accessible. Reconnect and sync afterward.

The demo's heat readings and sensor feed are not live data. An outdoor usability recording should be made by the team on its actual device; this repository does not claim a real sunlight or heat field trial.
