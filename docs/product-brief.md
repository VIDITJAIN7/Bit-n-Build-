## **Project Name: Averlock**

### _Autonomy without losing human control._

I checked the naming landscape rather than just renaming Sentinel arbitrarily. **“Sentinel” is especially crowded in exactly this space**: there are already multiple AI-agent governance/security projects using the name, including systems that intercept agent actions, risk-score them, and route them to human review. ([GitHub][1])

For **Averlock**, exact-name searches did not surface a notable AI-agent, field-operations, or governance product using the name; the visible matches were essentially unrelated. So it is substantially less crowded for a hackathon identity. This is a preliminary web-name check, not formal trademark clearance—WIPO recommends checking exact, similar, phonetic, and class-specific marks before commercial use. ([WIPO][2])

---

# Averlock

### **An autonomous field-operations system that knows when to act, when to ask, and what happens when the human in charge cannot respond.**

## The Problem

Modern field operations involve a large number of small but interconnected decisions.

Consider a company operating:

- solar farms,
- telecom towers,
- remote infrastructure,
- utility installations,
- construction sites,
- or industrial maintenance facilities.

Every site continuously produces information about:

- equipment health,
- inventory,
- maintenance schedules,
- work orders,
- supplier availability,
- deliveries,
- budgets,
- and faults.

A human operations manager currently has to connect all of this information manually.

An AI agent could automate much of that coordination, but giving an AI real-world authority creates a second problem:

> **If the AI has to ask for permission for everything, there is little point in making it autonomous.**

And if humans receive dozens of approval requests every day, they eventually stop scrutinizing them and simply press **Approve**.

Averlock is designed around that conflict:

> **Give AI enough authority to be useful without allowing meaningful human oversight to disappear.**

---

# The Solution

Averlock consists of two major systems.

### **1. Operations Agent**

Determines **what needs to happen**.

It monitors operational information, identifies problems and proposes or performs actions needed to keep a site functioning.

### **2. Averlock Control Layer**

Determines **whether the AI is allowed to do it autonomously or whether a human actually needs to intervene.**

So Averlock is not an AI whose purpose is simply to buy things.

Purchasing is only **one possible operational action**.

The agent can also:

- identify upcoming maintenance,
- create work orders,
- schedule technicians,
- move spare inventory between sites,
- compare suppliers,
- arrange deliveries,
- request field verification,
- update maintenance records,
- and escalate equipment failures.

---

# Example Scenario

Imagine Averlock manages operations across **15 remote solar farms**.

At Site 7, sensor data reports:

> Inverter cooling fan vibration increasing
> Predicted maintenance required soon

Averlock also knows:

> Replacement fans in inventory: **0**
> Technician scheduled at Site 7: **3 days from now**

It checks the approved component database:

> Required component: X14 cooling fan

And the supplier catalogue:

| Supplier | Price | Delivery |
| -------- | ----: | -------: |
| A        |   $68 |   2 days |
| B        |   $61 |   6 days |
| C        |   $74 |    1 day |

The cheapest supplier cannot deliver before maintenance.

The AI therefore determines:

> Purchase 2 × X14 fans from Supplier A
> Total: $136
> Arrival: before scheduled maintenance

This is why the AI has purchasing capability.

It isn't replacing Amazon.

It is connecting:

**equipment state → maintenance requirement → inventory → schedule → supplier → budget → action.**

---

# Where Averlock Comes In

The Operations Agent proposes:

> **Purchase 2 × X14 fans — $136**

Averlock evaluates the action.

It sees:

- approved component,
- approved supplier,
- known maintenance requirement,
- normal quantity,
- normal price,
- within autonomous spending limit.

### LOW RISK

**Automatically execute.**

The human doesn't get interrupted.

---

Now another request appears:

> Purchase 20 replacement filters
> $820
> Approved vendor

The purchase is legitimate, but significantly larger than usual.

### MEDIUM RISK

Averlock adds it to the supervisor's review queue rather than immediately interrupting them.

---

Then:

> Replace inverter
> **$4,700**
> New supplier
> New payment address

Averlock sees several anomalies.

### HIGH RISK

The transaction stops.

The supervisor sees:

> **Human review required**
>
> $4,700 inverter replacement
>
> Why you're seeing this:
>
> • Supplier has never been used before
> • Purchase is 9.2× larger than typical site purchases
> • New payment destination
> • Requires confirmation of equipment failure

The system therefore preserves autonomy without making the human approve every routine action.

---

# Problem Statement 1 — Approval Fatigue

This is Averlock's central feature.

Traditional system:

> AI proposes → human approves
> AI proposes → human approves
> AI proposes → human approves
> AI proposes → human approves

Eventually approval becomes meaningless.

