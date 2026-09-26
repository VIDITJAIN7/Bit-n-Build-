# Operator walkthrough

Start the local services with `npm run dev`, then open `http://127.0.0.1:5173`. The sign-in entry routes administrators to `/admin` and field staff to `/worker`. The current local session flow is for product navigation only; connect server-verified identity before exposing it publicly.

## Admin: define work and automation

1. Open **Triggers** and create a rule from a live workspace field, such as battery charge below a threshold.
2. Choose a worker action: a work order or field check. Configure report fields, instructions, and an assignee. Leaving the assignee blank uses the site's assigned technician.
3. Save the trigger. The background agent evaluates enabled automatic triggers, then policy determines whether the resulting action can run autonomously or needs review.
4. A matched work order or field check becomes an assigned worker task. Admins can review task status and evidence from the workspace.

## Worker: complete an assigned task

1. Sign in at `/worker` and select the relevant site.
2. Follow the guided task form: confirm the asset, record the configured answers, attach a site photo, then read back the equipment ID and hold to save.
3. Reports persist on the device when offline and sync with an idempotency key when a connection returns.

## Human review and authority

High-risk or policy-exception actions remain in the review queue. A confirmed field report can unlock an action configured to require on-site evidence. Guardian recovery requires distinct approvals and its full time lock; the connected identity and wallet services must enforce the real signer roles and chain state.

## Local validation

```sh
npm test
npm run build
npm run preview --workspace @workkite/web
```

The local planner is deterministic and the local wallet, site feed, and weather readings are not live integrations. See [integrations.md](integrations.md) for the APIs, identity, data, dispatch, hosting, and optional wallet connections required for deployment.

