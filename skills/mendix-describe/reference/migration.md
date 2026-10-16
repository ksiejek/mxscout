# Older files only: `changes` and `tickets` in a descriptions file

**Do not write this format.** It is here so that an older descriptions file
can still be read and understood. Until 2026-10-15 a descriptions file could
carry the changes a person asked to be worked out (`changes`) and the tickets
checked against the model (`tickets`). Both are **Assist items** now, kept on
MxScout's Assist page and written by the mendix-assist skill
(`../../mendix-assist/reference/assist-format.md`):

| The older file's | is now | written by |
|---|---|---|
| a `changes[]` entry | an Assist item of kind `idea` (its `now`, `proposal`, `impact`, `risks`, `open`, `effort`) | mendix-assist, "An idea"; handed over with `agent.js send` |
| a `tickets[]` entry | an Assist item of kind `ticket` | mendix-assist, "A Service Desk ticket" |

What happens to an older file:

- **MxScout** still reads one — imported, sent through the channel or left in
  the inbox — and moves its `changes` and `tickets` to the Assist page (Ideas
  and Tickets), keeping the descriptions as they are.
- **`agent.js write`** refuses a file that has them, and writes nothing: take
  them out, and send each as an Assist item.
- **`agent.js send`** hands such a file over (MxScout moves them) and says it
  is the older format.
- **`check-descriptions.js check`** still checks them, by the rules below, so
  an older file can be told apart from a broken one; `merge` still joins them
  by `id`.

The rest of this file is the older shape, as it was.

## Changes (older files only)

A change is something the person wants made to the application, worked out
before anyone builds it: how that part works **now**, the **proposal**, and the
concrete changes to the model it needs. MxScout shows it on the Assist page, under Ideas —
the request quoted, now and the proposal side by side, both diagrams drawn, the
model changes as a table grouped by kind — and nothing of it is applied
anywhere. It was sent as a part of its own, with `"add": true` and only
`changes` in it:

