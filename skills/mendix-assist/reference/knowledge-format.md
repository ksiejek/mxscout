# Solved cases: the case note

A **case note** is what stays behind when a ticket, a Jira issue or an idea is
solved: the problem, where in the model it came from, what was done, the dead
ends, and how to recognise it next time — so that **any AI agent on another
machine** finds it before working the same thing out again. Most people work
with Claude alone and never open MxScout; the note is a plain Markdown file in
the Mendix project's git, readable by anyone and anything.

One file per case, so two people solving two cases never touch the same file
and git never has a conflict to resolve.

## Where it goes

| The project is kept… | The note goes into |
|---|---|
| inside the Mendix project (`<MendixProject>/mxscout/mxscout.json`) | `<MendixProject>/mxscout/knowledge/` |
| in a project folder of its own (`project.json`, `model.json` …) | `<folder>/knowledge/` |
| nowhere yet — a Mendix project with no MxScout at all | `<MendixProject>/mxscout/knowledge/` (made for it) |

Write the note in the work folder first (`node ../mendix-describe/agent.js
workdir` prints it), check it there, and put it in with **`node
../mendix-describe/agent.js case <work>/<id>-<slug>.md`**: it checks the note
by MxScout's rules, writes it into the `knowledge/` above, and — inside the
Mendix project — brings `mxscout/docs/` up to date. Through the agent channel
it hands the note to MxScout instead (below). The draft stays in the work
folder; nothing else goes into the project.

`knowledge/` is **committed**: it is not under `.local/`. The person commits
the note together with the fix — **the commit is the approval**. Nothing else
asks for one.

The file name is `<id>-<slug>.md`: the case's id, a hyphen, and the title as a
slug (lower-case letters, digits and hyphens, at most 50 characters) —
`SD-4711-cancelled-orders-still-in-the-queue.md`. When the id is already that
slug (an idea's or other help's id usually is), the file is `<id>.md`:
`reorder-from-history.md`. A case written again (revised, reopened and solved
again) keeps its file: `agent.js case` with the same name replaces it.

## The file

```markdown
---
id: "SD-4711"
kind: "ticket"
title: "Cancelled orders still in the queue"
status: "solved"
solved: "2026-10-15"
model: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
flows: ["Orders.ACT_Queue_Retrieve", "Orders.ACT_Order_Cancel"]
entities: ["Orders.Order"]
pages: ["Orders.Queue_Overview"]
keywords: ["queue", "cancelled", "status", "clerk"]
related: []
language: "en"
fingerprints: {"Orders.ACT_Queue_Retrieve": "5c0e7d21", "Orders.ACT_Order_Cancel": "0b9a3e44"}
---

# SD-4711 — Cancelled orders still in the queue

## Problem

A clerk's queue kept showing orders a customer had cancelled. They could be
opened and edited, which led to cancelled orders being shipped.

## Cause

The queue's retrieve in Orders.ACT_Queue_Retrieve filters on
Status != 'Closed' only. Orders.ACT_Order_Cancel sets the status to
'Cancelled', a value added later, which that filter does not exclude.

## Solution

Change the retrieve's XPath in Orders.ACT_Queue_Retrieve to
[Status != 'Closed' and Status != 'Cancelled']. No data migration is needed:
the cancelled orders drop out of the queue as soon as it is retrieved again.

## What did not work

Hiding the row on the page with a visibility condition: the orders still
counted in the queue's total and could be reached through the search.

## How to recognise it next time

Records in a list that should have left it after a status change: compare the
list's retrieve with every value of the status enumeration — a value added
later is often missing from an older filter.
```

### Front matter

Between two `---` lines, one `key: value` per line, in this order. Every value
is written as JSON — a string in double quotes, `null`, a list in brackets, an
object in braces — which YAML reads as well, so any tool can parse it.

