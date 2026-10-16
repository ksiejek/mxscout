# Risk levels P1–P3

One definition, used by both skills: mendix-describe and mendix-docs. The
canonical copy is in MxScout, `skills/mendix-describe/reference/`; edit it
there. The skills repository carries a copy of it, and mendix-docs gets the public MxScout's copy when its installable copy is
put together.

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

## Patterns

Besides its level, give each risk the one pattern it belongs to, as `theme`.
The Documentation's Risks page counts and filters findings by pattern, and
says so when one pattern holds most of the P1 findings. Pick by what goes
wrong, not by where:

| `theme` | Shown as | When |
|---|---|---|
| `access` | Missing access checks | a flow acts on any record without checking who calls it; a role reaches what it should not |
| `secrets` | Secrets in the model | a key, password or token is written into the model |
| `logic` | Logic and data errors | a condition or calculation gives the wrong answer in some cases |
| `silent` | Errors that vanish | a failure is caught and dropped, so nobody learns of it |
| `delete` | Deletes too much | a delete reaches further than the record it was meant for |
| `loops` | Commits in loops | objects committed one at a time inside a loop |
| `schedule` | Relies on switched-off events | work depends on a scheduled event switched off in the model |
| `dead` | Unused or duplicated | nothing reaches it, or the same logic is kept twice |
| `hardcoded` | Values written into flows | a value belongs in a constant or in configuration |
| `naming` | Names and messages | a name or a message misleads whoever reads it |

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
6. **A risk keeps its id.** The same risk carries the same `id` on every
   update, so whoever works through the list — marking one fixed, or a false
   positive with the reason — finds their decision still on it next time. A
   risk marked a false positive is not raised again unless the model changed
   so the reason no longer holds (mendix-describe, "Risk triage").

## Where each tool writes it

`risks` in the descriptions file (`descriptions-format.md`), the same for both
skills. The documentation — MxScout's, or the report mendix-docs builds —
shows them on a Risks page, filtered by level, pattern (`theme`, one of the
ten keys in `descriptions-format.md`) and module, each saying an agent wrote
it.