```json
{
  "format": "mxscout-descriptions",
  "version": 1,
  "add": true,
  "project": "Sales",
  "language": "en",
  "by": "Claude, mendix-describe skill",
  "changes": [
    {
      "id": "cancel-order",
      "title": "Customers can cancel an order until it ships",
      "asked": "Customers should be able to cancel an order themselves, as long as it has not been shipped yet.",
      "date": "2026-10-14",
      "status": "proposed",
      "now": {
        "summary": "Today an order, once placed, only goes forward: a clerk confirms it, the warehouse ships it. A customer who changes their mind has to call the order desk, and a clerk deletes the order by hand.",
        "story": "A customer places an order from the shop page. Orders.ACT_Order_Place checks that it has lines, sets its Status to Placed and puts it in the region's queue.\n\nA clerk takes it from the queue … (the case stage by stage, 150–400 words: who acts, what is checked and set, which statuses it passes through, how it ends).\n\nNothing in the model lets a customer take an order back. The only way out is Orders.ACT_Order_Delete, which a clerk may start from the order screen; it deletes the order and its lines and records nothing.",
        "steps": [
          "The customer places the order from the shop page",
          "A clerk takes it from the region's queue and confirms it",
          "The warehouse marks it shipped when it leaves",
          "To stop an order, a clerk deletes it by hand"
        ],
        "flows": ["Orders.ACT_Order_Place", "Orders.ACT_Order_Confirm", "Orders.ACT_Order_Ship", "Orders.ACT_Order_Delete"],
        "diagram": [
          { "step": "Places the order", "who": "Customer" },
          { "step": "Takes and confirms it", "who": "Clerk" },
          { "decision": "Does the customer call to stop it?", "ways": [
            { "label": "yes", "then": [{ "step": "Deletes the order by hand", "who": "Clerk" }], "end": "Deleted, with no record" },
            { "label": "no" }
          ] },
          { "step": "Marks it shipped", "who": "Warehouse" },
          { "end": "Shipped" }
        ]
      },
      "proposal": {
        "summary": "A Cancel button on the customer's order page, shown until the order ships, sets a new status Cancelled through the flow every status change already goes through, so the history and the delivery date stay right.",
        "story": "The customer opens their order and presses Cancel. … (the solution in plain words, for the people who use it: what they see, what is checked, what is recorded, who is told, what happens when it is too late.)",
        "steps": [
          "The customer opens their order and presses Cancel",
          "The application checks the order has not shipped",
          "It sets the status to Cancelled and records who cancelled it and when",
          "The clerks of the region see it leave their queue"
        ],
        "diagram": [
          { "step": "Presses Cancel on the order", "who": "Customer" },
          { "decision": "Has it shipped?", "ways": [
            { "label": "yes", "end": "Refused: the order is on its way" },
            { "label": "no" }
          ] },
          { "step": "Sets the status to Cancelled", "by": "app" },
          { "end": "Cancelled" }
        ],
        "changes": [
          { "kind": "enumeration", "target": "Orders.ENUM_OrderStatus", "action": "change", "what": "Gets the value Cancelled." },
          { "kind": "attribute", "target": "Orders.Order.CancelledOn", "action": "add", "what": "A date and time, empty until the order is cancelled." },
          { "kind": "microflow", "target": "Orders.ACT_Order_Cancel", "action": "add", "what": "Started by the Cancel button: checks the status is not Shipped and calls Orders.SUB_Order_ChangeStatus with Cancelled." },
          { "kind": "microflow", "target": "Orders.SUB_Order_ChangeStatus", "action": "change", "what": "Accepts Cancelled, sets CancelledOn and skips the delivery date for it." },
          { "kind": "page", "target": "Orders.Order_Detail_Customer", "action": "change", "what": "Gets a Cancel button, visible while the status is Placed or Confirmed." },
          { "kind": "security", "target": "Orders.Customer", "action": "change", "what": "The module role Customer may start Orders.ACT_Order_Cancel, and write CancelledOn on their own orders only." }
        ]
      },
      "impact": {
        "flows": ["Orders.SUB_Order_ChangeStatus", "Orders.DS_Order_QueueForClerk"],
        "roles": ["Customer", "Clerk"],
        "data": "Existing orders keep their status; none becomes Cancelled. The queue's data source must leave Cancelled orders out."
      },
      "risks": [
        { "level": "P2", "title": "An order shipped at the same moment could still be cancelled", "detail": "The warehouse and the customer act on the same order; the button's visibility is decided when the page opens.", "fix": "Check the status again inside Orders.ACT_Order_Cancel, not only on the button." }
      ],
      "open": [
        "Is the payment of a cancelled order refunded, and by whom?",
        "May a clerk cancel on a customer's behalf?"
      ],
      "effort": "small: one new microflow, two changed, one attribute and one enumeration value"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | a slug — lower-case letters, digits and hyphens (`cancel-order`); a change with an id MxScout keeps replaces it. Without one, or without `title`, MxScout drops the change |
| `title` | yes | the change in a line, as the person would say it |
| `asked` | no, but write it | the request in the person's own words; the page opens with it, quoted |
| `date`, `status` | no | `status`: `proposed` (the default), `accepted`, `done` or `dropped` |
| `now` | yes | how it works today: `summary` (1–3 sentences), `story` (one case stage by stage, 150–400 words, as `business-narrative.md` says under "A process"), `steps`, `flows` (qualified names from the pack; they become links) and `diagram` when it branches — the same shape as a process's |
| `proposal` | yes | the solution: `summary`, `story` (in plain words, for the people who use it), `steps`, `diagram` when it branches, and `changes` |
| `proposal.changes[]` | yes | one per model change: `kind` (`microflow`, `nanoflow`, `page`, `entity`, `attribute`, `association`, `enumeration`, `security`, `scheduled event`, `integration` or `other`), `target` (a qualified name — an existing one as the pack names it, a new one by the app's conventions; an attribute as `Module.Entity.Attribute`), `action` (`add`, `change` or `remove`; anything else is dropped) and `what` (one or two sentences). An existing target becomes a link; an added one is marked new |
| `impact` | no | `flows` (existing flows it affects; links), `roles` (user roles that gain or lose something), `data` (what happens to the records already there) |
| `risks[]` | no | as the top-level risks: `level` (`P1`–`P3`) and `title` required, `detail`, `fix` |
| `open[]` | no | the questions the model cannot answer — for the person |
| `effort` | no | a rough size, in words |

MxScout keeps up to 100 changes, 60 model changes per change, 100 steps on each
side, 60 flows in `now` and 60 in `impact`, 30 risks, 30 open questions and 30
roles; text is cut at the lengths "What MxScout kept of them" below gives. Both stories are plain prose like every other
`story`: paragraphs separated by a blank line, no markup.

## Tickets (older files only)

A ticket is something reported on the application — a Jira issue, an e-mail
from a user — checked against the model. **Older files only**: the mendix-assist
skill (`../../mendix-assist/SKILL.md`) writes Assist items instead, and MxScout
moves a ticket an older file carries onto its Assist page. As it was: the ticket as it was
pasted, a **verdict** with how sure it is, the reasoning, what the model does,
the places in the model that show it, what would settle it, a reply to paste
back into the ticket and, for a bug, the change that would fix it. MxScout shows
it on the Assist page, under Tickets, and acts on none of it: nothing is sent to the tracker,
and `source` is shown as text — an address in it is never opened. It was sent as
a part of its own, with `"add": true` and only `tickets` in it — and `changes`
when a fix is proposed:

```json
{
  "format": "mxscout-descriptions",
  "version": 1,
  "add": true,
  "project": "Sales",
  "language": "en",
  "by": "Claude, an earlier ticket-check skill",
  "tickets": [
    {
      "id": "PROJ-12",
      "title": "Cancelled orders still appear in the clerk's queue",
      "reported": "When a customer cancels an order it still shows up in my queue the next morning and I have to skip it by hand. Expected: cancelled orders are gone from the queue.\n\nSteps: cancel order 10423 as the customer, log in as a clerk of the North region, open My queue.",
      "source": "Jira, https://jira.example.com/browse/PROJ-12",
      "date": "2026-10-14",
      "verdict": "bug",
      "confidence": "high",
      "summary": "The ticket is right: the clerk's queue lists every order of the region that has not shipped, and nothing in it leaves out the status Cancelled. It is a fault in the model, not in the data.",
      "story": "The ticket expects an order a customer cancelled to leave the clerk's queue at once. The reporter is a clerk of the North region, and the case is one order cancelled before it shipped.\n\nIn the model, the queue page Orders.Queue_Clerk is filled by Orders.DS_Order_QueueForClerk. That flow retrieves the orders of the clerk's region whose Status is not Shipped, sorted by the date placed. Cancelling (Orders.ACT_Order_Cancel) sets Status to Cancelled through Orders.SUB_Order_ChangeStatus and changes nothing else, so a cancelled order still matches the queue's condition and stays on the page until it is deleted by hand.\n\nThe list on the queue page shows what that flow returns, so the flow's condition is the queue's condition. Orders.ENUM_OrderStatus has the value Cancelled, and nothing in the condition names it. The model behaves this way for every region and every clerk; the data of order 10423 is not needed to see it.",
      "traced": {
        "steps": [
          "The customer cancels the order; the status becomes Cancelled",
          "The clerk opens My queue; the application lists the region's orders that have not shipped",
          "The cancelled order matches, and is listed with the others"
        ],
        "flows": ["Orders.ACT_Order_Cancel", "Orders.SUB_Order_ChangeStatus", "Orders.DS_Order_QueueForClerk"],
        "diagram": [
          { "step": "Opens My queue", "who": "Clerk" },
          { "decision": "Status is Shipped?", "ways": [
            { "label": "yes", "end": "Left out" },
            { "label": "no" }
          ] },
          { "end": "Listed — Cancelled among them" }
        ]
      },
      "evidence": [
        { "kind": "microflow", "target": "Orders.DS_Order_QueueForClerk", "what": "Retrieves the region's orders with Status != Shipped; Cancelled is not left out." },
        { "kind": "microflow", "target": "Orders.SUB_Order_ChangeStatus", "what": "Sets Status to Cancelled and nothing else; the order is not removed from any list." },
        { "kind": "enumeration", "target": "Orders.ENUM_OrderStatus", "what": "Has the value Cancelled beside Placed, Confirmed and Shipped." },
        { "kind": "page", "target": "Orders.Queue_Clerk", "what": "Opens with its list filled by Orders.DS_Order_QueueForClerk, which is what decides the queue." }
      ],
      "needs": [],
      "reply": "Thanks — confirmed. The clerk's queue leaves out shipped orders but not cancelled ones, so a cancelled order stays listed until someone removes it. We will change the queue to leave out cancelled orders too (change queue-leaves-out-cancelled). Until then, cancelled orders can be skipped safely: they cannot be confirmed.",
      "change": "queue-leaves-out-cancelled",
      "risk": "c-7d3f2a9e",
      "risks": [
        { "level": "P3", "title": "Other lists may miss the new status as well", "detail": "Cancelled came after the lists were built.", "fix": "Check every retrieve on Orders.Order that filters by Status." }
      ]
    }
  ]
}
```

The change it names, `queue-leaves-out-cancelled`, is a `changes` entry in the
same file, written as "Changes" above says — how the queue works now, and the
retrieve with `Status != Cancelled` added.

| Field | Required | Notes |
|---|---|---|
| `id` | yes | the ticket's key as it was given (`PROJ-12`), or a slug when it has none — letters, digits, dots, hyphens and underscores, up to 80. A ticket with an id MxScout keeps replaces it; without one MxScout drops the ticket |
| `title` | yes | the ticket's title, or what it reports in a line |
| `reported` | no, but write it | the ticket's text as the person pasted it, trimmed — its own language, its line breaks; MxScout keeps 8,000 characters and shows it quoted, folded when it is long |
| `source`, `date` | no | `source`: where it came from (`"Jira"`, the ticket's address) — kept and shown as text, never opened; `date`: when it was checked |
| `verdict` | yes | `bug` (the model does what the ticket reports, and that is a fault), `as-designed` (the model was built to do it: a misunderstanding, or a wish for a change), `data-config` (the model is right; the data, a constant, a scheduled event switched on or off, a setting or an integration's other side decides it), `cannot-tell` (the model does not settle it: it needs logs, the data, steps to reproduce, the deployed version). Anything else drops the ticket |
| `confidence` | no, but write it | `high`, `medium` or `low` (the default) — how sure the model lets you be |
| `summary` | yes | the answer in one to three sentences; MxScout drops a ticket without it |
| `story` | yes | the reasoning in paragraphs, at least 80 words: what the ticket expects, what the model does instead, why that is or is not a fault — the model's facts and the judgement on them kept apart |
| `traced` | no, but write it | the behaviour as the model has it: `steps` (one sentence each), `flows` (qualified names from the pack; links) and `diagram` when it branches — the same shape as a process's |
| `evidence[]` | no, but write it | the places the verdict rests on: `kind` (as a change's: `microflow`, `nanoflow`, `page`, `entity`, `attribute`, `association`, `enumeration`, `security`, `scheduled event`, `integration` or `other`), `target` (a qualified name, as the pack has it; a link when the documentation has it) and `what` (what it shows, in a sentence) |
| `needs[]` | for `cannot-tell` or `low` | what would settle it: the logs of that day, the record's data, the steps to reproduce, the version deployed |
| `reply` | no | a short answer to paste back into the ticket, in the ticket's language; the page has a button that copies it |
| `change` | for a bug | the `id` of the `changes` entry with the proposed fix — in the same file, or one MxScout keeps; the page links to it |
| `risk` | when it matches one | the `id` of the known risk the ticket is about — the very problem a risk already describes: an agent's risk by its slug (`p2-saved-twice`) or one a person raised in a comment by its `c-…` id, exactly as the pack's `## risk triage` lists it (or as this file's `risks` or the documentation's Risks section give it). MxScout links the ticket to that risk on the Risks page and the risk back to the ticket ("Ticket PROJ-12: Bug in the model"). Never an id you made up; none matching, leave it out — a new risk the ticket shows goes in `risks` |
| `risks[]` | no | as a change's: `level` (`P1`–`P3`) and `title` required, `detail`, `fix` |