| Key | What it is |
|---|---|
| `id` | A ticket's number or a Jira issue's key as the tracker gives it (`SD-4711`, `INC0012345`, `SALES-88`; with a digit in it), or for an idea and other help the slug the Assist item has (`reorder-from-history`). The same id as the Assist item, when there is one. |
| `kind` | `ticket`, `jira`, `idea` or `other` — as the Assist item. |
| `title` | The case in one line, at most 200 characters. |
| `status` | How it ended: `solved` (fixed), `workaround` (a way around it, not a fix), `wont-fix` (decided not to change it, with the reason in Solution), `as-designed` (the application does what it was built to do; Solution says what to tell people). |
| `solved` | The date it was settled, `YYYY-MM-DD`. |
| `model` | The commit of the Mendix project the case was checked against — the pack's `model commit:` line, or `git rev-parse HEAD` in the Mendix project. `null` when it is not known. |
| `flows`, `entities`, `pages` | The qualified names it is about, as the pack names them (`Orders.ACT_Queue_Retrieve`). `[]` when there are none. A later agent finds the case by them. |
| `keywords` | The words someone would search for: the symptom, the screen, the message, the business term — in the project's language and, when it differs, in English too. |
| `related` | Other cases' ids it is related to (`["SD-4650"]`), or `[]`. |
| `language` | The ISO code of the language the sections are written in (`en`, `pl`) — the project's `contentLanguage`. |
| `fingerprints` | Optional, recommended: for each flow or page in `flows` and `pages`, the fingerprint the pack gives it (`#5c0e7d21` → `"5c0e7d21"`). MxScout, and the next agent, compare them with the model as it is then: a flow whose fingerprint moved means the case **may be out of date**. |

### The sections

After the front matter, a `# <id> — <title>` line, then exactly these five
sections, with these headings, **always in English** (so every tool finds them),
and their text in the project's language:

1. `## Problem` — the symptoms, as the people who met it saw them. No names,
   no record numbers: "a clerk", "a cancelled order".
2. `## Cause` — where in the model and why: the flow, the condition, the rule,
   by qualified name.
3. `## Solution` — what was changed in the model, or what to do (for
   `workaround`, `wont-fix` and `as-designed`, what to tell people and why).
4. `## What did not work` — the dead ends, and why each failed. "Nothing else
   was tried." when there were none.
5. `## How to recognise it next time` — the pattern, for the next ticket that
   looks like it.

Plain text and simple Markdown (paragraphs, `-` lists, `code`). No HTML, no
images, no links to a tracker.

## No personal data

A note lives in git for years and is read by machines that index it. It never
holds:

- the reporter's or anyone's **name**, a "Reported by" / "Zgłaszający" line;
- an **e-mail address** or a **phone number**;
- **customer data** — names, addresses, account or order contents;
- **record ids from production** (an object's id, an order number, an
  account number) or anything copied out of production data, logs or
  screenshots.

Say it generally instead: "the reporter", "a customer", "an order in the
Shipped status". The checker (`node check-assist.js knowledge <file>`), and
`agent.js case` with it, refuses
a note with an e-mail address, a phone number, an IBAN, a "Reported by" line
or a long number, and MxScout refuses to take one handed to it.

## Handing it to MxScout instead

When the project is open in MxScout, the note can be handed over instead, and
MxScout writes it into `knowledge/` (saved at once, with Undo):

- through the agent channel: `agent.js case <work>/<id>-<slug>.md` sends it
  as the envelope below;
- into the folder's `inbox/` (`mxscout/.local/inbox/` inside the Mendix
  project): `agent.js send <work>/<id>-<slug>.md` — the note itself, or the
  envelope:

```
{ "format": "mxscout-knowledge", "version": 1,
  "cases": [ { "path": "knowledge/SD-4711-cancelled-orders-still-in-the-queue.md", "text": "---\nid: \"SD-4711\"\n…" } ] }
```

`path` is optional (MxScout names the file from the id and the title). A note
with the same id and kind as one already kept replaces it.

## The Assist item

When the case has an Assist item, the item carries the note's path in
`knowledge` (`"knowledge": "knowledge/SD-4711-cancelled-orders-still-in-the-queue.md"`,
reference/assist-format.md), so MxScout shows **In the documentation** on it.
