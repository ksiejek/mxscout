# The descriptions file (`mxscout-descriptions` 1)

JSON. MxScout imports it in a project's Documentation section and shows every
sentence marked **✦ AI**. MxScout keeps only what is listed here, as plain
text — anything else in the file is ignored.

```json
{
  "format": "mxscout-descriptions",
  "version": 1,
  "project": "Helpdesk",
  "language": "en",
  "by": "Claude, mendix-describe skill",
  "written": "2026-10-08",

  "app": {
    "summary": "Helpdesk is the service desk of … Two to four sentences: what it is for, who works in it, what it achieves.",
    "story": "The long description, several paragraphs.

Paragraphs are separated by a blank line …",
    "audience": "Requesters raise tickets; operators in teams solve them; supervisors watch deadlines.",
    "processes": [
      {
        "name": "Solving a ticket",
        "summary": "An operator takes a ticket from the team queue, works it and closes it as solved.",
        "story": "What happens to a ticket from the moment it reaches a team, in a few paragraphs …",
        "steps": ["The ticket arrives in the team's queue", "An operator assigns it to themselves", "…"],
        "flows": ["TicketsAndTeams.ACT_AssignToCurrentOperator", "TicketsAndTeams.ACT_ChangeSolveTicket"]
      }
    ]
  },

  "modules": {
    "TicketsAndTeams": {
      "summary": "The heart of the app: tickets, the teams that work them, deadlines and history.",
      "story": "What the module does for the people using it, in a few paragraphs …"
    }
  },
  "microflows": {
    "TicketsAndTeams.ACT_ChangeSolveTicket": {
      "hash": "2a173119",
      "text": "Closes a ticket as solved: records the resolution and the time spent, and asks for the closing form when the ticket's category or area requires one. Only the ticket's operator may do it."
    }
  },
  "nanoflows": {
    "TicketsAndTeams.ACT_ChangeSolveTicketStart": { "hash": "…", "text": "…" }
  },
  "pages": {
    "TicketsAndTeams.Ticket_Edit": { "text": "The ticket screen operators work in." }
  },
  "entities": {
    "TicketsAndTeams.Ticket": { "hash": "…", "text": "A request from a user, from registration to closing." }
  },

  "risks": [
    {
      "level": "P1",
      "title": "Every operator can read every ticket",
      "detail": "The read rule on Ticket for Operator has no XPath, while every page an operator reaches lists only the tickets of their own teams. The client can still fetch the rest.",
      "where": ["TicketsAndTeams.Ticket", "TicketsAndTeams.Ticket_Overview_Operator"],
      "fix": "Add the team constraint to the entity access rule, so the database holds the line the pages draw."
    }
  ],

  "context": {
    "where": [
      { "topic": "Where a ticket's deadline is set", "place": "TicketsAndTeams.SUB_Ticket_SetDeadline, called on every status change, not on create." }
    ],
    "conventions": [
      { "pattern": "ACT_", "meaning": "Started from a page by a button." }
    ],
    "pitfalls": [
      "Changing Ticket.Status outside TicketsAndTeams.ACT_ChangeStatus skips the history record and the deadline."
    ]
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `format`, `version` | yes | exactly as above, or MxScout refuses the file |
| `project`, `language`, `by`, `written` | no | `by` is shown as who wrote the descriptions |
| `app.summary` | no, but write it | the first thing a business reader sees: 2–4 sentences, always shown |
| `app.story` | no, but write it | the long description, paragraphs separated by a blank line; shown under the summary, folded |
| `app.audience` | no | one or two sentences |
| `app.processes[]` | no | 3–8, each with `name`, `summary` and `story`; `flows` are qualified names from the pack and become links |
| `modules` | no | module name → `{ "summary", "story" }`; a plain string is read as the summary |
| `microflows`, `nanoflows`, `pages`, `entities` | no | qualified name → `{ "hash", "text" }`, or just the text |
| `risks[]` | no, but write it | `level` (`P1`, `P2` or `P3`, by `risk-levels.md`) and `title` are required, or MxScout drops the risk; `detail`, `where` (qualified names, they become links) and `fix` are what make it useful |
| `context.where[]` | no | `{ "topic", "place" }`: what a developer looks for, and where it is when the name does not say |
| `context.conventions[]` | no | `{ "pattern", "meaning" }`: a prefix or naming rule the modules follow |
| `context.pitfalls[]` | no | sentences: what breaks easily, and what to check before a change |

What goes into a `summary` and a `story`, and how long each is, is defined in
`business-narrative.md` — the same definition the mendix-docs skill writes its
business document by. Both are plain text: no markup, no lists; a blank line
starts a new paragraph.

Keys are **qualified names exactly as in the pack** (`Module.Name`). They are
in separate tables because a microflow and a page can share a name.

Risks and context are not tied to a fingerprint: they describe the model as a
whole, and are written again with the application's part when the model
changes. A qualified name in `where`, or inside a `place` or a pitfall, links to
that flow, page or entity in the documentation when the model has it.

A description without `hash` is shown but never marked out of date; with one,
MxScout compares it to the flow's current fingerprint each time it builds the
documentation, and flags the ones that changed since.
