# mendix-assist: your help on a Mendix app, from MxScout

An AI agent that helps you with the work around your Mendix application,
checked against the model MxScout read:

- **Service Desk ticket** — is it a **bug in the model**, does the app **work
  as designed**, is it **data or configuration**, or **cannot it be told from
  the model** (and what would settle it)? With how sure it is, the evidence, a
  reply to paste back and, for a bug, a proposed fix.
- **Jira** — can it be done, which parts of the app it touches, a proposed
  solution in Mendix terms (flows, pages, entities, security to add, change or
  remove, by the app's own conventions), risks, open questions, effort.
- **Idea** — how that part of the app works now, traced through the model, and
  a proposed solution, with its impact, risks, open questions and effort.
- **Workbook** — a larger piece of work you are doing, or a question about
  how the app works, an analysis: an answer with the flows it rests on, and a
  proposal when one is worth making.

On any item you can ask it to **write something down** — "note that
ACT_Order_Cancel must roll back the stock", "zapisz, na co mam uważać w
BulkCancel" — and the note lands on that item in MxScout, grouped by topic,
its microflows and entities linked, a box for you to tick off.

When the report leaves out what the answer hangs on — which role the user
was in, the steps, the environment, the exact message — it says what to ask
the reporter, each question with why it matters, ready to paste, and marks
the item **waiting**. Come back with "I got the reporter's answer for
SD-4720: …" and it records the answer, checks again and updates the verdict.

Each becomes an **Assist item** in MxScout, under its number (or a short id
for an idea), with a status — open, waiting, in progress, done, dropped — an optional
planned date and a history. Tell the agent "SD-4711 is done" or "plan
reorder-from-history for 2026-11-20" and it updates the item.

**Assist items stay on your machine**: they are not in a `.mxscout` package
and not in the exported documentation.

The agent never changes the model, never opens a ticket's address and never
talks to Jira, the Service Desk or anything else: the only connection is the
one mendix-describe makes, to the MxScout on your own machine. `SKILL.md` is
what the agent reads. This file is for you.

## What you need

- MxScout, with the project loaded — best kept in a **project folder**.
- The **mendix-describe** skill installed **beside** this one. mendix-assist
  uses its tools — `agent.js` (the agent channel) and `check-descriptions.js`
  (reading the pack) — and its references, by the path `../mendix-describe/`.
- Node, for the scripts. Nothing to install.

## Install (once)

Copy both folders into your skills folder, side by side:

```bash
cp -r skills/mendix-describe skills/mendix-assist ~/.claude/skills/
```

or link them, so a `git pull` of MxScout updates them:

```bash
ln -s "$PWD/skills/mendix-describe" "$PWD/skills/mendix-assist" ~/.claude/skills/
```

or let MxScout's `skills/install.sh` (Windows: `skills\install.ps1`) do it.
For Codex, `skills/install.sh --codex` (`-Codex`) puts them into
Codex's `~/.agents/skills/` and `~/.codex/skills/` as well, for newer Codex versions
that load skills.

## Start it

Type `/mendix-assist` (in Codex: "use the mendix-assist skill"), or just say what you have: "help with a ticket", "I
have a Jira", "I have an idea" — or in Polish "pomóż z ticketem", "mam Jirę",
"mam pomysł", "sprawdź zgłoszenie", "czy ten ticket ma rację bytu".

Give the agent the model one of three ways:

- **The project folder** (the default) — its path. The agent reads
  `documentation.md` first, as its map, checks what matters in `ai-pack.md`,
  reads the items under `assist/` so it knows what is open and closed, and
  hands its result back into `inbox/`, which MxScout takes at once, with
  **Undo**. For a project kept inside the Mendix project (`mxscout/`), give
  the Mendix project's path: your Assist items, the inbox and the pack are in
  `mxscout/.local/`, which is never committed — each person has their own.
- **The agent channel** — in MxScout, **Documentation** → **Share with an
  agent** → **Copy for the agent**, and paste that line.
- **A file** — **Documentation** → **Export AI pack**; the agent writes a file
  you import.

It asks first **what kind** it is (unless that is obvious), **the number** of
the ticket or Jira issue (unless your request already has it — "check
SD-4711" is enough; for an idea or a workbook item it proposes a short id you
can change), and — only when the project has none yet — **in which language
to write**: English unless you say otherwise, and kept for the project from
then on ("from now on in Polish" changes it). Then it restates what it understood, asks only what blocks the
work, traces it through the model and hands the item back.

### Solved cases

Before it works a new item out, the agent searches the **solved cases** in
the Mendix project's `mxscout/knowledge/` — one Markdown note per case — and
cites a similar one by its id, saying whether it may be out of date. When a
case is **solved** — you say it is done, or "add it to the documentation" /
"dołóż to do dokumentacji" — it writes the note itself: the problem, the
cause, the solution, what did not work, how to recognise it next time, with
no personal data (no names, e-mail addresses, phone numbers, customer data or
record ids from production). It tells you where: "I recorded case SD-4711 in
mxscout/knowledge/ — commit it with the fix." **The commit is the approval.**
The next person's agent finds it there — with MxScout or without. The format
is `reference/knowledge-format.md`; `node check-assist.js knowledge <note>`
checks a note, `node ../mendix-describe/agent.js case <note>` puts it into
`knowledge/`, `node check-assist.js cases <MendixProject> --find "…"` searches
them.

### Your project stays clean

The agent writes nothing into the Mendix project but the documentation: the
case note in `mxscout/knowledge/`, and its items into the inbox in
`mxscout/.local/`. Everything it makes while it works — the pack it greps,
its notes, the item before it is sent — goes into a work folder outside the
project, which `node ../mendix-describe/agent.js workdir` prints:
`$MXSCOUT_WORK` when you set it, else `mxscout-work/<project>` in the
system's temporary folder (on macOS under `/var/folders/…/T/`, on Windows
`%TEMP%\mxscout-work\<project>`). `agent.js` refuses to write anything else
into the project.