Averlock instead assigns actions a risk level using factors such as:

$$
R =
f(
\text{amount},
\text{vendor},
\text{historical behaviour},
\text{operational evidence},
\text{irreversibility},
\text{policy}
)
$$

Then:

| Risk     | Averlock behaviour              |
| -------- | ------------------------------- |
| Low      | Autonomous                      |
| Moderate | Log / batch                     |
| Elevated | Human confirmation              |
| High     | Human review + explanation      |
| Critical | Block / secondary authorization |

A supervisor might therefore see:

> **47 routine actions handled today**
> **2 require your attention**

rather than **49 approval requests**.

The AI handles interpretation and planning, while deterministic company policies enforce what it can actually execute.

---

# Why Not Let the LLM Decide Everything?

Averlock deliberately separates **intelligence from authority**.

The AI can conclude:

> “Supplier A appears to be the best option.”

But a policy engine controls whether that action is permitted.

For example:

```text
Approved vendors only

Agent transaction maximum: $250

Agent daily maximum: $1,000

New payment destination:
ALWAYS require human approval

Orders above $2,500:
2-person authorization
```

So even if the model behaves unexpectedly, it cannot simply ignore spending limits.

That makes the architecture much easier to defend technically.

---

# Problem Statement 2 — Self-Custody Assumes You Are Available

The operational wallet is not the company's entire treasury.

It is a **limited smart-contract-controlled operating wallet**.

For example:

```text
SITE OPERATIONS WALLET

Balance: 15,000 USDC

AI Agent
≤ $250 / transaction

Supervisor
≤ $5,000

Large expenditure
Multisig required
```

This gives the AI enough authority for routine work while keeping major financial authority with humans.

But another problem arises.

### What if the primary supervisor disappears?

They could:

- lose their signing device,
- become incapacitated,
- leave the company unexpectedly,
- become unreachable,
- or permanently lose access to their wallet.

Field operations should not stop because one private key disappeared.

Averlock therefore includes **progressive authority recovery**.

```text
NORMAL OPERATION
       ↓
Supervisor unavailable
       ↓
Recovery initiated
       ↓
Guardian quorum
       ↓
Timelock
       ↓
Authority transferred
```

For example:

> 2-of-3 designated guardians
>
> - 48-hour recovery period
> - original owner can cancel

This avoids giving a single guardian immediate access.

Recovery changes **who can authorize operations**, rather than instantly transferring everything to another person.

---

# Problem Statement 3 — Built for the Field

Averlock isn't only a desktop management dashboard.

The person supplying crucial information may be standing next to the equipment.

Suppose the $4,700 inverter replacement is uncertain.

A supervisor sends:

> **Physical verification required**

The technician receives:

> Site 7 — Inverter 4
> Confirm visible failure indicator.

They're standing outside in:

- direct sunlight,
- heat,
- gloves,
- poor connectivity,
- and possibly using only one hand.

A conventional enterprise dashboard is terrible here.

Averlock therefore includes **Field Mode**.

### Field Mode

The interface switches to:

- extremely high contrast,
- large touch targets,
- minimal text,
- one decision per screen,
- no tiny dropdown menus,
- one-handed controls,
- hold-to-confirm for consequential actions,
- local offline storage,
- clear `SAVED`, `PENDING SYNC`, and `CONFIRMED` states.

For example:

```text
SITE 7
INVERTER 4

⚠ VERIFY FAILURE

RED FAULT LIGHT ACTIVE?

┌──────────────────┐
│       YES        │
└──────────────────┘

┌──────────────────┐
│        NO        │
└──────────────────┘
```

The technician confirms the fault.

That evidence returns to Averlock and becomes part of the supervisor's decision.

Now the outdoor interface isn't a separate hackathon feature—it directly contributes to the AI's decision workflow.

---

# Complete Averlock Loop

```text
        REAL-WORLD SITE
               │
               ▼
 Sensors / Inventory / Work Orders
               │
               ▼
       OPERATIONS AGENT
     "What needs to happen?"
               │
               ▼
        Proposed Action
               │
               ▼
          AVERLOCK
   "Can this happen safely?"
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
     LOW     MEDIUM    HIGH
      │        │        │
 Autonomous  Batch    Human
   action    review    review
                        │
                        ▼
                   FIELD UI
                        │
                        ▼
                  Smart Wallet
                        │
                        ▼
                     Action
```

And if the human cannot participate:

```text
Supervisor unavailable
          │
          ▼
Guardian quorum
          │
          ▼
Recovery timelock
          │
          ▼
New supervisor
          │
          ▼
Operations continue
```

---

# What the AI Actually Knows

For the hackathon, you don't need a massive industrial integration.

Create four simple data sources.

### Equipment telemetry

