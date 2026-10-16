# The descriptions file (`mxscout-descriptions` 1)

JSON. MxScout imports it in a project's Documentation section and shows every
sentence as an agent's: marked **✦ AI**, or under a line saying an agent wrote
it. MxScout keeps only what is listed here, as plain
text — anything else in the file is ignored.

```json
{
  "format": "mxscout-descriptions",
  "version": 1,
  "project": "Sales",
  "language": "en",
  "by": "Claude, mendix-describe skill",
  "written": "2026-10-08",

  "app": {
    "summary": "Sales is the order desk of … Two to four sentences: what it is for, who works in it, what it achieves.",
    "story": "The long description, several paragraphs.

Paragraphs are separated by a blank line …",
    "audience": [
      { "who": "Customers", "what": "Place orders and follow them until they are delivered." },
      { "who": "Clerks", "what": "Check and confirm the orders, in teams per region." },
      { "who": "Managers", "what": "Watch the delivery dates of their region." }
    ],
    "processes": [
      {
        "name": "Confirming an order",
        "summary": "A clerk takes an order from the region's queue, checks it and confirms it.",
        "story": "What happens to an order from the moment it is placed, in a few paragraphs …",
        "steps": ["The order arrives in the region's queue", "A clerk takes it", "…"],
        "flows": ["Orders.ACT_TakeOrder", "Orders.ACT_ConfirmOrder"],
        "diagram": [
          { "step": "The order arrives in the region's queue", "by": "app" },
          { "decision": "Is everything in stock?", "ways": [
            { "label": "no", "then": [{ "step": "Asks the customer about a later delivery", "who": "Clerk" }], "end": "Waits for the customer" },
            { "label": "yes" }
          ] },
          { "step": "Confirms it and sets the delivery date", "who": "Clerk" },
          { "end": "Confirmed" }
        ]
      }
    ]
  },

  "modules": {
    "Orders": {
      "summary": "The heart of the app: orders, their lines, delivery dates and history.",
      "story": "What the module does for the people using it, in a few paragraphs …",
      "notes": [
        { "title": "Key entities", "table": { "columns": ["Entity", "Role in the business"], "rows": [["Orders.Order", "What a customer ordered"]] } },
        { "title": "Naming and layout", "items": ["ACT_ flows are started from a page by a button."] }
      ]
    }
  },
  "microflows": {
    "Orders.ACT_ConfirmOrder": {
      "hash": "5c0e7d21",
      "text": "Confirms an order: checks that it has lines, records the confirmation and asks for the confirmation note when the customer's region requires one. Only a clerk may do it."
    }
  },
  "nanoflows": {
    "Orders.ACT_ConfirmOrderStart": { "hash": "…", "text": "…" }
  },
  "pages": {
    "Orders.Order_Edit": { "text": "The order screen clerks work in." }
  },
  "entities": {
    "Orders.Order": { "hash": "…", "text": "What a customer ordered, from placing to delivery." }
  },

  "risks": [
    {
      "id": "p1-operator-reads-all-tickets",
      "level": "P1",
      "theme": "access",
      "title": "Every clerk can read every order",
      "detail": "The read rule on Order for Clerk has no XPath, while every page a clerk reaches lists only the orders of their own region. The client can still fetch the rest.",
      "where": ["Orders.Order", "Orders.Order_Overview_Clerk"],
      "fix": "Add the region constraint to the entity access rule, so the database holds the line the pages draw."
    }
  ],

  "c4": {
    "context": { "nodes": [{ "id": "app", "name": "Sales", "kind": "app" }], "links": [] },
    "containers": { "nodes": [], "links": [] },
    "open": ["Where the application is hosted cannot be told from the model."]
  },

  "context": {
    "where": [
      { "topic": "Where an order's delivery date is set", "place": "Orders.SUB_Order_SetDeliveryDate, called on every status change, not on create." }
    ],
    "conventions": [
      { "pattern": "ACT_", "meaning": "Started from a page by a button." }
    ],
    "pitfalls": [
      "Changing Order.Status outside Orders.ACT_ChangeStatus skips the history record and the delivery date."
    ]
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `format`, `version` | yes | exactly as above, or MxScout refuses the file |
| `add` | no | `true`: the file adds to the descriptions MxScout keeps instead of replacing them — one more process, or flows described since. The application's `summary`, `story` and `audience`, when the file has them, replace the ones kept; a process of the same name is replaced and a new one added at the end; a flow, page, entity or module in the file replaces its old description; a risk already kept — the same `id`, or the same level and title, case and spacing aside — is replaced in its place by the new copy (so a risk ranked at another level under the same `id` takes the old one's place), a new one is added at the end; a `context` entry already kept is not added twice; `project`, `language` and `by` stay as kept (the file's when none is), `written` is the file's; everything else stays. Without it, an import replaces what was kept. `check-descriptions.js merge` joins parts by the same rules, and when every part says `"add": true` the merged file says it too |
| `describedAt` | no — **MxScout writes it** | the model version the descriptions were saved against: `{ "commit", "short", "branch", "date", "message" }`, from the Mendix project's git. MxScout sets it on every save of what an agent sends, to the model's version at that moment, and keeps it in `descriptions.json` and in a package — inside the Mendix project, in `mxscout/mxscout.json`, where `agent.js write` sets it to the commit HEAD names; do not write it yourself |
| `replace` | no | with `"add": true` only: `["app"]` — the file's `app` (summary, story, who uses it, every process) replaces the overview kept, as when the overview was written again from the start; flows, modules, risks and the rest are still added to. Without `"add": true` it is ignored (the checker warns) |
| `project`, `language`, `by`, `written` | no | `by` is shown as who wrote the descriptions. `language` is the code of the language the content is written in (`"en"`, `"pl"`) — the project's language of written content (SKILL.md, "The language you write in"). The first file MxScout takes that names a language sets the project's when it has none; a file in another language is kept, with a warning to the person |
| `setLanguage` | no | `true`, with `language`: the person asked for another language, and MxScout changes the project's language of written content to this one. Not kept with the descriptions |
| `app.summary` | no, but write it | the first thing a business reader sees: 2–4 sentences, always shown |
| `app.story` | no, but write it | the long description, paragraphs separated by a blank line; shown under the summary, folded |
| `app.audience` | no | the groups of people who use the app, as many as there are: `{ "who", "what" }`, a short name and one sentence. The documentation's overview shows each group on a line of its own. A single sentence, as files before this were written, is still read and shown as one paragraph |
| `app.processes[]` | no | every main process the application has, each with `name`, `summary` and `story` (one case, stage by stage, complete as `business-narrative.md` says under "A process" — as long as the case needs); `steps`: one sentence each, naming who does what, as many as the case has; `diagram`, only when the process branches (`business-narrative.md`): a list of `{ "step", "who", "by": "person" \| "app" }`, `{ "decision", "ways": [{ "label", "then": [ … ], "end" }] }` and `{ "end" }` — a way with an `end` finishes there, one with `"join": "<a step's text>"` goes on at that step further on (rules tried in turn that all lead to the same next step), one with neither rejoins the main path, and `then` holds steps and decisions of its own; `flows` are qualified names from the pack and become links. A step's `by` is `person` (the default) or `app`; a way has an `end` or a `join`, not both — with both it ends there |
| `modules` | no | module name → `{ "summary", "story", "notes" }`; a plain string is read as the summary. `notes`: sections for a developer, see `module-notes.md` |
| `c4` | no | the architecture, levels 1 and 2: `context` and `containers` (nodes and links) and `open` (what the model does not show), see `c4.md` |
| `microflows`, `nanoflows`, `pages`, `entities` | no | qualified name → `{ "hash", "text" }`, or just the text |
| `risks[]` | no, but write it | `level` (`P1`, `P2` or `P3`, by `risk-levels.md`) and `title` are required, or MxScout drops the risk; `detail`, `where` (qualified names, they become links) and `fix` are what make it useful; `theme` is its pattern, one of the ten keys in `risk-levels.md` — the Risks page groups and filters by it, and guesses it from the title when it is missing |
| `risks[].id` | no, but write it | a short slug — lower-case letters, digits and single hyphens, at most 80 characters (`p1-anon-delete-ticket`) — unique in the file. **Keep it the same for the same risk on every update** and invent a new one only for a new risk: it is how MxScout knows the risk again, merges it, and keeps what a person decided about it (fixed, false positive — see "Risk triage" in `SKILL.md`). Without it MxScout knows a risk by its level and title, so a reworded title becomes a new risk |
| `verify[]` | no | for risks a **person** raised (listed as `raised by …` under `## risk triage` in the pack) and marked fixed: `{ "id": "c-…", "still": true \| false, "why": "…" }` — whether the model still shows it, with the id the pack gives. MxScout reopens or verifies the risk by it; risks a person raised are never yours to write in `risks` |
| `snapshot` | no, but write it | the id `agent.js status` (or `snapshot`) printed for the model you described: `"snapshot": "1a2b3c4d5e6f"`. `agent.js write` and `send` refuse the file when the model is another one by then — it changed while you worked. MxScout itself ignores it |
| `changes[]`, `tickets[]` | **never write them** | the older format, kept only so an older file still opens: MxScout moves what it finds there to its Assist page, and `agent.js write` refuses a file that has them. A change is an Assist item of kind `idea`, a ticket one of kind `ticket` — the mendix-assist skill writes them (`../../mendix-assist/reference/assist-format.md`). The old shape is in `migration.md` |
| `context.where[]` | no | `{ "topic", "place" }`: what a developer looks for, and where it is when the name does not say |
| `context.conventions[]` | no | `{ "pattern", "meaning" }`: a prefix or naming rule the modules follow |
| `context.pitfalls[]` | no | sentences: what breaks easily, and what to check before a change |

