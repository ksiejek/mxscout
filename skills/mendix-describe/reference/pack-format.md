# The AI pack (`mxscout-ai-pack 1`)

A text file MxScout writes from a Mendix model (Documentation → **Export AI
pack**). Markdown-like, but read it as lines, not as a document to render.

## Header

```
# MxScout AI pack
format: mxscout-ai-pack 1
project: Helpdesk
mendix: 11.12.5
generated: 2026-10-08T19:15:06.095Z
read with: the mendix-describe skill …
roles: Administrator, Operator, User, …          user roles of the app
scheduled events: Name → Module.Microflow (off)  what runs on a timer
published services: Module.Service (REST); …     what the app offers outside
not included: 24 Marketplace modules — …         left out on purpose
legend: …
```

Marketplace modules are not in the pack: they are other people's components,
and the business documentation is about this application.

## Index

```
## index
module | lines | microflows | nanoflows | pages | entities
TicketsAndTeams | 22203-28552 | 221 | 45 | 55 | 30
```

`lines` is the module's range in this file, 1-based and inclusive. Read a
module by reading exactly that range.

## A module

```
## module TicketsAndTeams
### entities
E Ticket #1a2b3c4d | attrs: Title:String(200), Status:Enumeration TicketsAndTeams.ENUM_Statuses | refs: → TicketsAndTeams.Team (*-1) via Ticket_Team, ← Comments.Comment (*-1) via Comment_Ticket | doc: …
```

- `E Name #hash` — an entity; `(not persistable)`, `extends X` when so.
- `attrs:` name:type. `refs:` `→` this entity owns an association to the
  other; `←` the other owns one to this. `(*-1)` a reference, `(*-*)` a set.
- `doc:` the entity's Documentation field in the model, when it has one.

Then one block per microflow, nanoflow and page:

```
### MF TicketsAndTeams.ACT_ChangeSolveTicket #2a173119
roles: Administrator, User                 who may run it directly
in: Ticket: TicketsAndTeams.Ticket; …      its parameters
from: nanoflow ACT_ChangeSolveTicketStart; page Ticket_Edit   what calls or opens it
returns: Comments.TempComment
doc: …                                     its Documentation field, if any
steps:
- 2 retrieve from database Ticket · [id = $Ticket]
- 3 if "Operator?" $TicketDB/TicketsAndTeams.Ticket_Account_Operator = $currentUser:
  - false:
    - 4 show message You are not an operator of those ticket. · Information, blocking
    - end returns empty
  - true:
    - 9 create object TempComment · $NewTempComment {TicketStatus=TicketsAndTeams.ENUM_Statuses.Solved; Required=true}
    - 15 call microflow SpecialForms.CreateTempForm {FormDefinition=$FormDefinition; TempComment=$NewTempComment}
    - end returns $NewTempComment
```

- `MF` microflow, `NF` nanoflow, `PG` page. `#2a173119` is the fingerprint —
  copy it into the description's `"hash"`.
- Steps run top to bottom. The number is the step's number in MxScout's
  documentation. Indentation is nesting: the branches of an `if`, the body of
  a `for each` / `while`, an `on error:` path.
- `{member=value; …}` is the data a step sets (create, change) or passes (a
  call, a page). `member add value` / `member remove value` for list members.
  Values are Mendix expressions, cut at 200 characters with `…`.
- `↪ step N` — the flow continues at a step already listed.
- `(disabled)` — Studio Pro skips that step.
- Pages carry `roles`, `in` and `from` only.
