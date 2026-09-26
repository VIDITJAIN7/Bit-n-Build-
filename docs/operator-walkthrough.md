# Operator walkthrough

Start the local services with `npm run dev`, then open `http://127.0.0.1:5173`. The sign-in entry routes administrators to `/admin` and field staff to `/worker`. The current local session flow is for product navigation only; connect server-verified identity before exposing it publicly.

## Admin: define work and automation

1. Open **Tasks** and create a rule from a live workspace field, such as battery charge below a threshold. Every rule then appears as a tile on the **Overview**, where on-demand rules have a **Run** button, any rule can be paused, and a numeric threshold can be edited in place.
2. Choose a worker action: a work order or field check. Configure report fields, instructions, and an assignee. Leaving the assignee blank uses the site's assigned technician.
3. Save the trigger. The background agent evaluates enabled automatic triggers, then policy determines whether the resulting action can run autonomously or needs review.
4. A matched work order or field check becomes an assigned worker task. Admins can review task status and evidence from the workspace.

## Worker: complete an assigned task

1. Sign in at `/worker` and select the relevant site.
2. Follow the guided task form: confirm the asset, record the configured answers, attach a site photo, then read back the equipment ID and hold to save.
3. Reports persist on the device when offline and sync with an idempotency key when a connection returns.
4. For anything unplanned, tap **Report an incident**: choose what happened and how serious it is, optionally add a note, photo, and location, then hold to send. Supervisors see it pinned at the top of the Overview until they acknowledge it.

## Human review and authority

High-risk or policy-exception actions remain in the review queue. A confirmed field report can unlock an action configured to require on-site evidence. Guardian recovery requires distinct approvals and its full time lock; the connected identity and wallet services must enforce the real signer roles and chain state.

## Five-minute demo

1. **Approval fatigue.** On the Overview, note *Handled automatically* against *Needed a person*. Open **Simulation controls** and fast-forward 30 days: dozens of routine actions are handled while only a few reach Review, each with its reasons, including the anomaly model's ("Quantity 3 vs usual 1", "First payment to vendor-c-new"). In **Review**, turn on attention checks, insert a practice item from the simulation panel, and approve it to see the reveal and the readback requirement. Approve three items quickly to see the pace check.
2. **Self-custody when someone is unreachable.** Start with `npm run dev:chain`. On **Access**, simulate 4 hours away: the backup can approve, up to $5,000 for the whole absence. Simulate 7 days away, start recovery, approve with two guardians, simulate the 48 hours passing, and transfer access. The chain panel shows each step as a transaction and the contract's new owner; the balance never moves.
3. **Built for the sun.** Sign in as a worker on a phone: one task at a time, big yes/no targets, readback of the equipment ID, hold to save, and offline storage. Report a heat-illness incident and watch it appear, then get acknowledged, on the supervisor's Overview.

## Local validation

```sh
npm test
npm run build
npm run preview --workspace @workkite/web
```

The local planner is deterministic and the local wallet, site feed, and weather readings are not live integrations. See [integrations.md](integrations.md) for the APIs, identity, data, dispatch, hosting, and optional wallet connections required for deployment.

