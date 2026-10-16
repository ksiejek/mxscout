# Assist items (`mxscout-assist` 1)

What the mendix-assist skill works on and hands back: a Service Desk **ticket**
checked against the model, a **Jira** issue worked out as a proposal, an
**idea** worked out as a change, and a **workbook** item (kind `other`: a
larger piece of work, or other help) — each one **item**, kept
by MxScout with a status, an optional planned date and a history, so it can be
found again and its state is known the next time.

**Assist items are a local base.** MxScout keeps them on this machine only:
they are **not** in a `.mxscout` package and **not** in the exported
documentation. They are never written into a descriptions file either — a
descriptions file no longer carries `tickets` or `changes` (MxScout moves the
ones an older file had into Assist; see "Migration" below).

## Where items live

In an MxScout project folder:

```
assist/tickets/<id>.json     kind "ticket"
assist/jira/<id>.json        kind "jira"
assist/ideas/<id>.json       kind "idea"
assist/other/<id>.json       kind "other"
inbox/                       where an agent hands results back
```

Each file under `assist/` holds **one item**, as a bare JSON object with the
fields below. **MxScout owns `assist/`**: it writes those files when it
accepts an item, and an agent only reads them. An agent never writes, renames
or deletes anything under `assist/`.

## How an agent hands items back: the envelope

One or more items, in one file:

```
{ "format": "mxscout-assist", "version": 1, "items": [ … ] }
```

Write it in the work folder — `node ../mendix-describe/agent.js workdir`
prints it, `<work>` below — never in the project, and check it there
(`node check-assist.js check <work>/assist.PROJ-12.json`). Then:

- **In the project folder** — `node ../mendix-describe/agent.js send
  <work>/assist.PROJ-12.json --folder <folder>` writes it whole into
  `inbox/` (for a project in its Mendix project: the inbox of its local part —
  the person's MxScout folder, or `mxscout/.local/inbox/`) under a
  timestamped name. MxScout takes it at once while the project is open,
  validates it, stores each item under `assist/<kind>/<id>.json`, shows it
  with **Undo**, and moves the file to `inbox/done/`. Never write into
  `inbox/` yourself, line by line or otherwise.
- **Through the agent channel** (an address and a token):
  `node ../mendix-describe/agent.js send <work>/assist.PROJ-12.json` — the
  same envelope.
- **With neither** — tell the person where the file is (its full path) and to
  import it in MxScout.

An item whose `kind` and `id` MxScout already keeps **replaces** it: the
fields are the new file's, and the **history and the thread are appended** —
MxScout keeps the entries it had and adds every entry of the file's that it
does not already have (the same `date`, `what` and `by`; the same `date`,
`from` and `text`). Questions are merged by their `id`. So send the whole item:
read the current file under `assist/`, change what changed, copy its history
and thread and append your entries.

**An update** carries only what changed — `"update": true` with the item's
`id` and `kind`, `updated`, and any of `status`, `planned`, `closed`, new
`history` and `thread` entries, `questions` (a new one whole; for one
MxScout keeps, its `id`, `status` and `answered` alone), `notes` (a new one
with its text; one MxScout keeps, by its `id` with what changes), `business` and `technical`
(a description of the change, whole; `null` takes it away), and `knowledge` (the
solved case's note, once you wrote it). MxScout merges it into
the item it keeps and leaves every other field as it was. Use it for a status
or a planned date, and to record what the reporter said; when the facts change
the verdict or the proposal, send the whole item. An update for an item MxScout
does not keep is refused.

Envelope fields:

| Field | Required | Notes |
|---|---|---|
| `format`, `version` | yes | exactly `"mxscout-assist"` and `1`, or MxScout refuses the file |
| `items[]` | yes | at least one item; a `kind` and `id` may appear once in a file |
| `project`, `language`, `by`, `written` | no | `by` is who wrote it (`"Claude, mendix-assist skill"`); `written` an ISO date; `language` the ISO code of the items that do not say their own (default `"en"`) |
| `setLanguage` | no | `true`: MxScout also sets the project's `contentLanguage` to the envelope's `language` (which must be there). Sent when the project had no language and the person chose one, or when the person asked to change it; otherwise left out |

**The language is the project's.** MxScout keeps it as `contentLanguage` — in
the project folder's `project.json`, in the browser's project settings, in
`documentation.md`'s header (`Write in: Polish (pl)`) and in what `agent.js
status` prints — so items are not written in one language and then another. An
agent reads it first and writes in it; only when it is missing does it ask the
person (default English), and it sends the answer with `"setLanguage": true`.
Each item still records the language it was written in, as `language`.

## Every item

| Field | Required | Notes |
|---|---|---|
| `id` | yes | how the item is found later, and its file name. **Ticket and Jira:** the tracker's number or key exactly as given (`SD-4711`, `INC0012345`, `SALES-88`, `4711`; a leading `#` dropped) — letters, digits, dots, hyphens and underscores, starting with a letter or digit, at most 80, and with a digit in it. **Idea and other:** a slug — lower-case letters, digits and single hyphens, at most 80 (`discount-approval`) — the agent proposes one and the person may change it |
| `kind` | yes | `ticket`, `jira`, `idea` or `other` — and the folder it is kept in |
| `title` | yes | the item in a line: the ticket's or issue's title as given, or the idea in the person's words |
| `reported` | yes | the text as the person pasted it, trimmed — its own language and line breaks; for an idea or a question, what the person said |
| `source` | no | where it came from, as text only: `"Service Desk"`, `"Jira"`, an address. **Never fetched, never opened**, shown as text |
| `created`, `updated` | yes | ISO dates (`2026-10-15`) or date-times (`2026-10-15T09:30:00Z`); `updated` is not before `created` |
| `status` | yes | `open`, `waiting` (for the reporter's answers), `in-progress`, `done` or `dropped` — a new item is `open`, or `waiting` when it has open questions |
| `planned` | no | an ISO date (`2026-11-20`): when it is planned |
| `closed` | no | an ISO date: when it became `done` or `dropped`. Set it then; leave it out while the item is open or in progress |
| `history[]` | yes | what happened to the item, oldest first: `{ "date", "what", "by" }` — `date` ISO, `what` a sentence, `by` `"person"` (the person said it: "PROJ-12 is done") or `"agent"` (you did it: "Checked against the model: bug, high"). A new item has at least one entry |
| `questions[]` | no | what to ask the reporter (see "Questions and the thread" below): `{ "id", "text", "why", "status", "asked", "answered" }` |
| `thread[]` | no | the exchange with the reporter, oldest first and append-only: `{ "date", "from", "text", "answers" }` |
| `notes[]` | no | what the person asked you to write down on the item while they work on it (see "Notes" below): `{ "id", "text", "topic", "refs", "status", "date" }` |
| `business`, `technical` | no | a description of the change, written when the person asks (see "Descriptions of the change" below): `{ "title", "written", "summary", "sections": [{ "heading", "text" }] }` |
| `knowledge` | no | the solved case this item's solution is recorded in — the case note's path, `"knowledge/SD-4711-cancelled-orders-still-in-the-queue.md"` (`reference/knowledge-format.md`). Set it when you write the note; MxScout then shows **In the documentation** on the item, linking to the case |
| `modelVersion` | no | the model version the item was checked against, as the AI pack's or documentation's `model:` line names it — `"main @ a1b2c3d"`, or the commit's first seven characters. Text, at most 120 characters; MxScout shows it beside the item ("checked against the model at main @ a1b2c3d"). Leave it out when the pack says the version is unknown |
| `language` | no | the language the agent wrote the item in, as an ISO 639 code (`"en"`, `"pl"`, `"de"`; a region may follow, `"pt-BR"`). Default `"en"`: everything written into an item is English unless the person chose another language when the agent asked. Field names, kinds, statuses and list values are always English; `reported` stays as pasted, in its own language |

The diagrams (`traced.diagram`, `now.diagram`, `proposal.diagram`) have the
shape of a process's diagram in
`../../mendix-describe/reference/descriptions-format.md` — steps
(`{ "step", "who", "by" }`), decisions (`{ "decision", "ways": [ … ] }`) and
ends (`{ "end" }`). Flows (`flows`, `sources`, `impact.flows`) are qualified
names as the pack has them (`Orders.ACT_Order_Cancel`). A `story` is plain
prose: paragraphs separated by a blank line, no markup.

Two shapes are shared by several kinds:

- **A proposal** — `{ "summary", "story", "steps", "diagram", "changes" }`:
  the solution in one to three sentences, in plain words for the people who use
  it, its steps, a diagram when it branches, and `changes[]`, one entry per
  model change: `kind` (`microflow`, `nanoflow`, `page`, `entity`,
  `attribute`, `association`, `enumeration`, `security`, `scheduled event`,
  `integration` or `other`), `target` (a qualified name — an existing one as
  the pack names it, a new one by the application's conventions; an attribute
  as `Module.Entity.Attribute`), `action` (`add`, `change` or `remove`) and
  `what` (one or two sentences).
- **Risks** — `risks[]`: `{ "level", "title", "detail", "fix" }`, `level`
  `P1`–`P3` by `../../mendix-describe/reference/risk-levels.md`.

## A ticket (`kind: "ticket"`)

A Service Desk ticket — a user's report — checked against the model.

| Field | Required | Notes |
|---|---|---|
| `verdict` | yes | `bug` (the model does what the ticket reports, and that is a fault), `as-designed` (built to do it: a misunderstanding, or a wish for a change), `data-config` (the model is right; data, a constant, a scheduled event, a role or an integration's other side decides it), `cannot-tell` (the model does not settle it) |
| `confidence` | yes | `high` (the model shows it end to end), `medium` (one link inferred), `low` (it rests on what the model does not show) |
| `summary` | yes | the answer in one to three sentences |
| `story` | yes | the reasoning, at least 80 words: what the ticket expects, what the model does instead, why that is or is not a fault — the model's facts and the judgement on them kept apart |
| `traced` | no, but write it | the behaviour as the model has it: `steps`, `flows`, `diagram` when it branches |
| `evidence[]` | no, but write it | each place the verdict rests on: `{ "kind", "target", "what" }`, `kind` as a model change's |
| `needs[]` | for `cannot-tell` or `low` | what would settle it: the logs of that day, the record's data, the steps to reproduce, the version deployed |
| `reply` | no, but write it | a few sentences to paste back into the ticket, in the item's `language` (English by default) unless the person asked for the ticket's own language. With open questions, it holds them, ready to paste to the reporter |
| `fix` | for a `bug` | the proposed fix, as a proposal (`summary`, `story`, `steps`, `diagram`, `changes`) and an optional `effort` |
| `risk` | no | Developer tools: the id of a known risk the ticket reports — exactly as the pack's `## risk triage` or the documentation's Risks section gives it (`p2-saved-twice`, `c-7d3f2a9e`). Never one you made up |

## A Jira issue (`kind: "jira"`)

A task someone wants built, worked out against the model before anyone starts.

| Field | Required | Notes |
|---|---|---|
| `summary` | yes | the answer in one to three sentences: can it be done, how, how big |
| `story` | yes | how that part of the application works today and how the issue fits it, in paragraphs, at least 80 words |
| `scope` | yes | `{ "feasible", "why", "modules", "touches" }`: `feasible` `yes`, `partly` or `no`; `why` a sentence or two; `modules` the modules it touches; `touches` the existing flows, pages and entities it reaches (qualified names) |
| `proposal` | yes | the solution, as a proposal, with at least one model change |
| `impact` | no, but write it | `{ "flows", "roles", "data" }`: existing flows it affects, user roles that gain or lose something, what happens to the records already there |
| `risks[]` | no | as above |
| `open[]` | no, but write it | the questions the model cannot answer — for the person, or for the issue's reporter |
| `effort` | no, but write it | a rough size, in words ("medium: two new flows, one changed page, one attribute") |
| `reply` | no | a comment to paste into the Jira issue, in the item's `language` (English by default) unless the person asked for the issue's own language; with open questions, it holds them |

## An idea (`kind: "idea"`)

Something the person would like the application to do — worked out as a
change: how that part works now and the proposal side by side.

| Field | Required | Notes |
|---|---|---|
| `now` | yes | how it works today: `{ "summary", "story", "steps", "flows", "diagram" }` — the case traced stage by stage, complete as mendix-describe's `reference/business-narrative.md` says under "A process": as long as the case needs |
| `proposal` | yes | the solution, as a proposal, with at least one model change |
| `impact`, `risks[]`, `open[]`, `effort` | no, but write them | as a Jira issue's |
| `reply` | no | the questions to paste to whoever had the idea, when it has open questions |

## A workbook item (`kind: "other"`)

MxScout shows this kind as **Workbook**; in files and envelopes it stays
`other`, and its folder `assist/other/`. A larger piece of work the person is
doing — what it is, how that part of the app works now, and the notes they
ask you to keep as they go — or a question about how the application works,
an analysis: anything else the person wants kept.

| Field | Required | Notes |
|---|---|---|
| `summary` | yes | the answer, or what the piece of work is, in one to three sentences |
| `story` | yes | the answer in full, or how that part of the app works now, in paragraphs |
| `sources[]` | no, but write it | the flows, pages and entities the answer or the work rests on (qualified names) |
| `proposal` | no | when the answer leads to a change worth making |
| `reply` | no | the questions to paste to whoever asked, when it has open questions |

## Notes

Any item, of any kind, may carry notes: what the person asks you to keep on
it while they work — what to watch out for, and where in the model. MxScout
shows them grouped by topic, each element they name linked to the model, each
a box the person ticks when it is dealt with.

| Field | Required | Notes |
|---|---|---|
| `id` | no | a short id, unique in the item. Leave it out on a new note: MxScout gives it the first free one of `n1`, `n2`, …. Use it to change a note kept |
| `text` | yes, for a new note | what to keep, in a sentence or two, in the item's language: what to watch out for, and why |
| `topic` | no, but write it | a short group heading — "Data integrity", "Security", "Performance" — reusing one the item already has when it fits |
| `refs[]` | no, but write it | the qualified names it is about (`Sales.ACT_Order_Cancel`, `Sales.Order`, an attribute as `Module.Entity.Attribute`), as the pack has them |
| `status` | no | `open` (the default), `done` (dealt with) or `dropped` (no longer wanted) |
| `date` | no | ISO; MxScout sets it to when it took the note |

MxScout keeps `by` (`agent` or `person`) and `done` (when it was ticked) on
each note itself. **A note is never removed**, and never lost: an item sent
again whole keeps every note MxScout has — with the status it has now, since
the person may have ticked it since your copy — and adds the copy's new ones.
So add and change notes with an **update** (`"update": true` and `notes`): a
new one with its `text`; one kept by its `id`, with only what changes — its
`status`, or a corrected `text`, `topic` or `refs`.

## Descriptions of the change

When the change is made, the person may ask for a description of it: one for
the business (`business`) and one technical (`technical`), each kept on the
item. MxScout shows one at a time and has **Copy for e-mail** (business:
formatted, with the text beside it) or **Copy Markdown** (technical), and
**HTML** and **Markdown** downloads — files the browser saves, sent nowhere.

| Field | Required | Notes |
|---|---|---|
| `title` | no | the headline; the item's `title` when left out. For the business, what changes in words they use |
| `written` | yes | ISO: when you wrote it |
| `summary` | yes | the change in one to three sentences — shown first, in a box |
| `sections[]` | yes | `{ "heading", "text" }`, in order: `heading` a short title, `text` plain text — paragraphs separated by a blank line, lists as lines starting `- `, names in the model in backticks (`` `Sales.CancelOrder` ``). No `**bold**`, `#` headings, HTML or links |

Send it in an update, whole: one sent again replaces the one kept, `null`
takes it away. An item sent again whole without it keeps the one MxScout has.
Which sections each has, and how to write them, is the skill's ("Describing
the change").

## Questions and the thread

Every kind may lack what its answer needs: which role the user was in, the
steps to reproduce, the environment and version, expected against actual, the
message the user saw, the record's number. The agent asks the reporter — the
person who raised the ticket, the issue or the idea — through the person.

- `questions[]`: `id` — a short slug, unique in the item (`q1`, `role`);
  `text` — the question as the reporter will read it, in the item's language;
  `why` — what it settles for the verdict or the proposal ("a clerk and a
  manager reach the queue by different flows"); `status` — `open`, `answered`
  or `dropped` (no longer needed); `asked` — the date it was asked;
  `answered` — the date it was answered, once it is.
- `thread[]`: the exchange, oldest first: `date`; `from` — `reporter` (their
  answer, as the person pasted it, trimmed), `person` (the person speaking for
  themselves) or `agent` (what the agent asked or replied); `text`; and
  `answers` — the ids of the questions an entry answers. **Append-only**:
  MxScout keeps every entry it has, and an agent never rewrites one.

While a question is `open` the item is `waiting`. The agent may still give a
provisional answer — a ticket's verdict with `confidence: "low"`, a proposal
with the question in `open` — and says it is provisional. When the reporter
answers, the answer goes into the thread with the questions it `answers`,
those questions become `answered`, and the agent checks again with the new
facts: the verdict, the confidence, the proposal and the status are updated,
and its own reply is a thread entry `from: "agent"`.

## Example: a ticket, a bug with its fix

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "project": "Sales",
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "written": "2026-10-15",
  "items": [
    {
      "id": "SD-4711",
      "kind": "ticket",
      "title": "Cancelled orders still appear in the clerk's queue",
      "reported": "When a customer cancels an order it still shows up in my queue the next morning and I have to skip it by hand. Expected: cancelled orders are gone from the queue.\n\nSteps: cancel order 10423 as the customer, log in as a clerk of the North region, open My queue.",
      "source": "Service Desk",
      "language": "en",
      "created": "2026-10-15",
      "updated": "2026-10-15",
      "status": "open",
      "history": [
        { "date": "2026-10-15", "what": "Checked against the model: bug, high confidence; fix proposed.", "by": "agent" }
      ],
      "verdict": "bug",
      "confidence": "high",
      "summary": "The ticket is right: the clerk's queue lists every order of the region that has not shipped, and nothing in it leaves out the status Cancelled. It is a fault in the model, not in the data.",
      "story": "The ticket expects an order a customer cancelled to leave the clerk's queue at once. The reporter is a clerk of the North region, and the case is one order cancelled before it shipped.\n\nIn the model, the queue page Orders.Queue_Clerk is filled by Orders.DS_Order_QueueForClerk. That flow retrieves the orders of the clerk's region whose Status is not Shipped, sorted by the date placed. Cancelling (Orders.ACT_Order_Cancel) sets Status to Cancelled through Orders.SUB_Order_ChangeStatus and changes nothing else, so a cancelled order still matches the queue's condition and stays on the page until it is deleted by hand.\n\nOrders.ENUM_OrderStatus has the value Cancelled, and nothing in the queue's condition names it. The model behaves this way for every region and every clerk; the data of order 10423 is not needed to see it.",
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
        { "kind": "microflow", "target": "Orders.SUB_Order_ChangeStatus", "what": "Sets Status to Cancelled and nothing else." },
        { "kind": "enumeration", "target": "Orders.ENUM_OrderStatus", "what": "Has the value Cancelled beside Placed, Confirmed and Shipped." }
      ],
      "needs": [],
      "reply": "Thanks — confirmed. The clerk's queue leaves out shipped orders but not cancelled ones, so a cancelled order stays listed until someone removes it. We will change the queue to leave out cancelled orders too. Until then, cancelled orders can be skipped safely: they cannot be confirmed.",
      "fix": {
        "summary": "The queue's retrieve leaves out Cancelled as well as Shipped.",
        "story": "The clerk's queue is decided by one retrieve in Orders.DS_Order_QueueForClerk. Adding Status != Cancelled to its condition takes cancelled orders out of the queue for every region at once, and nothing else reads that flow.",
        "steps": ["The clerk opens My queue", "The application lists the region's orders that are neither shipped nor cancelled"],
        "changes": [
          { "kind": "microflow", "target": "Orders.DS_Order_QueueForClerk", "action": "change", "what": "The retrieve's XPath gets [Status != 'Cancelled'] beside [Status != 'Shipped']." }
        ],
        "effort": "small: one condition in one flow"
      }
    }
  ]
}
```

## Example: a Jira issue

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "items": [
    {
      "id": "SALES-88",
      "kind": "jira",
      "title": "Managers approve discounts above 15%",
      "reported": "As a sales manager I want to approve every discount above 15% before the order is confirmed, so that margins stay under control.",
      "source": "Jira",
      "created": "2026-10-15",
      "updated": "2026-10-15",
      "status": "open",
      "planned": "2026-11-20",
      "history": [
        { "date": "2026-10-15", "what": "Worked out against the model: feasible, medium effort.", "by": "agent" },
        { "date": "2026-10-15", "what": "Planned for 2026-11-20.", "by": "person" }
      ],
      "summary": "Feasible as asked. A discount is set on the order line and checked nowhere; a new status Awaiting approval, set by the confirming flow when a line goes over 15%, and a manager's approve and refuse buttons are enough.",
      "story": "Today a clerk sets a discount on each order line on Orders.OrderLine_Edit, and Orders.ACT_Order_Confirm confirms the order without looking at it: it checks that the order has lines and that every product is in stock, then calls Orders.SUB_Order_ChangeStatus with Confirmed.\n\nThe issue fits the way the application already changes statuses: every change goes through Orders.SUB_Order_ChangeStatus, which records the history and sets the delivery date. A new status, set there, keeps the history right without touching the other flows. Managers already have a module role, Orders.Manager, and a page of their region's orders.",
      "scope": {
        "feasible": "yes",
        "why": "The confirming flow is the one place every order passes before it is confirmed, and statuses already change through one flow.",
        "modules": ["Orders"],
        "touches": ["Orders.ACT_Order_Confirm", "Orders.SUB_Order_ChangeStatus", "Orders.Order_Overview_Manager"]
      },
      "proposal": {
        "summary": "Confirming an order with a line over 15% sets it to Awaiting approval instead; a manager of the region approves it, which confirms it, or refuses it, which sends it back to the clerk.",
        "story": "The clerk presses Confirm as before. When a line's discount is above 15%, the order is not confirmed: its status becomes Awaiting approval and it appears on the manager's overview. The manager opens it, sees the discounts, and presses Approve or Refuse with a reason.",
        "steps": [
          "The clerk confirms the order",
          "The application finds a line with a discount above 15% and sets the order to Awaiting approval",
          "A manager of the region approves it, and it is confirmed, or refuses it, and it goes back to the clerk with the reason"
        ],
        "diagram": [
          { "step": "Confirms the order", "who": "Clerk" },
          { "decision": "A discount above 15%?", "ways": [
            { "label": "no", "end": "Confirmed" },
            { "label": "yes" }
          ] },
          { "step": "Sets it to Awaiting approval", "by": "app" },
          { "decision": "Does the manager approve?", "ways": [
            { "label": "no", "end": "Back to the clerk, with the reason" },
            { "label": "yes" }
          ] },
          { "end": "Confirmed" }
        ],
        "changes": [
          { "kind": "enumeration", "target": "Orders.ENUM_OrderStatus", "action": "change", "what": "Gets the value AwaitingApproval." },
          { "kind": "microflow", "target": "Orders.ACT_Order_Confirm", "action": "change", "what": "Sets AwaitingApproval instead of Confirmed when a line's discount is above 15%." },
          { "kind": "microflow", "target": "Orders.ACT_Order_ApproveDiscount", "action": "add", "what": "Started by the manager's Approve button: calls Orders.SUB_Order_ChangeStatus with Confirmed." },
          { "kind": "page", "target": "Orders.Order_Overview_Manager", "action": "change", "what": "Lists the orders awaiting approval first, with Approve and Refuse buttons." },
          { "kind": "security", "target": "Orders.Manager", "action": "change", "what": "May start Orders.ACT_Order_ApproveDiscount for the orders of their own region." }
        ]
      },
      "impact": {
        "flows": ["Orders.SUB_Order_ChangeStatus", "Orders.DS_Order_QueueForClerk"],
        "roles": ["Manager", "Clerk"],
        "data": "Orders already confirmed stay confirmed; the rule applies from the next confirmation on."
      },
      "risks": [
        { "level": "P2", "title": "The 15% limit is fixed in the flow", "detail": "Changing the limit would need a new version of the model.", "fix": "Keep the limit in a constant, or in the existing settings entity." }
      ],
      "open": ["Is the limit per line or for the whole order?", "Who approves when the region's manager is away?"],
      "effort": "medium: one new flow, two changed, one enumeration value, one page",
      "reply": "Feasible as described. Two questions before it is planned: is the 15% per line or for the whole order, and who approves when the region's manager is away?"
    }
  ]
}
```

## Example: an idea, and a workbook item

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "items": [
    {
      "id": "reorder-from-history",
      "kind": "idea",
      "title": "Customers can place an earlier order again",
      "reported": "It would be nice if a customer could repeat an old order with one click.",
      "created": "2026-10-15",
      "updated": "2026-10-15",
      "status": "open",
      "history": [
        { "date": "2026-10-15", "what": "Worked out against the model: small change.", "by": "agent" }
      ],
      "now": {
        "summary": "A customer sees their earlier orders on Orders.Order_History_Customer, read-only. To order the same again they start a new order and add every product by hand.",
        "story": "A customer opens My orders, which lists their own orders, newest first. Each opens read-only on Orders.Order_Detail_Customer, with its lines, prices and status. Nothing on these pages creates an order.\n\nA new order is always started from the shop page by Orders.ACT_Order_New, which creates an empty order for the current customer; each product is added by Orders.ACT_OrderLine_Add, which takes the product's current price and refuses a product that is no longer sold.\n\nSo a customer who wants the same delivery as last month opens the old order in one tab, starts a new one in another, and copies line by line: the model keeps the old lines, but nothing reads them to build a new order.",
        "steps": ["The customer opens My orders", "They open an earlier order, read-only", "To order again they start a new order and add each product"],
        "flows": ["Orders.ACT_Order_New", "Orders.ACT_OrderLine_Add"]
      },
      "proposal": {
        "summary": "An Order again button on an earlier order creates a new order with the same products and quantities at today's prices, and opens it for the customer to check.",
        "story": "The customer opens an earlier order and presses Order again. A new order is created with the same products and quantities, priced as today, and opened as any new order is; products no longer sold are left out and named in a message.",
        "steps": ["The customer presses Order again on an earlier order", "The application copies the lines at today's prices", "The new order opens for the customer to check and place"],
        "changes": [
          { "kind": "microflow", "target": "Orders.ACT_Order_Repeat", "action": "add", "what": "Creates a new order through Orders.ACT_Order_New and adds each line of the earlier one through Orders.ACT_OrderLine_Add." },
          { "kind": "page", "target": "Orders.Order_Detail_Customer", "action": "change", "what": "Gets an Order again button." }
        ]
      },
      "impact": { "flows": ["Orders.ACT_OrderLine_Add"], "roles": ["Customer"], "data": "Nothing already stored changes." },
      "risks": [],
      "open": ["Should a product no longer sold stop the whole repeat, or be left out?"],
      "effort": "small: one new flow and a button"
    },
    {
      "id": "who-can-reopen-an-order",
      "kind": "other",
      "title": "Who can reopen a confirmed order?",
      "reported": "Who can reopen an order after it was confirmed?",
      "created": "2026-10-15",
      "updated": "2026-10-16",
      "status": "done",
      "closed": "2026-10-16",
      "history": [
        { "date": "2026-10-15", "what": "Answered from the model.", "by": "agent" },
        { "date": "2026-10-16", "what": "Marked done.", "by": "person" }
      ],
      "summary": "Only a manager: Orders.ACT_Order_Reopen is the one flow that moves a confirmed order back to Placed, and only the module role Orders.Manager may start it.",
      "story": "The only flow that sets an order's Status back from Confirmed to Placed is Orders.ACT_Order_Reopen. It is started from a button on Orders.Order_Overview_Manager, and its roles are Orders.Manager alone. A clerk cannot reopen an order: the clerk's pages have no such button, and the flow refuses anyone without the role.",
      "sources": ["Orders.ACT_Order_Reopen", "Orders.Order_Overview_Manager", "Orders.SUB_Order_ChangeStatus"]
    }
  ]
}
```

## Example: a ticket waiting for the reporter

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "items": [
    {
      "id": "SD-4720",
      "kind": "ticket",
      "title": "Cannot save an order",
      "reported": "I cannot save my order, it shows an error. Please fix.",
      "source": "Service Desk",
      "created": "2026-10-16",
      "updated": "2026-10-16",
      "status": "waiting",
      "history": [
        { "date": "2026-10-16", "what": "Checked against the model: cannot tell yet, low confidence; two questions to the reporter.", "by": "agent" }
      ],
      "verdict": "cannot-tell",
      "confidence": "low",
      "summary": "Provisional: three things in the model refuse to save an order, each with its own message, and the ticket does not say which one the reporter saw. Two answers will settle it.",
      "story": "The ticket says an order cannot be saved and an error is shown, but not which error, on which screen, or as whom.\n\nIn the model, saving an order from Orders.Order_Edit runs Orders.ACT_Order_Save. Three things can refuse it. The entity's validation rule on Number refuses an order number that is not ORD- and six digits, with the message that says so. Orders.ACT_Order_Save itself refuses an order with no lines, with a validation feedback on the lines. And a customer may not write Notes on Orders.Order at all, so a customer who edits the notes is refused by the access rules before any flow runs.\n\nEach of the three would be a different verdict: the first two work as designed, the third may be a page that shows customers a field they cannot write. Until the reporter says which message they saw and whether they are a customer or a clerk, the model cannot tell which one this is.",
      "traced": {
        "steps": ["The user presses Save on the order screen", "The entity's validation rules run", "Orders.ACT_Order_Save checks the lines and commits"],
        "flows": ["Orders.ACT_Order_Save"]
      },
      "evidence": [
        { "kind": "attribute", "target": "Orders.Order.Number", "what": "Must be ORD- and six digits, or the save is refused with that message." },
        { "kind": "microflow", "target": "Orders.ACT_Order_Save", "what": "Refuses an order without lines with a validation feedback." },
        { "kind": "security", "target": "Orders.Order", "what": "The module role Orders.Customer may not write Notes." }
      ],
      "needs": ["The exact message the reporter saw", "Whether the reporter works as a customer or a clerk"],
      "questions": [
        { "id": "q1", "text": "What exactly does the message say? A screenshot is best.", "why": "Each of the three refusals in the model shows its own message.", "status": "open", "asked": "2026-10-16" },
        { "id": "q2", "text": "Do you place orders as a customer, or work on them as a clerk?", "why": "Only a customer is refused for editing the notes.", "status": "open", "asked": "2026-10-16" }
      ],
      "thread": [
        { "date": "2026-10-16", "from": "agent", "text": "Asked: what the message says (q1), and whether the reporter is a customer or a clerk (q2)." }
      ],
      "reply": "Thanks for the report. To find the cause we need two things: what exactly does the message say (a screenshot is best), and do you place orders as a customer, or work on them as a clerk?"
    }
  ]
}
```

## Example: the reporter answers

The person says "I got the reporter's answer for SD-4720: I'm a customer, it
says I'm not allowed to change Notes". You read `assist/tickets/SD-4720.json`,
check again with the new facts, and send the whole item back — the reporter's
answer and your reply appended to the thread, the questions answered, the
verdict, confidence, summary, story and status updated (shown here with only
the fields that changed and the thread):

```
"updated": "2026-10-18",
"status": "open",
"verdict": "bug",
"confidence": "high",
"questions": [
  { "id": "q1", …, "status": "answered", "asked": "2026-10-16", "answered": "2026-10-18" },
  { "id": "q2", …, "status": "answered", "asked": "2026-10-16", "answered": "2026-10-18" }
],
"thread": [
  { "date": "2026-10-16", "from": "agent", "text": "Asked: what the message says (q1), …" },
  { "date": "2026-10-18", "from": "reporter", "text": "I'm a customer, it says I'm not allowed to change Notes.", "answers": ["q1", "q2"] },
  { "date": "2026-10-18", "from": "agent", "text": "Checked again: the order page lets customers edit Notes, which their access rule forbids — a bug; fix proposed." }
]
```

## Example: a status update

The person says "SD-4711 is done". You write the solved case's note
(`reference/knowledge-format.md`), and send an update that carries only what
changed — the status, and where the case is recorded:

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "items": [
    {
      "id": "SD-4711",
      "kind": "ticket",
      "update": true,
      "updated": "2026-10-20",
      "status": "done",
      "closed": "2026-10-20",
      "knowledge": "knowledge/SD-4711-cancelled-orders-still-in-the-queue.md",
      "history": [
        { "date": "2026-10-20", "what": "Marked done.", "by": "person" },
        { "date": "2026-10-20", "what": "Recorded as a solved case in knowledge/.", "by": "agent" }
      ]
    }
  ]
}
```

"Plan the idea reorder-from-history for 2026-11-20" sets `planned` and
appends `Planned for 2026-11-20.`; "drop SALES-88" sets `status: "dropped"`
and `closed`; "start on SALES-88" sets `in-progress`. An item that becomes
something else — an idea turned into a Jira issue — is a new item of that
kind; the old one is `dropped` with a history entry naming the new one.

## Example: notes added to a workbook item, and one ticked off

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "items": [
    {
      "id": "who-can-reopen-an-order",
      "kind": "other",
      "update": true,
      "updated": "2026-10-17",
      "notes": [
        { "text": "Reopening must go through Orders.SUB_Order_ChangeStatus, or the status history misses the step back.", "topic": "Data integrity", "refs": ["Orders.SUB_Order_ChangeStatus", "Orders.ACT_Order_Reopen"] },
        { "text": "The reopen button is on the manager's overview only — a second one for team leads needs the role too.", "topic": "Security", "refs": ["Orders.Order_Overview_Manager"] },
        { "id": "n1", "status": "done" }
      ]
    }
  ]
}
```

## Example: the descriptions of a change, for the business and technical

```json
{
  "format": "mxscout-assist",
  "version": 1,
  "language": "en",
  "by": "Claude, mendix-assist skill",
  "items": [
    {
      "id": "who-can-reopen-an-order",
      "kind": "other",
      "update": true,
      "updated": "2026-10-20",
      "business": {
        "title": "Team leads can now reopen a confirmed order",
        "written": "2026-10-20",
        "summary": "From the next release, team leads can reopen an order after it was confirmed, as managers already can. Until now a clerk had to wait for a manager to do it.",
        "sections": [
          { "heading": "What changes for users", "text": "- Team leads see Reopen on a confirmed order, on the same page managers use.\n- Clerks see no change." },
          { "heading": "Who is affected", "text": "Team leads in order handling, and the managers who no longer get these requests." },
          { "heading": "Technical details, in short", "text": "Reopening still goes through the one action that changes an order's status (`Orders.SUB_Order_ChangeStatus`), so the order's history records it as before. Only who may start it changed." },
          { "heading": "Risks and what was tested", "text": "Tested as a team lead, a manager and a clerk. A reopened order can be changed again, so team leads should know their orders are re-checked before they ship." }
        ]
      },
      "technical": {
        "written": "2026-10-20",
        "summary": "Orders.ACT_Order_Reopen is allowed for Orders.TeamLead too, and the Reopen button is on the team lead's overview.",
        "sections": [
          { "heading": "Model changes", "text": "- `Orders.ACT_Order_Reopen`: change — allowed roles Orders.Manager and Orders.TeamLead.\n- `Orders.Order_Overview_Manager`: change — Reopen visible to Orders.TeamLead.\n- `Orders.SUB_Order_ChangeStatus`: unchanged — still the only place the status changes." },
          { "heading": "Security", "text": "Orders.TeamLead gains execute access to one microflow and the Reopen button; no access rule on Orders.Order changed." },
          { "heading": "Testing", "text": "- Reopen as a team lead and as a manager: status back to Placed, history entry written.\n- As a clerk: no button, and the flow refuses." }
        ]
      }
    }
  ]
}
```

## Migration

Older descriptions files carried `tickets` and `changes`. MxScout moves those
it keeps into Assist — a ticket into `assist/tickets/`, a change into
`assist/ideas/` — keeping their ids. Write Assist items only: never put
`tickets` or `changes` into a descriptions file.

## Checking

```
node check-assist.js check <file.json> [--pack ai-pack.md]
node check-assist.js list <project-folder> [--kind ticket|jira|idea|other] [--status open,in-progress]
```

`check` refuses (exit 1) what MxScout would refuse — a wrong envelope, a
missing required field, a value outside its list, an id or a date it cannot
read — and warns about what it would only show worse; with `--pack` it also
warns about qualified names that are not in the model. `list` prints the items
kept under `assist/`, with their status, planned date and last update, and the
files still waiting in `inbox/`.
