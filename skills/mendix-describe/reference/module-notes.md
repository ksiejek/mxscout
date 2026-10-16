# Notes on a module

What a developer should know before changing one module, written by the agent
once it has read the module's section of the pack. They sit on the module's
page in the documentation, in its About tab beside the module's description,
said to be an agent's: a table stays a table, and a qualified name becomes a
link to that flow, page or entity.

These are what the documentation does not already show by itself: the
parameters, callers, steps, roles and access rules of every flow and entity
are there, read from the model. Do not write them again.

## What goes in

Sections, each with a `title` and any of `text` (paragraphs, a blank line
between them), `items` (one line each) and one small `table`. Use the
sections the module needs; leave out the ones it does not:

| Section | What it says | Shape |
|---|---|---|
| Key entities | The entities that carry the module and what each is **for** in the business, with the associations that matter, also to other modules | table: Entity · Role in the business · Key attributes and associations |
| Business processes | Who (which role) does what, in what order, how a status moves, which flows do it | items, one per process; flows by qualified name |
| Key flows | The flows a developer will meet first and why | table: Flow · What it is for · Started from |
| Integrations | Each inbound and outbound connection: what, where, method, how it is authorised, which flows and mappings; Java and JavaScript actions | items |
| Security | The module roles, who gets them, and the XPath constraints that matter and what they mean | items |
| Naming and layout | The prefixes the module follows (`ACT_`, `SUB_` …) and where things are that their names do not tell | items |
| To confirm | What the model does not settle — a scheduled event that may be switched on in the environment, a role that is assigned somewhere else | items |

Risks are **not** here: they go in the file's `risks`, ranked by
`risk-levels.md`, and the context for the whole application in `context`.
What a module's notes say about security is the setting; a risk is a finding.

## How to write

- **Facts from the model, and where it is silent, say so.** A statement that
  depends on something the model does not show says "to confirm".
- **Names exactly as they are**, qualified (`Module.Name`): inside a sentence,
  an item or a table cell they become links to the flow, page or entity.
- **No secrets.** Note that a password, token or key exists; never its value.
- **For a developer changing the module,** not for a business reader — that is
  what the summary and the description above them are for.
- **Short.** A section is a handful of items or one table of up to a dozen
  rows. A module with little in it has two or three sections.
- **A table has at most six columns,** plain text in every cell.

## In the file

```json
"modules": {
  "Sales": {
    "summary": "…", "story": "…",
    "notes": [
      { "title": "Key entities",
        "table": { "columns": ["Entity", "Role in the business", "Key attributes and associations"],
                   "rows": [["Sales.Order", "One customer's purchase, from draft to paid", "Number, Status; → Sales.Customer, ← Sales.OrderLine"]] } },
      { "title": "Business processes",
        "items": ["Taking an order: a clerk opens Sales.Order_Edit, Sales.ACT_Order_Save numbers it and sets the status to Open."] },
      { "title": "To confirm",
        "items": ["Sales.SE_CloseStale is switched off in the model; whether it runs in production depends on the environment."] }
    ]
  }
}
```
