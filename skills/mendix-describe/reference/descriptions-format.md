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
    "summary": "Helpdesk is the service desk for … Two to six sentences: what it is for, who works in it, what it connects to.",
    "audience": "Requesters raise tickets; operators in teams solve them; supervisors watch deadlines.",
    "processes": [
      {
        "name": "Solving a ticket",
        "summary": "An operator takes a ticket from the team queue, works it and closes it as solved.",
        "steps": ["The ticket arrives in the team's queue", "An operator assigns it to themselves", "…"],
        "flows": ["TicketsAndTeams.ACT_AssignToCurrentOperator", "TicketsAndTeams.ACT_ChangeSolveTicket"]
      }
    ]
  },

  "modules": {
    "TicketsAndTeams": "The heart of the app: tickets, the teams that work them, deadlines and history."
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
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `format`, `version` | yes | exactly as above, or MxScout refuses the file |
| `project`, `language`, `by`, `written` | no | `by` is shown as who wrote the descriptions |
| `app.summary` | no, but write it | the first thing a business reader sees; up to ~2,500 characters |
| `app.audience` | no | one or two sentences |
| `app.processes[]` | no | 3–8; `flows` are qualified names from the pack and become links |
| `modules` | no | module name → text (a string is enough) |
| `microflows`, `nanoflows`, `pages`, `entities` | no | qualified name → `{ "hash", "text" }`, or just the text |

Keys are **qualified names exactly as in the pack** (`Module.Name`). They are
in separate tables because a microflow and a page can share a name.

A description without `hash` is shown but never marked out of date; with one,
MxScout compares it to the flow's current fingerprint each time it builds the
documentation, and flags the ones that changed since.
