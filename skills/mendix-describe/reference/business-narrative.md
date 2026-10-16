# The business narrative

One definition of the business layer of a Mendix application's
documentation, used by both skills that write it: mendix-describe (with
MxScout) and mendix-docs (from the .mpr alone). The canonical copy is in
MxScout, `skills/mendix-describe/reference/`; edit it there. The skills
repository carries a copy of it, brought up to date from there, and mendix-docs gets the public MxScout's copy when its
installable copy is put together (`pack-skill.js`).

## Why it exists

The documentation used to read well at a glance and say little: short, bold,
tile-sized fragments, written to be complete rather than to be read. The
person who takes over an application, or the business owner who has to
decide about it, needs the opposite underneath: real prose that explains what
the application does and why. So every piece of the business layer comes in
two layers, written separately, for two different moments of reading.

## Two layers, always both

**Summary.** Two to four sentences of plain prose: what this is, who it is
for, what it achieves. It is always visible and must stand on its own. A
reader who stops here should still know what this part of the application is
for. No bullets, no bold, no list of features.

**Description.** The long version, below the summary, folded in an accordion
that opens on "Read the full description". Several paragraphs of business
prose that a person new to the application can learn from:

- what it is for, and what would go wrong for the business without it;
- who works with it, in which role, and when;
- how a typical case goes from start to finish, told as what happens to the
  case, not as a list of screens or microflows;
- the edges a business reader cares about: what can be refused, what has a
  deadline, what happens when something fails, what needs someone's approval;
- how it connects to the rest of the application and to other systems;
- what the model does not make clear. Say so, plainly: "Whether X is used in
  practice cannot be told from the model."

There is no short mode. Both layers are written every time: the summary is
what makes the documentation quick to scan, the description is what makes it
worth having.

## Where the two layers apply

| Part | Summary | Description |
|---|---|---|
| The application | 2–4 sentences | several paragraphs: what it is for, who works in it, how a case goes through it, what it connects to |
| Each main process (as many as the application has) | 1–3 sentences | a few short paragraphs, one case stage by stage |
| Each module | 1–3 sentences | a few paragraphs: what it holds, what it does for whom, what it hands to other modules |

**When a story is complete.** A description is done when it says what its
reader needs, not when it reaches a length: a simple process is told in a few
short paragraphs, a long one with many ways takes more, and neither is padded.
For a process (and how a change works now) that is: where the case starts and
who starts it; what is checked and decided, and on what data; what is recorded
or sent, and to whom; who approves or can refuse; what has a deadline; what
happens when something fails; how it ends — each with the real names of the
statuses, roles, messages and records looked up by name. For the application:
what it is for, who works in it, how a case goes through it and what it
connects to. For a module: what it holds, what it does and for whom, and what
it hands to other modules. Then stop. The checker warns only when a story is
clearly too thin to say that — under about 150 words for the application, 80
for a process or for how a change works now — never because a complete one is
short.

**A process** is the one place where more detail beats more words. Its
description follows one case from start to end, a paragraph a stage: who
starts it and how, what the application checks, records or sends at each
stage, who has to approve it or can refuse it, what has a deadline, what
happens when something fails, and how it ends. Concrete, not an essay:
name the status a case moves to, the role that acts, the message that goes
out, rather than what the process means to the business in general. Its
steps are one sentence each, naming who does what — as many as the case
has: "A clerk takes the order from the region's queue", not "Assignment".

**A diagram, when the process branches.** Decide for each process. When the
case can go different ways — a decision that sends it elsewhere, rules tried in
turn until one fits, a refusal or a failure that ends it early — draw a
simplified diagram (`diagram`, see `descriptions-format.md`): the business
steps, the decisions with their ways, the ends. How an order finds its warehouse is
such a process; a straight sequence is not — its steps already say it, so
leave the diagram out. Keep it simplified: the decisions a business reader
cares about, in their words, not every check a flow makes; one rule tried in
turn is a chain of decisions, each with its way out ("found") that `join`s the
step all of them lead to, and the main path going on down ("not found").

**A change** (an Assist idea: mendix-describe's "A change, when the person asks", mendix-assist's "An idea") has two
stories. How it works **now** is a process story by the rules above — one case,
stage by stage, complete as above, naming statuses, roles and messages — told so
that the place where the change would go in is plain. The **proposal** says how
the case goes once the change is made, for the people who use it: what they see
and do, what the application checks and records, who is told, what happens when
it is too late or not allowed. The Mendix names belong in its list of model
changes, not in this story.

Smaller parts (one microflow, one page, one entity) keep their one or two
sentences. They are read in lists, and the documentation already shows their
steps.

## How to write each layer

- **Write the two layers separately.** First the description, from what you
  read. Then the summary, from the description. Do not write a summary and
  pad it out into a description, and do not shorten a description into a
  summary by cutting sentences.
- **Readable prose.** Full sentences, one idea per paragraph, the terms of
  the business explained the first time they appear. Warm and plain, not
  dense: this text is not a set of notes. The dense, complete notes an agent
  may write while analysing a module are source material for it, never the
  text itself.
- **Paragraphs only.** The prose of both layers is paragraphs, separated by a
  blank line. No headings, no bullet lists, no tables, no bold, no links, no
  markup of any kind. The facts that belong in a list or a table (steps,
  flows, entities, roles) are shown next to the narrative already, and a
  renderer shows this text as text.
- **Names where they help.** Mention a module, entity or flow by its Mendix
  name when a reader will want to look it up, and say in words what it is.
  Never translate an identifier.
- **Only what the model shows.** A confident wrong sentence is worse than a
  short true one: the business will act on it. When a purpose is a guess, say
  it is one ("probably", "the name suggests").
- **No secrets, no data.** No passwords, keys, hostnames, people's names or
  records. Describe; do not copy.
- **Language.** The one the person asked for. The layers follow it; Mendix
  names stay as they are.

## How the layers are shown

- **Vertically, one block under another, full width.** Never as small tiles
  or cards side by side. Each block shows its summary, then the accordion
  with the description, closed.
- **The accordion is closed by default** and says what opening it gives:
  "Read the full description".
- **Marked as written by AI** wherever the tool marks AI text.

## Where they are kept

In the descriptions file (`reference/descriptions-format.md`), the same for
both skills: `app.summary` and `app.story`; `summary` and `story` on each
entry of `app.processes`; and for each module `{ "summary": …, "story": … }`
in `modules`. A story is one string, paragraphs separated by a blank line.
