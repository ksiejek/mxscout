# The domain model file, field by field

`{ "mxscaffold": "domain-model", "schemaVersion": 1, … }`. The older of the two
kinds: it is MxScaffold's own export format as well as its import format
(`src/import/json/exchangeSchema.ts`, `parseExchange.ts`, `merge.ts`). Same two
habits as the flows file — references by qualified name, unknown fields
ignored.

## The document

| field | notes |
|---|---|
| `mxscaffold` | Must be `"domain-model"`. |
| `schemaVersion` | `1`. |
| `source` | `{tool, version, exportedAt}`. |
| `project` | `{name, type}`. |
| `enumerations` | `[{name, values: ["Open", "Closed"]}]` — referable by name from an attribute. |
| `modules` | `[{name, color, position}]`. A module named only by an entity is created anyway. |
| `entities` | Required. |
| `associations` | Optional. |
| `notes` | `[{text, position}]` — the analyst's notes pinned to the canvas. |

## An entity

| field | notes |
|---|---|
| `name` | Required. May be qualified (`Sales.Order`) or bare with `module` beside it. |
| `module` | The module name. |
| `persistable` | Boolean. |
| `kind` | `persistable`, `nonPersistable`, `external`, `view`. Absent falls back to `persistable`. |
| `generalization` | Qualified name, e.g. `System.FileDocument`. |
| `position` | `{x, y}`. **Absent is fine here** — unlike the flows file, a domain model with no positions gets laid out automatically. |
| `attributes` | `[{name, type, required, length, precision, enumeration}]`. `precision` in Mendix's notation, e.g. `"14,2"`. `enumeration` is either a name from `enumerations` or a definition in place. |

## An association

| field | notes |
|---|---|
| `name` | e.g. `Order_Customer`. |
| `from`, `to` | Qualified entity names. |
| `multiplicity` | `*-1` (the default), `1-*`, `1-1`, `*-*`. The first half is the `from` side. |
| `owner` | As in Studio Pro. |
| `layout` | `{sourceAnchor, targetAnchor}` — which side of the box the line meets. |

## The merge rule, which decides what a proposal can say

The importer matches an entity by qualified name, and an existing one is **kept
and extended**, never replaced:

- **an attribute the entity does not have yet is added**, matched by name;
- **an attribute it already has is left exactly as it is** — type, length,
  precision, required, all of it;
- nothing is ever removed;
- an association is added unless one with the same name already joins the same
  two entities;
- a module that is not there is created.

So the file is an honest way to say *add*, and has no way at all to say
*change*, *rename* or *remove*. When the proposal needs one of those, say it in
the rationale in words, or put a differently-named entity beside the old one
and explain which is meant to win. Writing a changed type into the file and
reporting it as done would be a false claim: the import would quietly keep the
old one.

This is the opposite of the flows file, where an existing document is skipped
whole. Worth stating in the rationale whenever both kinds are in play.