What goes into a `summary` and a `story`, and how long each is, is defined in
`business-narrative.md`, for both skills that write this file. Both are plain text: no markup, no lists; a blank line
starts a new paragraph.

Keys are **qualified names exactly as in the pack** (`Module.Name`). They are
in separate tables because a microflow and a page can share a name.

Risks and context are not tied to a fingerprint: they describe the model as a
whole, and are written again with the application's part when the model
changes — the whole list each time, each risk under the id it had before. A
risk a full file no longer lists is taken as gone — imported, or written with
`agent.js write --replace` (`write` merges otherwise, and keeps it); a file
with `"add": true` says nothing about the risks it does not list. A qualified name in `where`, or inside a `place` or a pitfall, links to
that flow, page or entity in the documentation when the model has it.

A description without `hash` is shown but never marked out of date; with one,
MxScout compares it to the flow's current fingerprint each time it builds the
documentation, and flags the ones that changed since.

## What MxScout keeps

MxScout reads the file within bounds, and past them it drops the rest of a list
or cuts a text short — without a word. `check-descriptions.js check` warns about
each one a file goes past ("MxScout keeps N; the rest is dropped"). The numbers
are generous: a description that respects `business-narrative.md` never meets
them. A text is counted once trimmed.

| Where | Entries kept | Characters kept |
|---|---|---|
| `project`, `language`, `by`, `written` | | 200, 20, 200, 40 |
| `app` | | `summary` 6,000, `story` 16,000; `audience` as one sentence 1,000 |
| `app.audience[]` | 30 groups | `who` 120, `what` 600 |
| `app.processes[]` | 200 | `name` 200, `summary` 2,000, `story` 16,000 |
| a process's `steps[]`, `flows[]` | 100 steps, 60 flows | a step 600, a flow 300 |
| a `diagram` (a process's; an older file's change's or ticket's) | 60 items in each list, 6 ways per decision; a way's `then` nests at most 6 levels under the top list, deeper is dropped | `step` and `decision` 200, `who` 60, `label` 60, `end` 160, `join` 200 |
| `modules`, `microflows`, `nanoflows`, `pages`, `entities` | | the text (or a module's `summary`) 4,000, a `story` 16,000 |
| a module's `notes[]` | 16 sections; 60 `items`, 6 `columns` and 80 `rows` in each | `title` 160, `text` 6,000, an item 800, a column 60, a cell 500 |
| `c4.context`, `c4.containers` | 100 nodes, 250 links | a node's `id` 40, `name` 80, `note` 140, `group` 60; a link's `label` 60; the diagram's `note` 600 |
| `c4.open[]` | 30 | 500 each |
| `risks[]` | 2,000; 40 places in each `where` | `id` up to 80 (a longer one is dropped, and the risk known by its level and title), `title` 300, `detail` 3,000, `fix` 1,000, a place 300 |
| `verify[]` | 500 | `why` 1,000 |
| `context.where[]`, `context.conventions[]`, `context.pitfalls[]` | 80 each | `topic` and `pattern` 300, `place`, `meaning` and a pitfall 1,000 |

## Inside the Mendix project: the same file, split

A project kept inside the Mendix project (`mxscout/`, shared through the app's
git) keeps this file split into small files, so a git conflict stays small:

```
mxscout/descriptions/app.json                 format, version, project, language, by, written,
                                              app { summary, story, audience }, processes: [file names, in order]
mxscout/descriptions/processes/<name>.json    one process, as in app.processes
mxscout/descriptions/modules/<Module>.json    { module, summary (the module's entry), microflows, nanoflows, pages, entities }
                                              — every flow, page and entity of that module, by its qualified name
mxscout/descriptions/risks.json               the risks, as in "risks"
mxscout/descriptions/c4.json                  the architecture, as in "c4"
mxscout/descriptions/context.json             the developers' context, as in "context"
mxscout/mxscout.json                          describedAt
```

You still write one descriptions file as above, in the work folder (`node
agent.js workdir`, never in the project); `node agent.js write
<work>/descriptions.json --folder <MendixProject>` splits it exactly as MxScout does
(`repodocs.js`, MxScout's own code) and writes only the files that changed.
Never edit the split files or `mxscout/docs/` by hand.
