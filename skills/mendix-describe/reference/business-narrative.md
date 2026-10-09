# The business narrative

One definition of the business layer of a Mendix application's
documentation, used the same way by two tools: MxScout (this skill,
mendix-describe) and the mendix-docs skill (its document 01). If you change
it, change both copies. The canonical copy is
`skills/mendix-describe/reference/business-narrative.md` in the MxScout
repository. The copy in mendix-docs is
`workspace/docs/_szablony/business-narrative.md`, kept identical.

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
| The application | 2–4 sentences | 4–10 paragraphs, about 400–1,200 words |
| Each main process (3–8 of them) | 1–3 sentences | 2–6 paragraphs, about 150–500 words |
| Each module | 1–3 sentences | 2–6 paragraphs, about 150–600 words |

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
  renderer shows this text as text. The one exception is mendix-docs, where a
  section of document 01 may add its diagram or table after the prose (see
  the end of this file).
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

## Where each tool keeps them

**MxScout** (the descriptions file, `reference/descriptions-format.md`):
`app.summary` and `app.story`; `summary` and `story` on each entry of
`app.processes`; and for each module `{ "summary": …, "story": … }` in
`modules`. A story is one string, paragraphs separated by a blank line.

**mendix-docs** (document 01, Markdown): each section opens with the
`> **W skrócie:**` block (or `> **In short:**` in English), and that block is
the summary: one paragraph of two to four sentences, not bullets. Everything
after it in the section is the description, which the portal folds into the
accordion. Diagrams and tables a section needs go after the description's
prose, inside the same fold.
