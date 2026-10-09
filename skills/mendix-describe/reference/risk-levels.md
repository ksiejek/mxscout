# Risk levels P1–P3

One definition, used the same way by two tools. Change both copies together:

- MxScout: `skills/mendix-describe/reference/risk-levels.md` (this copy is
  canonical);
- mendix-docs: `workspace/docs/_szablony/risk-levels.md`.

A risk is something in the model that can hurt the people using the
application or the people changing it. Its level says **how soon it should be
fixed**, judged by the worst consequence the model shows. Not by how much code
is involved, how often it repeats, or how untidy it looks.

## P1: security and data

Fix before the next release.

Someone can see, change or delete data they should not, data can be lost or
left half-written, or a secret is exposed.

- An entity access rule lets a role read every row, while every page and flow
  that role reaches shows only its own rows. The narrowing lives in the pages,
  not in the rule, so the client can still fetch the rest.
- A microflow the client can call changes or deletes records without checking
  who calls it, or what the record belongs to.
- A password, token or API key is the default value of a constant, or sits in
  an expression.
- A delete or a bulk change runs with no check of who may do it.

## P2: functional errors

Fix in one of the next releases.

A process gives a wrong result, or stops, in a case the model shows can happen.

- A REST, OData or web service call has no error handler.
- A flow fails for a role that can start it, because it reads an entity that
  role cannot read.
- A commit sits inside a loop. It is slow, and a failure halfway leaves part of
  the records changed.
- A process depends on a scheduled event that is disabled in the model. It may
  be enabled in the environment, so say that it is to be confirmed.
- A page validates a value, but the microflow that saves it does not.

## P3: maintenance

Fix when you next work on that part of the application.

Nothing goes wrong for a user today, but every change is slower or riskier.

- Dead code: flows and pages nothing reaches, and duplicates (`_New`, `_Old`,
  copies, spikes).
- Values that belong in a constant or in configuration are written into flows.
- Disabled steps are left in a flow.
- Names break the module's own conventions, or are misspelt.

## Calibrating

1. **The worst realistic consequence the model shows decides.** How many places
   it appears in goes into the description, not into the level.
2. **Only what the model shows.** Some risks depend on what the model cannot
   show: environment settings, who calls an API, how a scheduled event is set in
   the cloud. Such a risk is at most P2, and it says what has to be confirmed.
3. **Between two levels, take the lower one**, and say why in one sentence. A
   list with too many P1s reads as noise, and the real P1 gets lost in it.
4. **One risk per cause.** Ten flows with the same missing error handler are
   one risk with ten places, not ten risks.
5. **Every risk says where and what to do.** It names the qualified name of each
   flow, page or entity it is in, and gives the fix in one sentence.

## Where each tool writes it

- **MxScout:** `risks` in the descriptions file (`descriptions-format.md`).
  The Documentation shows them on a Risks page, grouped by level, marked ✦ AI.
- **mendix-docs:** in document 02 §10, a `**P1 – …**` heading with a table under
  each level, and in the module notes, section 12.
