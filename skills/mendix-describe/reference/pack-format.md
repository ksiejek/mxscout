# The AI pack (`mxscout-ai-pack 1`)

A text file MxScout writes from a Mendix model: `ai-pack.md` in a project
folder (rewritten whenever the model changes), or Documentation → **Export AI
pack**, or what the agent channel serves. Markdown-like, but read it as lines,
not as a document to render — and by the index's line ranges, never whole
(`node agent.js module <Name> --folder <folder>` reads one range for you).

## Header

```
# MxScout AI pack
format: mxscout-ai-pack 1
project: Sales
mendix: 10.18.0
model: main @ a1b2c3d · 2026-10-14 · Fix order status
                                                 which version of the app: the Mendix project's git branch,
                                                 commit, its date and first line — or "version unknown (…)"
model commit: a1b2c3d4e5f60718293a4b5c6d7e8f9012345678
                                                 the commit in full, when it is known
generated: 2026-10-08T09:00:00.000Z
read with: the mendix-describe skill …
roles: Administrator (Administration.Administrator, Sales.Admin); Clerk (Sales.Clerk); …
                                                 user roles, each with its module roles
scheduled events: Name → Module.Microflow (off)  what runs on a timer
published services: Module.Service (REST); …     what the app offers outside
not included: 12 Marketplace modules — …         left out on purpose
legend: …
```

Marketplace modules are not in the pack: they are other people's components,
and the business documentation is about this application.

**The documentation is not in the pack.** When MxScout shares a project that
has descriptions, it also shares the documentation as Markdown, separately
(`node agent.js docs`; from files, the Markdown copy exported from
Documentation). It starts with `# MxScout documentation — <project>` and a
header of `key: value` lines (`project`, `mendix`, `model`, `model commit`,
`generated`, `modules`, `flows described: N of M`, `out of date: N`, and —
when the descriptions record it — `described at` and `described commit`, the
version they were written for, and `since then`, the commits between that
version and the model's when MxScout found them in the project's local git),
then the documentation's pages
in the order of its menu. A description whose flow changed since it was
written ends in `(out of date — the microflow changed since this was
written)`. It is what an agent wrote earlier: read it as a map to what matters,
and take the facts from this pack.

## Risk triage (Developer tools, when there is any)

```
## risk triage
What a person decided about risks; …
- p2-saved-twice | P2 | fixed | ai | The order is saved twice | where: Sales.CreateOrder | note: Committed once now
- c-5f0e… | P2 | fixed | raised by Karol | The discount is applied twice | where: Sales.CreateOrder
```

Before the index, after the header: one line per risk a person has decided
about — `id | level | status | ai or raised by <who> | title | where | note`.
Statuses: `fixed`, `false-positive`, `reopened`, `verified`, and `open` for a
risk a person raised. `SKILL.md`, "Risk triage", says what to do with each.

## Index

```
## index
module | lines | microflows | nanoflows | pages | entities
Orders | 1204-3310 | 48 | 6 | 17 | 9
```

`lines` is the module's range in this file, 1-based and inclusive. Read a
module by reading exactly that range.

## A module

```
## module Orders
### entities
E Order #1a2b3c4d | attrs: Number:String(20), Status:Enumeration Orders.ENUM_OrderStatus, Notes:String(2000) | refs: → Customers.Customer (*-1) via Order_Customer, ← Orders.OrderLine (*-1) via OrderLine_Order | doc: …
  access Orders.Clerk: read all · write Status, Notes · create · no delete · assoc read all · assoc write Order_Customer — all rows
  access Orders.Customer: read all except Notes · write none · no create · no delete · assoc read all · assoc write none — only [Orders.Order_Customer/Customers.Customer/Customers.Customer_Account = '[%CurrentUser%]']
  valid Number: required — "An order needs a number"
  valid Number: unique — "That order number is already taken"
  valid Number: regex Orders.OrderNumberFormat — "An order number is ORD- and six digits"
  valid Notes: max length 2000
E OrderImport #9f8e7d6c | attrs: FileName:String(200)
  access none
```