## Examples

A Service Desk ticket:

```
/mendix-assist — a Service Desk ticket, SD-4711:

Cancelled orders still appear in the clerk's queue.
When a customer cancels an order it still shows up in my queue the next
morning and I have to skip it by hand. Expected: cancelled orders are gone.
```

```
Sprawdź zgłoszenie SD-4711, czy ma rację bytu. Pisz po polsku.

Anulowane zamówienia nadal widać w kolejce sprzedawcy …
```

A Jira issue:

```
I have a Jira, SALES-88: managers approve every discount above 15% before
the order is confirmed. Is it feasible, and how would you build it?
```

```
Mam Jirę SALES-88: kierownik zatwierdza każdy rabat powyżej 15%, zanim
zamówienie zostanie potwierdzone. Da się? Jak to zrobić?
```

An idea:

```
I have an idea: customers could place an earlier order again with one click.
```

```
Mam pomysł: klient mógłby jednym kliknięciem powtórzyć wcześniejsze zamówienie.
```

A larger piece of work, and notes on it as you go:

```
I'm starting a bigger task: reworking order cancellation. Keep a workbook item for it.
Note that BulkCancel calls CancelOrder per order — batch the commit.
```

```
Mam większy element do zrobienia: przebudowa anulowania zamówień. Załóż na to pozycję w Workbook.
Zanotuj, że w ACT_Order_Cancel trzeba zrobić rollback stanów magazynowych.
```

Other help:

```
Who can reopen an order after it was confirmed?
```

```
Kto może ponownie otworzyć zamówienie po jego potwierdzeniu?
```

The reporter answers:

```
I got the reporter's answer for SD-4720: I'm a customer, it says I'm not allowed to change Notes.
Zgłaszający odpisał w SD-4720: jestem klientem, komunikat mówi, że nie mogę zmienić Notes.
```

Status and planned date:

```
SD-4711 is done.  ·  Plan reorder-from-history for 2026-11-20.  ·  Drop SALES-88.
SD-4711 jest zrobiony.  ·  Zaplanuj reorder-from-history na 2026-11-20.  ·  Porzuć SALES-88.
```

## For whoever maintains it

- `reference/assist-format.md` — the item and the envelope the agent hands
  back (`"format": "mxscout-assist"`), every field per kind, with examples.
- `check-assist.js` — `check <file> [--pack ai-pack.md]` validates a file
  before `agent.js send` puts it into `inbox/` (a file named without a path
  is looked for in the work folder first); `list <project-folder>` prints the items kept
  under `assist/` with their status and planned date, and what is still
  waiting in `inbox/`.
- `selftest.js` — `node selftest.js`: the checker over invented items, every
  example in the format reference, and the work folder: working files land
  there and the Mendix project gains only the documentation.

Older descriptions files carried `tickets` and `changes`; MxScout moves those
into Assist, and this skill writes Assist items only. It replaces the earlier
mendix-ticket-check skill.

A verdict or a proposal is an agent's judgement from the model. The model shows
how the application is built, not what it did on a given day: read the
reasoning before you answer the ticket.