MxScout keeps up to 200 tickets, 60 evidence rows, 100 steps and 60 flows per
ticket, 30 needs and 30 risks; text is cut at the lengths "What MxScout keeps"
below gives. The story is plain prose like every other `story`.

## What MxScout kept of them

| Where | Entries kept | Characters kept |
|---|---|---|
| `changes[]` | 100; per change 100 steps on each side, 60 flows in `now`, 60 model changes, 60 `impact.flows`, 30 `impact.roles`, 30 risks, 30 `open` | `id` 80, `title` 200, `asked` 2,000, `date` 40, each side's `summary` 2,000 and `story` 16,000, a step 600, a flow 300, a model change's `target` 300 and `what` 1,000, a role 120, `impact.data` 3,000, a question 1,000, `effort` 300 |
| `tickets[]` | 200; per ticket 100 traced steps, 60 traced flows, 60 evidence rows, 30 `needs`, 30 risks | `id` 80, `title` 200, `reported` 8,000, `source` 300, `date` 40, `summary` 2,000, `story` 16,000, a step 600, a flow 300, an evidence row's `target` 300 and `what` 1,000, a need 1,000, `reply` 4,000 |
| a change's or a ticket's `risks[]` | 30 | `title` 300, `detail` 3,000, `fix` 1,000 |