- `E Name #hash` — an entity; `(not persistable)`, `extends X` when so.
- `attrs:` name:type. `refs:` `→` this entity owns an association to the
  other; `←` the other owns one to this. `(*-1)` a reference, `(*-*)` a set.
- `doc:` the entity's Documentation field in the model, when it has one.

Under the entity's line, indented by two spaces, **who may do what with it**
and **what refuses a save**:

- `access <module role>: …` — one line per module role an access rule names
  (`grep -n "access Orders.Clerk"`). A role named by two rules has two lines;
  together they grant what either grants. The header's `roles:` line says
  which user roles carry that module role.
  - `read …` the attributes the role may read, `write …` those it may also
    change: `all`, `none`, a list, or `all except` a list. **An attribute
    not listed is one the role may not read (or write).**
  - `create` / `no create`, `delete` / `no delete` — whether it may make
    new objects or delete them.
  - `assoc read …` / `assoc write …` — the same for the associations this
    entity owns (the `→` ones), said only when it owns some.
  - `— all rows`, or `— only [XPath]`: the rows the rule reaches, the XPath
    as the model has it (cut at 300 characters with `…`).
- `access none` — no access rule names the entity: no role reaches it from
  the client; only a flow can read or change it.
- `valid <attribute>: <kind> — "message"` — a validation rule on the entity,
  checked whenever an object is committed, before any flow sees it
  (`grep -n "valid "`). Kinds: `required`, `unique`, `range 0..10000` /
  `range ≥ 0` / `range ≤ 10000`, `regex Module.RegularExpression`,
  `max length 200`, `equals <value>`; a bound that is another attribute
  reads `attribute Name`. The message is what the user is shown, when the
  model has one.

An entity's fingerprint is its members and associations — **not** its access
lines or its validation lines. A role gaining write access, or a new
validation rule, does not put the entity's description out of date (and
these lines were added without moving any fingerprint).

**Not in the pack:** the client-side validation a page does on a field — an
input's own *required* or custom validation message (the Pages screen in
MxScout shows it).

Then one block per microflow, nanoflow and page:

```
### MF Orders.ACT_ConfirmOrder #5c0e7d21
roles: Administrator, Clerk                who may run it directly
in: Order: Orders.Order; …                 its parameters
from: nanoflow ACT_ConfirmOrderStart; page Order_Edit   what calls or opens it
returns: Orders.ConfirmationNote
doc: …                                     its Documentation field, if any
steps:
- 2 retrieve from database Order · [id = $Order]
- 3 if "Has lines?" $OrderDB/Orders.OrderLine_Order != empty:
  - false:
    - 4 show message An order needs at least one line. · Information, blocking
    - end returns empty
  - true:
    - 9 create object ConfirmationNote · $Note {OrderStatus=Orders.ENUM_OrderStatus.Confirmed; Required=true}
    - 15 call microflow Documents.CreateConfirmation {Template=$Template; Note=$Note}
    - end returns $Note
```

- `MF` microflow, `NF` nanoflow, `PG` page. `#5c0e7d21` is the fingerprint —
  copy it into the description's `"hash"`.
- Steps run top to bottom. The number is the step's number in MxScout's
  documentation. Indentation is nesting: the branches of an `if`, the body of
  a `for each` / `while`, an `on error:` path.
- `{member=value; …}` is the data a step sets (create, change) or passes (a
  call, a page). `member add value` / `member remove value` for list members.
  Values are Mendix expressions, cut at 200 characters with `…`.
- `↪ step N` — the flow continues at a step already listed.
- `↩ back to step N` — the flow goes back up to step N and runs it again: a
  loop built from a jump rather than a `for each` / `while`.
- `(disabled)` — Studio Pro skips that step.
- Pages carry `roles`, `in` and `from`, and then the widgets that are shown
  or editable only on a condition — nothing about the widgets that are not.

## A page's conditional widgets, and snippets

