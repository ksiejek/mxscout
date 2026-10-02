# The flows file, field by field

`{ "mxscaffold": "flows", "schemaVersion": 1, … }`. Written by MxScout
(`public/exchange.js`), read by MxScaffold
(`src/import/flows/parseFlows.ts`). Everything below is what the **reader**
does — a field it ignores is noted as ignored, because writing it changes
nothing.

Two habits of the format, both deliberate:

- **References are qualified names**, never anybody's ids. `Sales.Order`,
  `Sales.ACT_Order_Confirm`. Neither tool's internal ids cross the boundary.
- **Unknown fields are ignored**, so a newer writer never has its file
  rejected by an older reader. The reverse of that coin: a field you invent
  does nothing at all, silently.

## The document

| field | what the reader does |
|---|---|
| `mxscaffold` | Must be `"flows"`. Anything else is refused outright. |
| `schemaVersion` | A number above 1 is accepted with a note that unknown fields will be dropped. |
| `source` | `{tool, version, exportedAt}` — the importer does not read it. Keep it and add your own note rather than dropping it; it says where the model came from. |
| `project` | `{name, mendixVersion}` — read into the import summary, not into the project. |
| `flows` | Required, and **must contain at least one flow**; an empty list is refused as a whole file. |

## A flow

| field | what the reader does |
|---|---|
| `name` | Required. Qualified: `Sales.ACT_Order_Confirm`. Everything up to the last dot is the module, the rest is the document name. A flow with no name is skipped with a warning. |
| `module` | Overrides the module taken from `name`. Use it when the name has no dot. |
| `kind` | `"nanoflow"` or `"microflow"`. Anything else (including absent) reads as `microflow`. |
| `path` | Folders from the module down, outermost first — a **list of names**, not a joined path, because a Mendix folder name may itself contain a slash. Omit it for a document sitting straight in the module. |
| `parameters` | `[{name, type, description}]`. `type` in Mendix's own notation: `Sales.Order`, `List of Sales.OrderLine`, `String`. |
| `allowedModuleRoles` | Written by MxScout; **the importer does not read it** today, so a proposal cannot set it. An empty list, in MxScout's own role filter, means the flow is invisible under every specific role. |
| `applyEntityAccess` | Boolean. Same: written, not read on import. |
| `steps` | The elements. |
| `edges` | The arrows. |

## A step

Short ids, `n1`…`nN`, unique **within one flow**. They are remapped on import,
so they never collide with anything already in the project.

| field | what the reader does |
|---|---|
| `id` | Required. A step without one is dropped with a warning. |
| `kind` | What the element is: `activity`, `start`, `end`, `decision`, `objectTypeDecision`, `merge`, `loop`, `annotation`, `parameter`, `errorEvent`, `continue`, `break`. Used when `type` is missing or unknown. |
| `type` | The drawn element, from the catalog of 64 (see `check-proposal.js`). **Unknown or absent with an unknown `kind` → the step is drawn as an annotation** whose sub-line reads `Mendix: <what you wrote>`, and the import reports a warning. Nothing is guessed. |
| `action` | Mendix's own name for the activity (`RetrieveAction`), kept even when `type` is known, so the far side never has to trust the translation table. This is what shows up in the annotation above. |
| `kicker` / `title` / `meta` | The three lines on a card. `title` falls back to `caption`, then to the catalog's default for that type. On 9988 of 10 332 activities measured, Studio Pro generates the caption at drawing time and the stored one is the dead word `"Activity"` — so these three are generated, and a hand-written caption wins. |
| `at` | `{x, y}`. **Missing means `{0, 0}`** — not auto-layout. |
| `size` | `{width, height}`, kept only for `loop`, `annotation` and `parameter`; every other element takes its size from the catalog. |
| `parent` | The `id` of the loop this step sits inside. A loop moves and deletes what it contains. |
| `documentation` | Becomes the step's description — the long text that lands in the specification. |
| `expression` / `rule` | A decision's condition. `rule` present makes it a rule-based decision; otherwise `expression`. |
| `variable`, `returnValue` | Carried onto the step. |
| `loop` | `{mode: "list"｜"while", iteratorVariable, listVariable, condition}`. `listVariable` is read for `list`, `condition` for `while`. |
| `caption` | Fallback for `title` only. |
| `disabled` | Written by MxScout for a disabled activity; the importer ignores it. |
| `ref` | The qualified name of what the step calls or opens. Written by MxScout, **ignored by the importer** — so put the target in `title` or `meta` as well if the drawing should show it. |

## An edge

| field | what the reader does |
|---|---|
| `from`, `to` | Step ids **in this flow**. An edge pointing at a step that is not there is dropped with a warning — it would otherwise be an arrow to nowhere. |
| `kind` | `"error"` for the error outlet, `"annotation"` for the dotted line to a note, absent for an ordinary sequence arrow. Not flags — the same three kinds the reader already models. |
| `caseValue` | The value on a branch outlet: `true`, `false`, or an enumeration value. **This is where a decision's outcomes come from.** All outcomes `true`/`false` → a boolean split; anything else → an enumeration split. |
| `caseKind` | Written by MxScout; the importer ignores it. |
| `fromSide`, `toSide`, `fromVector`, `toVector` | The side the arrow leaves and enters, and the curve's control vectors. MxScout writes them; the importer does not read them yet, so keep them for the day it does — but do not count on the curve surviving the trip. |

## What the file does not carry

Worth knowing before promising any of it in a rationale:

- **Call arguments.** A `callMicroflow` step names its target and not what it
  passes. MxScout does not read them yet.
- **Anything outside the drawing**: security rules beyond
  `allowedModuleRoles`, constants, scheduled events, the pages a flow opens
  (beyond the `ref` name).
- **An overwrite.** There is no "replace this flow" — see the naming rule in
  `SKILL.md`.