```text
Site 7 / Inverter 4
Temperature: 78°C
Fan vibration: HIGH
Error events: 13
```

### Inventory

```text
Cooling Fan X14       0
Filter P90            3
Fuse A17             14
Safety Gloves        22
```

### Maintenance schedule

```text
SITE 7

Thursday
Technician: Alex
Task: inverter maintenance
```

### Supplier catalogue

```text
Component X14

Supplier A — $68 — 2 days
Supplier B — $61 — 6 days
Supplier C — $74 — 1 day
```

The AI reasons across these data sources.

That's enough to demonstrate genuine agent behaviour.

---

# Hackathon Demo

The strongest demonstration would be one continuous incident rather than showing isolated features.

### **1 — Routine autonomous operation**

Inventory shows replacement filters running low before scheduled maintenance.

AI:

> Order $92 filters from approved supplier.

Averlock:

> ✓ Within policy
> Executed autonomously

No human interruption.

---

### **2 — Approval fatigue**

Run several routine actions.

Dashboard:

> **18 routine actions handled**
>
> Human intervention avoided: 18

Then one abnormal request enters the system.

Averlock surfaces **only that request**.

---

### **3 — High-risk action**

AI proposes:

> Inverter replacement
> $4,700
> New supplier

Averlock:

> ⚠ HUMAN REVIEW REQUIRED

And gives the exact reasons.

---

### **4 — Field verification**

Supervisor requests physical confirmation.

Switch to the technician's Field Mode.

Technician confirms the equipment fault while offline.

The app shows:

> **Saved locally**

Reconnect.

> **Synced ✓**

---

### **5 — Blockchain execution**

Supervisor approves.

The smart contract verifies their authority and performs a testnet payment.

Show the transaction.

---

### **6 — Self-custody recovery**

Switch to:

> **Simulation: Primary supervisor unavailable**

Guardian 1 approves recovery.

Guardian 2 approves recovery.

Show:

> Recovery threshold reached
> 48-hour timelock

Accelerate time for the demo.

A new supervisor receives authorization.

---

# What Makes Averlock Interesting

Most agent-control systems concentrate on:

> **What is the AI trying to do?**

Averlock places the AI inside a real operational environment:

> **What is happening in the physical world?**
> **What action should happen because of it?**
> **Can the AI execute it autonomously?**
> **Does a human genuinely need to look at it?**
> **Can that human realistically interact with the system in their current environment?**
> **And what happens when that human cannot respond at all?**

That creates one common theme across all three challenges:

### **Human availability is not guaranteed.**

Sometimes the person is:

**unnecessary** → let the agent act.

Sometimes they are:

**needed** → surface the important decision.

Sometimes they're:

**in the field** → give them an interface they can actually use.

Sometimes they're:

**unavailable** → safely recover authority.

---

# MVP Scope

For a hackathon, I would **not** build the full imagined enterprise product.

Build:

1. **One simulated solar site**
2. **One Operations Agent**
3. **5–10 predefined components**
4. **3 suppliers**
5. **A risk/policy engine**
6. **Supervisor approval dashboard**
7. **Field Mode PWA**
8. **One operational smart wallet**
9. **2-of-3 guardian recovery**
10. **One complete end-to-end scenario**

That is enough.

A fully working narrow flow will score better than twenty half-functional features.

---

# Suggested Stack

**Frontend**

Next.js + TypeScript
Tailwind
PWA / IndexedDB

**Operations agent**

Python + FastAPI
LLM for planning/explanations
Structured tool calls

**Risk system**

Rules + lightweight anomaly scoring

**Data**

PostgreSQL / Supabase

**Blockchain**

Solidity
OpenZeppelin
Hardhat/Foundry
Base Sepolia or another EVM testnet

**Wallet interaction**

viem / wagmi

---

# Short Pitch

> **Averlock is an autonomous field-operations platform that lets AI coordinate maintenance, inventory and procurement without flooding humans with approvals. Routine actions execute within strict policy, while anomalous or consequential decisions are escalated with clear evidence. Field workers can verify real-world conditions through an outdoor-first offline interface, while a smart-wallet recovery system ensures operations don't stop if the person holding authority becomes unavailable.**
>
> **The goal isn't to remove the human from the loop—it's to put the human in the loop only when their judgment actually matters.**

That final sentence is probably the **core line I would build the entire presentation around**.

[1]: https://github.com/azdhril/Sentinel?utm_source=chatgpt.com "GitHub - azdhril/Sentinel: 🛡️ Zero-trust governance for AI agents. Intercept, approve, and audit LLM actions with one decorator. Fail-secure by default. · GitHub"
[2]: https://www.wipo.int/en/web/madrid-system/check-availability?utm_source=chatgpt.com "Check Availability"