```
### PG Orders.Order_Edit #7e6f5a4b
roles: Clerk, Manager
in: Order: Orders.Order
from: microflow ACT_OpenOrder
  shows Cancel order (button) — when $Order/Status = Orders.ENUM_OrderStatus.Placed
  shows Refunds (tab) — for roles Orders.Manager · holds Refund, Amount, Reason
  shows Discount (text box) in Lines (list view) — when Orders.Order.HasDiscount is true
  shows Approve (button) — when $currentObject/Total > 1000; for roles Orders.Manager
  editable Number (text box) — never
  editable Status (drop-down) — when Orders.Order.Status is Draft or Placed
  editable Delivery (data view) — when $Order/Shipped = false (and the inputs inside it)
  read-only DeliveryDate (date picker) — inside History (list view), which is not editable
  places Orders.AddressBlock (snippet) — see SN Orders.AddressBlock

### SN Orders.AddressBlock
on pages: Order_Edit, Customer_Edit
  shows Country (combo box) — when $Address/IsAbroad
```

Under a page, indented by two spaces, one line per condition, in the order
the widgets are on the page (`grep -n "shows Cancel"`, `grep -n "editable Status"`):

- `shows <widget> (<kind>) — …` — the widget is visible only when the
  condition holds: `when <expression>` (the Mendix expression as the model
  has it, cut at 300 characters with `…`), `when <attribute> is <value> or
  <value>` (visible on an attribute's value — an enumeration value's name,
  or `true` / `false`; `$Param/` before it when it is not the object in
  context), and `for roles <module role>, …` (visible only to users with one
  of those module roles; the header's `roles:` line says which user roles
  carry them). Two of them, separated by `;`, must both hold. A widget that
  holds others ends in `· holds …` — the buttons and fields inside it, hidden
  with it (eight at most, then `+N`). **A widget with no line of its own is
  still hidden when one around it is** — find the button in the `holds` of
  the lines above it.
- `editable <widget> (<kind>) — never` — an input that only shows its value.
  `— when …` — editable only on that condition (same forms as above). A data
  view editable only on a condition says so `(and the inputs inside it)`; an
  input in it with no condition of its own carries the same condition
  `(from <data view>)`.
- `read-only <widget> (<kind>) — inside <data view or list view>, which is
  not editable` — the input is editable itself, but the data view or list
  view around it is not, so it only shows its value. (A list view is not
  editable unless set to be, so this is common in lists.)
- `places <snippet> (snippet) — see SN <snippet>` — the page places a
  snippet whose own widgets have such lines; they are under that snippet's
  `### SN` block, once, not on every page that places it. When the page
  places it inside a data view that is not editable, the line says so, and
  then none of the snippet's inputs are editable there.

`<widget>` is the widget's caption — a label, a button's caption, a tab's —
or, without one, the attribute an input shows, or the widget's name in Studio
Pro (`container3`). A text widget's caption is its text, with `{Attribute}`
where a value goes. A row of a layout grid is `row 2 of <grid>`. When two
lines would name the same widget, the place it is in follows: `in <data view,
list view or tab> (<kind>)`.

At most 200 lines a page or a snippet, then `… N more widgets shown or
editable on a condition`. These lines are **not** part of the page's
fingerprint: they were added without moving any.

`### SN Module.Snippet` — a snippet whose widgets are shown or editable on a
condition, in its module's section after the pages, with `on pages:` the
pages that place it (six, then `+N`). It has no fingerprint and nothing is
described for it; it is there to be read with the pages that place it.

**For "I can't see …" and "I can't edit …":** find the page, then `grep` its
block for `shows`, `editable`, `read-only` and the widget's caption — and the
`### SN` blocks of the snippets it `places`. A button that has no line and is
not in any `holds` is shown to everyone who can open the page (the page's
`roles:`); then the cause is elsewhere — the access rules on the entity
(`access` lines: a member a role may not write is read-only to it whatever the
page says), the data, or a condition in a flow.
