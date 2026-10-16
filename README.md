# MxScout

MxScout reads, reviews and documents a Mendix application from its model —
the documentation, the AI descriptions, Assist, the solved cases — for every
project. Per project, a switch on its **Settings**, **Developer tools**, adds
what works with a running application: the **Live app** (reading its data,
running a microflow), **Performance**, **Logs**, **Comments** with their
review report, deciding about risks, MxScaffold drawings and the **Security**
screen. View as, which narrows Entities, Microflows, Nanoflows and Pages to one role,
works without them. Off by default; off, none of it is shown, and nothing it kept is
deleted.

MxScout is a local app that helps you understand, document and test a Mendix
application. Point it at a project and it shows you what a given user role
can actually see and do — which entities, which fields, which microflows —
and, with Developer tools on, lets you try a flow against a real, running app,
without touching a database or writing any code.

It runs as a small Node.js server on your own machine and shows its UI in your
browser. Nothing is installed system-wide, nothing is sent anywhere, and the
server writes nothing to disk — what you keep stays in the browser, or in a
folder you choose.

It is built to run on a **company machine, inside a company network**, which
sets the bar for everything in it: only safe, non-invasive mechanisms, so a
security team has nothing to object to. No npm dependencies at all, no
installer, no administrator rights, no background service, nothing written to
disk by the server, no telemetry, no CDN, and a listener bound to loopback only. The server
opens exactly one kind of outbound connection — to the admin port of the app
under test, at an address that passed the same non-production guard as the app
itself, asking two read-only actions: once when you connect a performance
recording, to check its password against that port, and then while that
recording runs. A feature that cannot be built inside those limits does not get
built.

**About & security**, under **Help** at the foot of the sidebar, is the page that explains all of it — the
technology inventory, every endpoint, where data lives, what MxScout refuses to
do, and the honest limits of each guard. It is written to be handed to a
security reviewer, and it prints to PDF if they want it as an attachment.

On the projects screen, **Getting started** walks through a project's life in MxScout in
six steps — import, browse as a role, open an object, connect to a running
app, run a flow, then write it up and send it — against a fictional app, so it
needs no project of your own open to make sense. Steps three to five, and the
review in the sixth, are Developer tools, and the guide says so on each.

**Log analysis** is a Developer tool. It appears in the sidebar once a project
has Developer tools on, and is a second job MxScout does without any
project open — and, when one is, a section of that project: reading a Mendix
application's log in one viewer — the stream with its filters, Insights, and
the slow queries the runtime reported — against its model. A warning that names a microflow opens that
microflow, and one click turns it into a comment on it. It is the work of
Mikołaj (RealMecowhy), [MxDevSwissTool](https://github.com/RealMecowhy/MxDevSwissTool),
used under its MIT licence — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Two things keep it that safe to point at a real project:

- **The model is read, never queried.** Point MxScout at the project folder
  and it reads the `.mpr` file itself — decoding the SQLite pages and the BSON
  documents Mendix stores inside them, entirely in the browser, in a Web
  Worker. No Studio Pro, no CLI tool, and no server in between; the model
  never even reaches MxScout's own Node process. A model already exported as
  JSON works too, if you have one.
- **No database connection, ever.** MxScout never talks to Postgres, never
  holds credentials, and never reaches out to any host on its own. The only
  data it ever sees is what you point it at, or what your own already
  logged-in browser session reads back from an app you choose to connect to.

## Running it

**Double-click a launcher in this folder** — `MxScout.cmd` on Windows,
`MxScout.command` on macOS. A console window opens, MxScout starts, and your
browser opens on it by itself. Closing that window stops MxScout; double-click
again when a copy is already running and it just opens the browser instead of
starting a second one. Neither launcher installs anything — they only run
Node.js on the files already in this folder.

From a terminal, on any system:

```sh
./start.sh
```

Either way the address is http://127.0.0.1:4289 (override the port with
`MXSCOUT_PORT`). The browser keeps projects per address, so a project made on
one port is not listed on another: start on the same port to see it, or move
it once through a project folder or a package.

Both need **Node.js** on the machine — MxScout has no dependencies of its own,
but it is a Node program. If it is missing, the launcher says so and offers two
ways out: install Node.js normally from https://nodejs.org, or let MxScout put
a copy in its own folder. The second one downloads the official Node build from
nodejs.org into `runtime/` **only after you type yes** — no installer, no
administrator rights, nothing outside the MxScout folder touched, and deleting
`runtime/` undoes it. A launcher that finds `runtime/` uses it in preference to
the machine's own Node, so a folder that has been given a runtime once can be
copied to a machine that has none.

That download is the only thing MxScout ever writes outside the browser, and it
happens in the launcher — the server process still writes nothing. **About &
security** says so in those words, and spells out the one outbound connection
the performance recorder makes and what bounds it.

## Projects

The first screen is the projects page — where MxScout opens, and where its
logo leads. A card for each project says, in words, **where it is kept**:
*this browser only*, *a folder of its own*, *your MxScout folder*, or *in its
Mendix project* (`mxscout/`), and what that means for Claude — `/mxscout-project
<name>` from anywhere for one in your MxScout folder, Claude started in the
Mendix project folder for one kept there. Its actions are behind its ⋯; the
page's own (Open a project folder…, Export documentation…, Move all projects
to folders…, Settings) behind the header's. Until the MxScout folder and the
default language are chosen, **Set up MxScout once** asks for both. A
**project** is a name plus one model JSON:

- **New project** — name it, choose **where to keep it** — inside the Mendix
  project, in `mxscout/` (first, recommended for a team: see "Working as a
  team through your app's git" below), a folder on disk, or this browser only
  — then pick (or drag in) the
  exported JSON, the Mendix project folder, or a `.mxscout` package someone
  sent you (a package opened as a new project offers the folder first too,
  and is written into it at once — model, descriptions, comments and risk
  decisions).
- **Open a project folder…** — a folder that already holds an MxScout project,
  checked out from git or copied from another machine, becomes a project in
  this browser: no package, no access code. When this browser already has that
  project, MxScout asks whether to link it to the folder or open the folder as
  a new project.
- **Keep in a folder…** (in a project's ⋯ menu) and **Move all projects to
  folders…** (on the projects page: one folder picked, a folder of its own
  inside it for each project, a project linked only once all of it is written)
  — for projects that are in this browser only.
- **Rename…** — give the project another name; nothing else about it changes.
- **Replace model** — load a newer model, or a package someone sent back to
  you, keeping the project. From a folder or a file it first lists the objects
  added and removed, by name — and says that changes inside an object that
  kept its name are not compared there. The model is overwritten; comments merge by id,
  newest write wins, so a package that has been round-tripped does not lose
  either side's findings; the package's descriptions are taken only when the
  project has none or older ones. A package first says whether it is newer,
  older or the same version as yours, and asks before an older one replaces
  your model.
- **Package…** — encrypt the project (model, the descriptions an AI agent
  wrote for it, and optionally its comments) into
  a `<project-name>-<date>.mxscout` file for someone else, with a generated
  access code shown once. Send the file and the code by different channels.
  The dialog says which version of the app it packs; whoever opened a package
  of this project before opens the next one without the code.
- **Delete** — remove the project, its model and everything kept with it —
  descriptions, comments, Assist items — from this browser.

### A project kept in a folder

The recommended way: a folder you pick — beside the Mendix project, in a git
repository, anywhere — holds the project as plain files, written by **the
browser tab** through the File System Access API (Chrome and Edge). The server
is not involved and still writes nothing to disk.

```
project.json        name, source, the model's version (git), the version the descriptions describe, settings (the language of written content among them), MxScout and layout version
model.json          the model as read from the .mpr
descriptions.json   the descriptions, as a descriptions file
assist/             the Assist items, one file per item: tickets/, jira/, ideas/, other/ (the workbook)
knowledge/          the solved cases, one Markdown note per case (below)
documentation.md    the documentation as Markdown — what an agent reads first
ai-pack.md          the AI pack — what an agent checks against, by module
comments.json       the comments on the model, as a package carries them (merged by id when read back)
triage.json         what was decided about the risks
inbox/              an agent drops a descriptions or an Assist file, or a case note, here; MxScout takes it
inbox/done/         the files it took (the last 20)
README.md           what each file is, for a person and an agent
```

Every save in the app rewrites the file it changed; documentation.md and
ai-pack.md follow the descriptions and the model. While the project is open,
MxScout reads `inbox/` every two seconds and takes a file the way it takes
what comes through the agent channel: saved at once with Undo, or — a whole
file that would replace the descriptions — waiting for **Import them**. When a
project is opened, a file someone else changed in the folder since MxScout
last wrote it (an agent, git, a person) wins; the descriptions are taken with
Undo. For the project's own settings in `project.json` (and `mxscout.json`
inside the Mendix project) — its name, its language of written content — a
setting is taken from the file only when the file changed it: one you just
changed here, not written yet, is never undone by the file's older value
(`test/96-language-choice.test.js`). After a browser restart the browser may need your permission to write
the folder again: **Reconnect the folder** appears in the header. Until then,
and whenever the folder cannot be written, MxScout keeps working in the
browser and writes the folder when it is back — nothing is lost. The browser
tells MxScout the folder's name, never its path; Documentation → Write with Claude (its Details) lets
you type the path once, for the line you paste to an agent. Deleting a project
never deletes its folder.

### Working as a team through your app's git

MxScout's files can live **inside the Mendix project** — the app's own git
repository — in a folder named `mxscout/`, so a team shares the documentation
through the git it already uses. Choose **In the Mendix project (mxscout/)** on
New project (the first option) and pick the Mendix project folder; the browser
asks you to let the page edit that folder — the narrowest grant it offers, as
`mxscout/` may not be there yet. MxScout writes only inside `mxscout/` (and,
when you choose it, the two Claude skills in `.claude/skills/` — below): the `.mpr`, `mprcontents/`, `.git`,
`javasource/` and everything else are only read. **MxScout never runs git and
never connects to a git server** — you commit, pull and push yourself, in
Studio Pro or a git client.

```
<MendixProject>/
  OrderPortal.mpr, .git, javasource/ …
  mxscout/
    mxscout.json      the project's id, name, language of written content, layout,
                      and the commit the descriptions describe (describedAt)
    descriptions/     the descriptions in small files: app.json, processes/<name>.json,
                      modules/<Module>.json, risks.json, c4.json, context.json
    docs/             the documentation as Markdown, one file per topic — index.md (the map),
                      app.md, processes/, modules/, risks.md, architecture.md, quality.md,
                      developers.md — each with front matter (app, kind, name, module, the
                      commit described, source, a stable id), and manifest.json (each file's
                      id, kind and SHA-256)
    comments/         (Developer tools) the comments on the model, one file per comment
    triage.json       (Developer tools) what was decided about the risks
    knowledge/        the solved cases: one Markdown note per ticket, Jira issue or idea solved
                      with an agent, with front matter — committed with the fix (below)
    AGENTS.md         how any AI agent should read this folder
    README.md         what this folder is, and the workflow below
    GUIDE.md          the team's guide (as this MxScout ships it in public/guide-team.md)
    GUIDE.html        the same guide as one page to open in a browser (public/guide-team.html)
    .gitignore        ignores .local/
    .local/           this machine only, never committed: model.json (a cache — the .mpr
                      is the truth), documentation.md, ai-pack.md, inbox/, assist/
  .claude/skills/
    mendix-describe/  the Claude skills, when you choose it (the default): Claude Code loads
    mendix-assist/    them from here, so whoever pulls has them — no MxScout needed
```

**A project already in MxScout** — kept in this browser only, or in a folder
of its own — moves there with **Keep in the Mendix project (mxscout/)…**, in
the project's menu and on Documentation → Write with Claude. Pick the Mendix project
folder (the one with the `.mpr`; a folder without one is refused and nothing
changes), with the same tick for the Claude skills as on New project. With no
project in `mxscout/` yet, everything the project has is written there — the
descriptions, `docs/`, `knowledge/`, `comments/`, `triage.json`, your Assist
items into `.local/assist/` —
and the project is linked to it only once every file is written; a folder it
was kept in before is left on disk as it was, for you to delete. When
`mxscout/` already holds this same project, it is linked to it, and what
`mxscout/` holds wins (the descriptions with Undo; the comments and what was
decided about the risks merged by their own rules). When it holds **another**
project — a teammate set the app up from a project of their own — MxScout does
not write over it: it asks, and **Use theirs** opens their project here while
yours stays as a separate project until you delete it. A git conflict in
`mxscout/` stops it. MxScout reads the `.mpr` and asks two separate questions.
The same application (most of the project's modules are in it)? When it looks
like another application, it says so and moves only if you choose **Move
anyway** — the model is then the `.mpr`'s. The same snapshot (the same content)?
Only then does the model take the version the Mendix project's git names. The
same modules with other content — another snapshot of the same application —
keep this browser's model with its own version, never under the `.mpr`'s
commit; the status line says the `.mpr` beside is another snapshot, and
**Re-read** takes it. **Move all projects to
folders…** still makes standalone folders. `test/93-move-to-repo.test.js`
covers each of these.

**The Claude skills come with the repository.** On New project, "Add the
Claude skills to this project (.claude/skills) — teammates get them with the
next pull" is ticked by default; the project's Settings has the same switch and
**Update the skills in this project**. MxScout writes the two skills it ships,
whole, into `.claude/skills/mendix-describe/` and `.claude/skills/mendix-assist/`
— the one place outside `mxscout/` it writes, and nothing else in `.claude/`
(never `settings.json`, never another skill). The browser reads them from this
server (`GET /api/skills`, a fixed allowlist of the files in `skills/`,
read-only). Teammates without MxScout just ask Claude: "use mendix-describe on
mxscout/", or `/mendix-assist`. Each skill's `VERSION`, like the first line of
`README.md`, `AGENTS.md`, `GUIDE.md` and `GUIDE.html` (on its second line, after
`<!doctype html>`, so it stays a valid page), names the MxScout that wrote it; only a
newer MxScout replaces them — never a downgrade, and the same version writes
nothing.

Committed: everything but `.local/` — with Developer tools, the comments and what
was decided about the risks too: they are the team's knowledge, merged by id
(a comment) and per risk (a decision), the newest winning, when they are read
back. A comment a teammate deleted — its file gone from `comments/` after a
pull — is deleted here too, unless you changed it since; then it stays and is
written back. Performance recordings stay in the browser. Your **Assist** items stay in
`.local/assist/` — each person has their own — and the package key never goes
into `mxscout/`. The committed part is readable without MxScout: an agent
starts at `AGENTS.md` and `docs/index.md`. Add one line to the repository's own
`AGENTS.md` (Codex reads the root one) or `CLAUDE.md` pointing at
`mxscout/AGENTS.md` if you want every agent in the repository to find it —
MxScout does not write outside `mxscout/`. `mxscout/AGENTS.md` and
`mxscout/README.md` suggest that line, and tell an agent that does not load
skills by itself (Codex, for one) which `SKILL.md` in `.claude/skills/` to read
and follow.
`docs/`, `knowledge/` and `docs/manifest.json` are also what a company pipeline
could ingest (a wiki, a search index): every file has front matter, and the
manifest gives each one — the case notes included — its id and SHA-256, so a
pipeline uploads only what changed. MxScout itself uploads nothing: the
committed files are the ingest source.

**No churn.** A shared file is written only when its text changes, and `docs/`
only when the descriptions change — never because the model was read again
after a pull. A teammate who only pulls finds git's status clean.

The workflow:

1. **Pull**, in Studio Pro or git.
2. **Check the status.** Documentation shows one line: "Model main @ f00ba12 ·
   descriptions a1b2c3d (3 flows changed since)", or "Descriptions describe
   this version — up to date". When the `.mpr` changed (its size, its date, or
   the commit HEAD names), MxScout reads the model again when the project is
   opened, and when you press **Re-read**.
3. **One person updates the descriptions** with an agent (the mendix-describe
   skill). It writes them straight into `descriptions/`, or hands them to
   `.local/inbox/`; while the project is open, MxScout takes them within
   seconds, newer files winning, with Undo, and writes `docs/`.
4. **Commit `mxscout/` on its own**, as "Update documentation", and push.
5. **The others pull.** Picking the Mendix project on New project in a browser
   that does not have the project yet links it at once — the model from the
   `.mpr`, the descriptions from `mxscout/` — no package, no code, no import
   step.

**A git conflict.** When two people updated the descriptions at once, a JSON
file in `mxscout/` has git's conflict markers. MxScout does not fail and does
not overwrite it: Documentation shows the file with both sides — yours and
theirs — and **Use yours** / **Use theirs** for each; or resolve it in git and
press Re-read. Until then it neither takes nor writes the descriptions. Then
stage the file (`git add`) to finish the merge. `docs/` is made from the
descriptions: after a conflict there, MxScout writes it again.

Whether Studio Pro's commit dialog picks up new files outside the model is
**not verified**. If it does not, commit `mxscout/` with a git client.

**Without MxScout.** Most people may work with Claude alone and never open
MxScout. The two skills in `.claude/skills/` carry what they need:
mendix-describe's `agent.js` reads the `.mpr` beside `mxscout/` with MxScout's
own engine (byte-identical copies of `public/` files in its `engine/`, checked
by the suite), so `node agent.js write …` puts new descriptions into
`descriptions/` and brings `docs/` up to date itself — the same files, byte
for byte, MxScout writes; `node agent.js update-docs` does that step alone, and
writes nothing when `docs/manifest.json` says `docs/` is current and every file
it lists is there with its SHA-256 (a missing or changed one is reported;
`--repair` writes it again, `verify-docs` only checks). Every command reads the
model as it is now: the pack is made from the `.mpr` (and `mprcontents/`) and
kept in the work folder under a stamp of the model — the `.mpr`'s content, the
`mprcontents/` files with their sizes and times, HEAD, the engine's version,
and here the descriptions and `triage.json` its risk triage is made from — and
made again when it changes, so a pull or a fresh clone with no `.local/` needs
nothing else; each command says which snapshot it used. `write`, `send` and
`case` check the file first — format and version, schema, every name against
that model (another project's name is a warning) — and write nothing on an
error; inside the Mendix project
`write` lays the file over the descriptions there (`--replace` to make it the
whole), makes `docs/` with it, and puts it all in place only when all of it
could be made, keeping what it replaced in the work folder; `--dry-run` shows
the plan. The skills in `.claude/skills/` come to about 1 MB, the engine most of it.

**The project stays clean.** In the Mendix project the skills write only the
documentation: `agent.js` writes `mxscout/descriptions/`, `docs/`,
`knowledge/` (`agent.js case`, a solved case's note), `mxscout.json` and
`.local/inbox/`, and refuses any other path inside the project — in a project
folder of its own, anything but `inbox/` and `knowledge/`. Everything an
agent makes while it works — the pack it greps (and the pack `agent.js` makes
from the `.mpr`), its notes, drafts, the descriptions or an Assist item before
they are sent, a copy of the files `agent.js` replaced — goes into a work folder
outside the project, which `node agent.js workdir` prints: `$MXSCOUT_WORK`
when set, else `mxscout-work/<project>` in the system's temporary folder
(`/var/folders/…/T/` on macOS, `%TEMP%` on Windows). A file named without a
path (`--out docs.md`, `pack pack.md`, `send descriptions.json`) is in it, and
`agent.js` prints the full path of every file it writes. Both skills say it
first, as a rule, and `mxscout/AGENTS.md` says it to any agent.

### Solved cases

When a ticket, a Jira issue or an idea is **solved** — with MxScout open or in a
conversation with Claude alone — a trace stays behind that any agent on another
machine can use: **one Markdown note per case** in `mxscout/knowledge/`
(`knowledge/` of a project folder), `<id>-<slug>.md`, with front matter (id,
kind, title, status, the date it was solved, the commit it was checked against,
the flows, entities and pages it is about, keywords, related cases, the
language, the flows' fingerprints) and five sections: Problem, Cause, Solution,
What did not work, How to recognise it next time. The mendix-assist skill
writes it **itself**, without asking, when it judges the case solved (or when
you say "add it to the documentation" / "dołóż to do dokumentacji"), and tells
you where: "I recorded case SD-4711 in mxscout/knowledge/ — commit it with the
fix." **The commit is the approval.** Before it works a new item out, it
searches `knowledge/` first and cites a similar case by its id. A note never
holds personal data — no names, e-mail addresses, phone numbers, customer data
or record ids from production; the skill's checker refuses one that does, and
so does MxScout. The format is
[`skills/mendix-assist/reference/knowledge-format.md`](skills/mendix-assist/reference/knowledge-format.md).

In MxScout, **Solved cases** (under Review, after Assist) lists them in one
list beside the page — a search, a dropdown of the kinds — and opens one as text, with the flows and pages it names
linked, and **may be out of date** when one of them changed since the case was
solved (its fingerprint moved) or is gone. An Assist item whose solution is a
case shows **In the documentation**, linking to it. MxScout records no case
itself; an agent that cannot write the folder hands its note over — the `.md`
file in the inbox, or `{ "format": "mxscout-knowledge", … }` through the agent
channel — and MxScout writes it into `knowledge/`, with Undo. `docs/index.md`
lists the cases (id, title, the problem in a line, the path) and
`docs/manifest.json` names each with its SHA-256. The cases travel in a
`.mxscout` package, and are in the exported documentation only when you tick
**Include solved cases** on Export.

### Which version of the app a model is

When the Mendix project folder you pick has a `.git`, MxScout reads which
version of the application it is — the branch, the commit, the commit's date
and the first line of its message — straight from the files in `.git`, in the
browser: `HEAD`, the branch's ref (or `packed-refs`), the commit itself when
git keeps it loose, and the end of the reflog (`logs/HEAD`). No git program
runs, no git server is asked, nothing in `.git` is written, and no name or
e-mail is kept. It reads as **main @ a1b2c3d · 14 Oct 2026 · “Fix order
status”** — when you pick the folder, on the Overview, in Settings, at the top
of Documentation, in Package…, and in `project.json`, `documentation.md` and
the AI pack, so an agent sees it too. A worktree (whose `.git` is a file
pointing elsewhere), a folder without `.git`, or a `.mpr` picked on its own
gives a model whose version is unknown, and says why.

Descriptions are stamped with the version of the model they were saved
against. When the model moves on, Documentation says so — "Descriptions
describe a1b2c3d (10 Oct 2026); the model is now f00ba12 — 3 described flows
changed since · 2 commits: …" — the commits read from the reflog, and the same
lines are in `documentation.md`'s header for the agent that brings them up to
date.

### The browser's own database

Every project also lives in the browser's own database (**IndexedDB**) on
this machine — the only place, for a project kept in this browser only, and
the copy MxScout always has for one kept in a folder. It also keeps each
folder's handle (what lets the tab write it again after a reload). Consequences
worth knowing:

- Clearing site data for `127.0.0.1:4289` deletes every project from the
  browser. A project kept in a folder comes back with **Open a project
  folder…**; for one that is not, use **Export** or **Package…** to keep a copy.
- Browser-only projects are per-browser and per-profile; they do not follow
  you to another machine. A folder does, as any folder does. A performance
  recording stays in the browser: it came from a running app.
- MxScout asks the browser not to evict that database
  (`navigator.storage.persist()`). Browsers answer that request differently
  and may decline it, which is why exporting still matters.
- Two tabs of MxScout share it safely. A save reads the record as the database
  holds it at that moment and writes it in the same transaction, with a
  revision number, so one tab never writes its older copy over what the other
  saved (Assist items, solved cases, descriptions, what was decided about the
  risks; a comment changed in another tab since is not saved over, and that
  is said); the other tabs are told which record moved — a `BroadcastChannel`,
  this address and this browser only, carrying no data — and read it again.
  `test/97-two-tabs.test.js` covers it.

Earlier versions kept projects in `localStorage`. They are moved across
automatically the first time this version runs — copied and verified before
anything is removed — and the move is reported on screen. Every persistent
read and write lives in `public/store.js` and nowhere else.

## Browsing a project

Open a project and the sidebar groups its views — what the application is,
the model, the running app, and the review — all driven by the stored model
(no server, no live app needed, except under Runtime):

- **Overview**, **Processes**, **Modules**, **Architecture**, and under
  Review **Risks**, **Model quality** and **For developers** — the
  documentation's pages as screens of their own: what the application is and
  who uses it, its processes, each module, how it is built, what could go
  wrong. Read from the model, with what an AI agent wrote (imported in
  Documentation) marked as the agent's; a page only an agent writes says how
  to get it until there is one. A link on any of them opens MxScout's own
  screen for what it names — a flow on the Microflows screen, an entity on the
  Domain model.
- **Assist**, under Review — what an agent helped with, counted by the items
  still open, in one list beside the page (a dropdown of the kinds, a search,
  *Open · Closed · All*) with the item open on the right. Four kinds:
  **Tickets** (a Jira issue or a user's report the
  agent checked against the model with the `mendix-assist` skill: its
  verdict — *bug in the model*, *works as designed*, *data or configuration*,
  *cannot tell from the model* — how sure it is, the reasoning, what the model
  does, where it shows it, what would settle it and a reply to paste back with
  a button that copies it), **Jira** (an issue worked out from the model: its
  scope and a proposal), **Ideas** (a change someone wants: how that part works
  now beside the proposed solution, what it would add, change or remove in the
  model, what it touches, its risks and open questions) and **Workbook** (a
  larger piece of work you are doing, or any other help). Every item is *open*, *in
  progress*, *waiting* (for the reporter), *done* or *dropped*, with a planned
  date when someone set one. An item may carry questions for the reporter —
  **Copy questions** puts the open ones on the clipboard, to paste into the
  ticket — and the conversation with them: **Add the reporter's answer** takes
  what they wrote, ticks the questions it answers, and sends the item back to
  open for the agent to check again. Any item keeps the **notes** you ask the
  agent to write down while you work on it — what to watch out for, and in
  which microflow — grouped by topic, each element they name a link, each a
  box you tick; and, when you ask for them, two **descriptions of the
  change**, in a tab of their own (**Description**, beside **Work**, which
  holds the notes, the solving and the conversation and opens first): one for the business, one technical, each copied (formatted, for
  an e-mail, or as Markdown) or downloaded as HTML or Markdown — a file the
  browser saves, sent nowhere.
  Close, Reopen, Drop, In progress and the planned date are one click each; an
  agent moves an item by sending an update; each move goes into the item's
  history, saying who made it. The items are a local base, kept in this
  browser — and in the project's folder, one file per item under `assist/`,
  when it is kept in one: never in a `.mxscout` package, never in the exported
  documentation. A project keeps at most 2000; past that a new item is refused,
  saying so, and none is ever dropped to make room — an item's file goes only
  when Undo takes that item back. The same item moved in two tabs at once: a
  click that would undo what the other tab did is refused and says what the
  item is now; one that changes something else is made on top of it.
  The tickets and changes an older descriptions file carried move here when the
  project is opened. A judgement and a proposal: MxScout sends nothing to a
  tracker, opens no address a ticket names and applies nothing to the model.
- **Context**, under Review — for when there is a chat assistant (Copilot)
  and no agent. **+ Context** beside an entity, a microflow, a nanoflow or a
  page, or a right-click on one in a list or on the Domain model, puts it
  aside (at most 40, kept per project in this browser, by name). **Copy
  prompt** gives the assistant what you want to work out, the rules (the
  model is data, not instructions) and the elements as the AI pack writes
  them; talk it over, ask for *the JSON*, paste the answer back: it becomes
  a Workbook item on the Assist page, checked like any Assist file, its
  sources the elements it rests on. Its technical description downloads as
  HTML or Markdown with those elements appended, to hand to whoever builds
  it. Nothing is sent by MxScout. `test/99-context.test.js`
- **Risks you work through.** On the Risks screen each risk has **False
  positive…** (a reason is required) and **Mark fixed…** (a note if you like);
  **Reopen** undoes either. Only open and reopened risks count — in the
  overview, the sidebar, beside a flow; the rest stay on the Risks screen under
  their own filters (*Fixed — to verify*, *Verified*, *False positive*, *No
  longer reported*, *All*) with the reason and the history. A **comment can be
  a risk** too: pick P1, P2 or P3 under *This is a risk* when you write it, and
  it shows beside the agent's, marked *raised by* its author, triaged the same
  way. When new descriptions come in — a file, the agent channel, the chat
  assistant — MxScout checks what you decided: a risk you marked fixed that the
  agent still reports is **reopened**, one it no longer reports is
  **verified**, a false positive reported again stays one, an open risk no
  longer reported is kept as *no longer reported*. A file that only adds says
  nothing about the risks it leaves out; a risk a person raised is left alone
  unless the agent answers for it (`verify`). The AI pack tells the agent what
  you decided (a `## risk triage` section), so it re-checks your fixes and does
  not raise your false positives again. The decisions live in this browser's
  database apart from the descriptions, travel in the `.mxscout` package, and
  show read-only in the exported documentation. `test/76-risk-triage.test.js`
  covers it.
- **Entities** — the **Domain model**, one module at a time, drawn as the
  exported documentation draws it: every entity in full until you click one,
  which greys the ones not linked to it (a click beside the boxes lets go),
  and beside it the entity's attributes, associations and who may read,
  write, create and delete it — *read N of M* opens that role's access
  member by member, and a row limit's XPath reads as a path. **Own** and
  **Marketplace** modules sit behind a switch. **View as** leaves only the
  entities the chosen role reaches. **Browse data** shows its rows in the connected
  app alone, with search and paging; **Add comment** starts one on it, and
  **Comments · N** — on an entity or a flow that has some — opens the Comments
  section narrowed to it. An entity's full window (attributes and access,
  data, comments) still opens from the search, Security and links elsewhere.
  A view entity — one whose rows are an OQL query's result rather than a
  table of its own — is marked as one, its window shows that query, and its
  data says the rows are served read-only.
- **Microflows**, **Nanoflows** — one flow at a time: the modules first, then
  the list of names with its triage (with risks, no callers), and the flow in
  one of two views behind a switch. **Workflow**, the default, draws it DRAKON-style
  (the main path down, the other way out leaving the node to the right), with a
  variable traced through it and, beside it, the step you click — every detail of
  its action, its members with their values — or the flow as a whole: what it takes
  and returns, who may start it, what it calls, what calls it, the entities it reads
  and writes (with the steps that do it), its risks. **Modeler** draws it as Studio
  Pro keeps it, every object where it stands, zoomable; a click on a step opens its
  window with its properties dialog, and About has the flow as a whole. A step's
  details have a button to the flow it calls or the entity it works on.
  **Run…** opens the window that runs it against a connected app.
- **Pages** — like Microflows: the modules first, then the pages, and the one
  you click **drawn as Studio Pro's page editor draws it**: its layout as a
  frame (a pop-up window, or a page with a header and a menu), every widget as
  what it is — labelled fields with the attribute's name in grey, drop-downs,
  date pickers, buttons in their Studio Pro style, tabs that switch, columns
  side by side, a list as its item and two faded repeats, snippets in place
  inside a dotted outline, and a small amber eye on whatever shows only on a
  condition. No XPath or qualified names on the drawing: the drawing takes
  the whole width and zooms and scrolls as the Modeler's does (−, +, *Fit*,
  Ctrl and the wheel). Click an element and a window over it says what it
  shows, where its data comes from, what it does and when it is visible, with
  the model's own names under *For developers* and a way to the flow or page a
  button opens. *About this page* opens who may open the page, what it takes,
  what opens it, its risks and comments. *Show structure* outlines the layout grids and
  containers. A project read before this version has nothing to draw until it
  is read again.
- **Security** — how the app is secured, as the project itself records it:
  which of the three security levels it runs at and what that means for
  everything else on screen, whether it lets anonymous visitors in and as
  which role, the demo accounts, the password policy, every user role and
  every module role. A Mendix project keeps the administrator password and
  every demo password in the file in plain text; MxScout reads them in the
  browser only to judge them against that project’s own policy, then keeps
  the verdict and drops the value — so it can tell you the administrator
  password is one character long in an app that demands twelve, without ever
  holding the password. Plus the two things a role filter cannot answer — what
  the app publishes to the outside (REST, OData, web services, each with its
  own role list and its own authentication) and what runs on a timer with
  nobody signed in. It lists no entity and no flow: entity access set
  against what uses it is told at each entity instead — a rule's "checks" on
  the Domain model open its Access window with what was found. Per user
  role, from the model alone: an entity the role may read in full where
  every page and flow it can reach shows only part of it (over an
  association, with an XPath, the object a page was given), and a rule
  nothing the role can reach uses at all; a write, create or delete right
  nothing uses; a flow a role may run that needs a right the role lacks, so it
  fails for that role; and a microflow that skips entity access doing for a
  role what its rules forbid. A page is not what protects the data, the rule
  is — this is where the two disagree.
- **Documentation** — a short header (the project, how much is described,
  what is out of date) and four tabs, one for each way to work with an agent:
  **Folder** (first, the default — where the project's files are, each with
  its role and last write, the inbox, the line to paste to an agent, the
  switch that saves what an agent sends at once, and the language of written
  content; for a project in this browser only, **Keep this project in a
  folder**), **Agent channel** (Share with an agent), **Without an agent
  tool** (Export AI pack, Import descriptions…, the chat assistant) and
  **Export** — where the project's documentation file is made: what
  it holds, previews of it drawn from this project, and the export. The file
  is the whole model as documentation, built from it each time one is loaded:
  an Overview (what the application is and its numbers at a glance, each a
  link; with an agent's descriptions also who uses it, what it talks to, its
  main processes and what needs attention), Processes (the application's
  full description, and each process with its steps, the flows that carry it
  and the risks on them), Modules (each with what it holds grouped by the
  first part of the name, which modules it uses and is used by, what it runs
  on its own, and its risks), Architecture (the context and the runtime an
  agent drew, and — read from the model — a matrix of how the modules depend
  on one another and which user roles reach which module),
  Microflows, Nanoflows and Pages (MxScout's own **Microflows screen**, carried in the
  file: every flow in its Workflow and Modeler views, the step you click with
  every detail of its action, the flow as a whole; a page with its details and what opens it; the step you picked in
  the address, so **Copy link** shares it), Entities (the Domain model, one
  module **drawn** at a time — laid out by MxScout itself, lines that run
  between the boxes and, where they can, never cross; links to other modules
  at the foot of each entity; nothing picked until you click one, the rest
  greyed then — and beside it the entity's attributes, associations and who may
  read, write, create and delete it), Risks (an agent's findings and the risks people raised in
  comments, filtered by level, pattern, module, status and who raised them, each with where it is and
  what to do — the ones marked fixed or a false positive under their own filters, with the reason, read-only), and Model quality (six
  checks read from the model, each against Mendix's own guideline, quoted). You choose
  which modules go into the file; the Marketplace ones start unticked. It looks like MxScout, dark or light:
  the same sidebar, grouped Application, Model and Review, and the same header on every page, without
  what needs the running app. It is **one
  HTML file** — the documentation, the reader's own source, the Microflows
  screen's own files and their stylesheets, nothing else — that opens in any
  browser. It is not encrypted:
  whoever has the file can read it. Built in your browser, handed to the download; the server never sees
  it and nothing is sent anywhere. Its Microflows, Nanoflows and Pages are the
  Microflows screen itself, run from the same files. The same documentation
  comes as **one Markdown file** too — for an AI tool or a wiki, the drawings
  as tables and lists, a flow with no risk, description or process as one
  line — from the section or from a button inside the HTML file itself. Inside the
  file, **Search everything** (Ctrl K) finds a module, process, flow, page,
  entity or risk by name, then any word an agent wrote about them — case and
  accents ignored — and takes you to its page. **Descriptions for the business** — what the app is for, its
  main processes and its modules, each as a short summary with a long
  description folded under it, a sentence per flow, the risks ranked P1 to P3
  notes for developers, notes on each module and the architecture — come from an AI agent outside
  MxScout: keep the project in a folder and tell an agent with the
  `mendix-describe` skill to use it ("Use the mendix-describe skill on the
  MxScout project in ~/Projects/OrderPortal/mxscout") — it reads the files
  there and drops its results into `inbox/` — or press **Share with an agent**
  and paste the line it gives, or export the **AI pack** and import the file
  it writes, if you would rather carry files. Whatever an agent writes is in
  the project's **language of written content** (Settings, or the Folder
  tab; English until one is chosen — the first agent result that names a
  language sets it), the same language every run. Every such sentence is shown as an agent's: marked ✦ AI, or
  under a line that says an agent wrote it.

Two things MxScout works out for itself from the model, rather than showing
you a list to work out yourself:

- **What a flow does, before you run it.** Open a microflow and its Run panel
  says whether it reads, creates, changes, commits or deletes, and what; if it
  calls a Java action or reaches outside the app; and if it does any of that
  inside a loop. Running a flow is the one thing in MxScout that is not
  read-only, so the panel asking you to press the button says what pressing it
  does.
- **What reaches a flow no role can trigger.** Roughly half the microflows in
  a real app have no role at all; most of them are still reached by something
  — another flow, a page's button, a scheduled event, a published REST
  operation, App Settings (after startup, before shutdown, health check). That
  is named, and a flow that genuinely nothing reaches is shown as exactly that
  — except one only Java code calls, since MxScout does not read Java.

**View the app as a role.** A dropdown at the top of Entities, Microflows,
Nanoflows and Pages switches between *Everything*, each of the project's user
roles and, when MxScout is connected, the person signed in to the app. Pick one
and the screen narrows to what that role can actually reach — entities it has
an access rule on, flows it can run, pages it can open — and the line under its
title says so ("4 of 6 microflows that Clerk may run"), with row-level (XPath)
rules shown in plain text on the entity popup. The other screens have no View
as: the documentation's pages describe the application as a whole, and the
Live app, Performance, Logs and Comments show what real sessions did. This is
the read-only picture; connecting to a live app comes next.

## Live app — connecting to a running app

*A Developer tool: turn **Developer tools** on in the project's Settings to
see the Live app, Performance, Logs, Comments and Security.*

The **Live app** tab is where MxScout reaches a running app — to read what a
logged-in user really sees, and to run a flow. It starts by asking for the
app's web address.

**Production is refused, on purpose.** MxScout only ever connects to
development, test and acceptance environments. The address you enter is
classified:

- Local hosts (`localhost`, `127.0.0.1`, `*.local`) and hosts carrying a
  dev/test/acceptance marker as a whole label (e.g. `myapp-test.mendixcloud.com`,
  `myapp-acc…`, `…-sandbox…`) are accepted.
- Anything else — a bare `*.mendixcloud.com`, a custom company domain, a LAN
  IP — is treated as production and refused. The refusal is deliberately plain
  and has no override.

This is a guardrail against mistakes, not a security control: MxScout is open
source, so a determined technical user can bypass it. Its job is to stop a
non-technical tester from pointing a read or a live run at production by
accident, and the same check is re-embedded in the generated snippet — the
place it actually runs. The suite that runs before every commit compares the
two copies of the rule, so they cannot drift apart unnoticed.

### One snippet connects the app

Once an environment is approved, MxScout gives you **one piece of code** to
paste into the app tab. It does both jobs — reading data and running a flow —
because "paste this, then paste this other thing too" is a step nobody
remembers on the second day.

1. Open the app you are testing in another tab, logged in as the role you want
   to check.
2. Open that tab's developer tools (F12) → Console.
3. Copy the code, paste it, press Enter.

A panel appears **in the middle of that page** and says, step by step, what it
is doing: which environment it checked, who you are signed in as, and whether
it could reach MxScout. Then it shrinks to a small badge and waits. Nothing
happens in that tab unless you ask for it in MxScout.

**If the app's security policy blocks the connection, it says so — and keeps
working.** Many corporate Mendix apps ship a Content-Security-Policy that
forbids the page from talking to `127.0.0.1`. When that happens the panel
tells you in words, then offers to open the object you had selected **right
there in the app tab**, in MxScout's own colours, with the same three tabs.
It is deliberately a dead end: one object, no links, no browsing. You already
have MxScout open for that.

### Reading real data — the entity popup

Open an entity and you get three tabs, in the order the questions actually
arrive:

- **Attributes & access** — every member of the entity: its attributes and the
  associations it owns, each next to who may read or write it and the row-level
  XPath rule that decides *which rows* anyone is allowed to see — one matrix,
  because "what is this" and "who can see it" are the same question asked from
  opposite ends. An association is a member like an attribute is, and an access
  rule grants read or read+write on it the same way, so it belongs in the same
  table. A rule MxScout could not follow — one whose path goes through the
  System module and keeps going, or that names something this model does not
  contain — is marked as exactly that, with the reason. It is not marked as
  broken: MxScout says what it could not check and points at the running app,
  which is the only thing that can answer — and when an app is connected,
  **Check against the app** asks it. It comes back with how many rows the
  rule's constraint really matches, next to how many rows of that entity the
  session can see at all, because zero matched means nothing on an empty table
  and everything on a full one. The rights are those of whoever is signed in
  on the app tab, and the answer says so.
- **Data** — the rows themselves.
- **Comments** — findings written against this object, kept with the line and
  paragraph breaks they were written with, see "Sending a review
  out" below.

The Data tab shows **ten rows at a time with a real total**: "1–10 of 253".
That count is a genuine query, not a guess — it is the same call the Mendix
client itself makes behind every paged data grid (`retrieve_by_xpath` with
`count: true`). Search is live as you type, searches every text field, and
recounts; typing a bare number finds that one object by its id. The id column
is highlighted because it is the one value you copy out of here.

An **enumeration** column shows the caption a user would see, not the stored
key the app answers with — a Mendix client returns `wf_in_progress`, and the
caption is a design-time translation the data layer never carries, so MxScout
supplies it from the model. The key stays on the cell: it is what comes back
from the API and what an XPath is written against. A key the model does not
declare is shown exactly as it arrived and says so, which usually means the
running app is a newer build than the model you loaded.

A value shown in **green** is one this session may **write**. That is asked of
the app per row, not per column — the application itself answers, for each
object it returned, whether each of its values is editable under this session's
rights. A rule's XPath decides which rows it covers, so the same field can be
writable on one row and read-only on the next, and the table shows exactly
that. Nothing is written to say so.

Everything is read through the app's own client API, in your own logged-in
session. The count runs against the app's own origin, so it keeps working even
when the app blocks MxScout.

### Running a flow

Open a microflow or nanoflow and it gets its own popup, built like the
entity one but with two tabs — **Run** and **Comments**:

- **Run** shows **Inputs** and **Can be triggered by** side by side: what the
  flow takes and which of those are objects, next to which module roles may
  trigger it and whether the role you are viewing as is one of them. A flow no
  role can trigger says so, rather than looking ready to go. Running it sits
  behind the same environment gate and an extra one-time acknowledgment you
  give each time you open a project (it is never remembered).
- **Comments** — findings written against this flow.

Picking an object parameter opens a picker **over** the panel — the same
ten-at-a-time pane with search and paging as the entity Data tab — rather than
an inline table, so a flow taking several object parameters asks about each
one in turn instead of being limited to the first. A confirmation then names
the exact flow and the exact object before anything happens.

A **page** gets the same popup without the running: its inputs and which roles
may open it, read-only. MxScout does not open pages in the app tab — a page
opens through the app's own navigation, with the context that navigation
carries, and there is no dependable way to do that from outside the client.

If the app blocks MxScout, the snippet you paste carries this flow *and* the
entity its object comes from, so the panel in the app tab does the same thing:
pick a row, run it, see the result — with MxScout unreachable throughout.

A read can never become a run: a data request carries no object parameters, and
nothing on the server copies them across.

Safeguards: arming is same-origin only; a command is
dispatched to the app tab exactly once (a retried poll never double-runs it);
a result for a stale/forged command id is ignored; the snippet re-checks the
production guard against its own tab. If a flow writes, deletes or sends
something, that really happens — so it is blocked on production and gated behind
the confirmation.

How it fits together: MxScout's server holds only the current session — a random
token it mints when you connect, the one request in flight, and its answer. The
snippet echoes the token back (cross-origin, so any other site's forged reply is
rejected). Rows pass through memory on their way to the MxScout window and are
replaced by the next request; nothing is written to disk, and the log records
how many rows came back, never what was in them.

## Sending a project to someone

A project leaves this browser one way: as an encrypted `.mxscout` package, with
its solved cases; the Assist items never go with it. **Package…** says which version of the app it
packs, builds the file and shows an access code — 100 bits, in an alphabet with
no `I`, `L`, `O` or `U` so it survives being read down a phone. MxScout does not
keep that code and cannot recover it; a new export means a new code.

**One person updates, the others import.** One developer brings the
descriptions up to date and puts the package on a shared drive; the others
open it. The first package of a project needs its code; after that, the
project's later packages open **without one** — "Opened with the key you
already have for this project; no code needed." Opened into a project you
already have, a package says whether it is newer, older or the same version as
yours ("This package: main @ f00ba12 · 14 Oct 2026 — newer than yours (yours:
main @ a1b2c3d · 10 Oct 2026)"), and asks before an older one replaces your
model. A project kept in a folder is written there, as on any import.

Underneath: each project has a random 256-bit AES-GCM **package key**, made by
its first package and kept in this browser — in its database, never in the
project folder. Every package of the project is encrypted with it (AES-256-GCM,
the payload gzipped first) and carries it wrapped by the code: PBKDF2-HMAC-SHA256
at 600,000 iterations turns the code into an AES-KW key, which wraps the
project key. Whoever opens a package with the code keeps the key for the
project it went into; a later package whose key id matches is decrypted with
it. A kept key that does not open a package is not trusted — the code is asked
for. A package made by anyone who holds the key opens for all the others, so
the round goes both ways. **Settings → Packages → Forget this project's key**
asks for the code again. All of it is WebCrypto — no hand-written cryptography
and no library. The envelope is JSON so a reviewer can open it and confirm what
it declares; nothing identifying is outside the encrypted part, the file name
aside — the key id is in the clear, random, and shows only that two packages
belong to one project. Packages made before this (format 1) still open, with
their code.

A wrong code is refused by AES-KW's integrity check rather than producing
garbage, and sloppy retyping — lower case, spaces, `O` for `0` — is normalised
before it is judged.

The package carries the model, the descriptions an agent wrote, what was
decided about the risks, and the comments if you tick them (the decisions
about risks raised in comments go with the comments). On the way in, per
risk the decision made last wins: a package travels both ways.

This protects the file **in transit**. Once imported, the model and comments
sit unencrypted in that browser's database — and so does the project's key, so
someone with access to that browser profile could open later packages of the
same project: the same person who can already read the project there. The
About page says so in those words.

## Sending a review out

The **Comments** section is a review: open an object, say what is wrong and
what should change, classify it, and come back to it later. Filters narrow the
list by severity, type, status, module, whether it has been sent, and when it
was written — and whatever the list is showing is what a report contains.
There is no second place to choose that, so the two cannot disagree.

**Send…** offers two ways out:

- an **encrypted HTML report** — one self-contained file that opens in any
  browser and asks for an access code, for a reader who does not have
  MxScout. They can print it to PDF themselves;
- **Copy for Word** — headings and tables on the clipboard, authors removed,
  for pasting into someone else's document. This one is not protected, and
  MxScout says so before it copies.

Both are recorded, so *Sent* can tell you which comments have never left, and
which have changed since the copy someone else is holding.

## About & security

**About & security**, under **Help** at the foot of the sidebar on every screen, opens an
in-app document describing exactly what MxScout runs and touches:

- the technology inventory — runtime, version (read from the running server, so
  it can never claim a different one), licence, install footprint, listening
  port;
- what MxScout never does, as properties of the code rather than settings;
- where every piece of data lives, and for how long;
- its network behaviour, and a table of every endpoint with who may reach it;
- the hardening in place, and why exactly four endpoints accept cross-origin
  requests;
- the non-production guard and live execution — including, stated plainly, what
  the guard does *not* protect against;
- a map of the source files, and the questions a security review usually asks.

**Print / save as PDF** on that page produces a clean, ink-friendly copy to
attach to a review. Printing is deliberately the only way MxScout produces a
file — it never gains the ability to write to disk.

If MxScout's behaviour ever changes, that page changes in the same commit.
Anything else makes it worthless to the person reading it.

## The team guide

How a team documents a Mendix app once and works with it — with Claude only,
with MxScout as well, or with packages and no repository — is one guide, in
English and Polish: `public/guide-team.md`, and the same guide as one HTML page
with a language switch, `public/guide-team.html`. Point people at the page. It
is in three places:

1. **In the MxScout repository**, committed: anyone can download it
   from GitHub and open it, with no MxScout and no network —
   <https://github.com/ksiejek/mxscout/blob/main/public/guide-team.html>
   ("Download raw file"), or
   `curl -O https://raw.githubusercontent.com/ksiejek/mxscout/main/public/guide-team.html`.
2. **In each Mendix project** kept in `mxscout/`, as `mxscout/GUIDE.html`
   beside `GUIDE.md`, stamped and replaced only by a newer MxScout, like them.
3. **In MxScout**: **Help → Team guide**, at the foot of the sidebar (and on Getting
   started), opens `/guide-team.html` in a new tab.

The page is self-contained: its stylesheet, the two fonts (as `data:` URIs)
and its one script — the language switch, which keeps the choice in the
address and stores nothing — are inside it, and it loads nothing. MxScout
serves it with a policy of its own, narrower than the app's: `default-src
'none'`, that one script by its SHA-256, its inline style, `data:` fonts.

It is made from the Markdown by `tools/build-guide.js` — a dependency-free Node
script run by hand, not a build step — after the guide changes:

```
node tools/build-guide.js            # writes public/guide-team.html
node tools/build-guide.js --check    # exits 1 when the committed page is out of date
```

`test/94-guide-html.test.js` fails when the committed page is not what the
script makes from the Markdown, so the two never drift. If the page's script
changes, the script prints its new hash for `server/index.js`.

## How the source is laid out

No build step, no bundler, no dependencies — what runs is what you read. One
subject per file. Each of the browser's own modules is reached through a single
named object and given what it needs through `init()` rather than reaching for
it; the `.mpr` decoding is the exception, because it runs in a Web Worker and
so has no object on the page at all. Nothing here is over 3,000 lines:

| file | what it is |
| --- | --- |
| `server/` | the whole HTTP server: loopback bind, security headers, the same-origin gate, the routes (among them the skills it ships — read-only, a fixed allowlist), static files (the team guide with a narrower policy of its own) |
| `server/admin-port.js` | pulled out of that row because it is the one file here that can open an outbound connection, and the allowlists that bound it are the shortest way to check what this README claims about that |
| `public/app.js` | the shell: state, projects, the browsing views, and what each other file is given |
| `public/live.js` | everything about talking to a running application — the guard, the session, reading rows, running a flow |
| `public/bridge.js` | the snippet pasted into the app tab, written as ordinary code and serialized when generated |
| `public/dialog.js` | every window over the screen a modal dialog: named by its title, the focus moved in, Tab kept inside, Escape to close, the focus back on what opened it |
| `public/objects.js` | the two object popups |
| `public/security.js` | the Security section: the project's own security settings, the roles, and what the model says about its passwords |
| `public/accessuse.js` | entity access against what uses it: per user role, rules wider than every page and flow the role reaches, rules and write rights nothing it reaches uses, flows that need a right the role lacks, and microflows that skip entity access to do what the role may not |
| `public/accessrule.js` | one row-level access rule — the readable rendering of its XPath, and whether MxScout could follow it at all |
| `public/comments.js` | comments: writing, filtering, history, and how two copies of one reconcile |
| `public/report.js` | the encrypted HTML report and the clipboard copy for Word |
| `public/crypto.js` | the package format, the project's package key and the access code — WebCrypto only |
| `public/transfer.js` | how a project leaves this browser and how one arrives: the project's key kept and reused, a package tried with it before the code is asked for, and which is newer when it goes into a project already here |
| `public/modelversion.js` | which version of the app a model is, read from the Mendix project's own `.git` as plain files; how it reads, which of two is newer, and the commits between two of them from the reflog |
| `public/folder.js` | the project folder as a backend: picking it, the permission, reading and writing its files whole (a file written with CRLF is read as LF), the inbox, what each file holds |
| `public/folderui.js` | keeping projects in folders, as dialogs: where a new project is kept, Keep in a folder…, Open a project folder…, Move all projects to folders…, Reconnect the folder |
| `public/repodocs.js` | a project kept inside the Mendix project (`mxscout/`), as files: `mxscout.json`, `README.md`, `AGENTS.md`, `.gitignore`, the descriptions split and joined back, `docs/` by topic with front matter and a manifest, git's conflict markers — pure, and it runs in Node too |
| `public/repoui.js` | a project kept inside the Mendix project, as screens: keeping one there, opening one a teammate committed, reading the model again when the `.mpr` changed, the status line with Re-read, keeping one side of a conflict |
| `public/mprImport.js` | picking a Mendix project — one folder pick where the browser allows it, the progress dialog, and handing the finished model over with the version it is |
| `public/sqlite.js` · `public/bson.js` · `public/mpr.js` · `public/mprWorker.js` | reading the `.mpr` itself, in that order: SQLite pages, then the BSON documents inside them, then the model shape, all of it in a Web Worker off the page's main thread |
| `public/explorer.css` | the look the screens share: the header with the search and View as, the segments, the inspector's sections and links (the App Explorer screen it started with is gone) |
| `public/flowgraph.js` · `public/flowgraph.css` | a microflow or nanoflow drawn as a graph, DRAKON-style — the Workflow view, self-contained so it travels inside the exported documentation |
| `public/assist.js` | the Assist page's items: one record per project in the browser's database, the envelope an agent hands them in (`"format": "mxscout-assist"`) read as text and bounded, an item replaced by its id with its history kept, a status or a planned date moved by a click or an update, the files a project folder keeps them in, and the move of an older file's tickets and changes; never in a package or the exported documentation |
| `public/docs-assist.js` | the Assist page — one list beside the page (kinds, search, Open · Closed · All), one item with its Work and Description tabs, its notes, its parts, the buttons that move it and its history — drawn from the documentation reader, in MxScout only |
| `public/docs-tickets.js` | a ticket's parts on the Assist page: its verdict, reasoning, evidence, reply with Copy, and the known risk it is about; and, on a risk, the tickets that are about it |
| `public/docs-changes.js` | a change's parts on the Assist page: now beside the proposal, the model changes by kind, impact, risks, open questions and effort |
| `public/docs-triage.js` | the risk triage as the documentation shows it on the Risks page — a risk's status, who raised it, what was decided and its history, the filter by status and by whose — and the Markdown copy's list of the risks that no longer count; handed what it draws with the same way, carried by the exported file |
| `public/reportdata.js` | the values the documentation's pages work out (risk themes, module dependencies, model quality, processes …), ported from the redesign's reference and held to it by a test |
| `public/flowview.js` | one flow read the way a developer reads it — the list, and the flow in two views (Workflow: drawn top to bottom, traced, the step beside it; Modeler: drawn as Studio Pro keeps it, a step's window, About), and a page drawn across the whole width, zoomed like the Modeler, what was clicked on it and About in a window — the component behind both the Microflows screen and the exported documentation's Microflows, Nanoflows and Pages |
| `public/pagepreview.js` · `public/pagepreview.css` | a page drawn the way Studio Pro's page editor draws it — the layout as a frame, every widget as what it is, the details of what you click in words — self-contained so it travels inside the exported documentation |
| `public/microflows.js` · `public/microflows.css` | the Microflows (and Nanoflows) screen: MxScout's shell around `flowview.js` — the header, View as, and the app's own actions |
| `public/flowtrace.js` | what a flow does with its variables (def-use), the sentences for steps and variables, members grouped by source, and which way of a decision stays on the main path |
| `public/studioview.js` · `public/studioview.css` | the Studio Pro view: the flow drawn where Studio Pro keeps every object (each line by the side it records), zoomable, laid out left to right only for a model without positions, with each step's details, its properties dialog and a button to what it works on |
| `public/exchange.js` | the flow-drawing handover file for MxScaffold — translation into that tool's vocabulary, and compaction |
| `public/store.js` | every persistent read and write, and nothing else does storage |
| `public/knowledge.js` · `public/docs-knowledge.js` | the solved cases: the notes in `knowledge/`, kept per project, taken from an agent (checked, personal data refused) and from the folder; the Solved cases page, drawn as text |
| `public/perf.js` | performance recordings: the admin port, saving and importing one, and every aggregation over its samples |
| `public/docs-data.js` · `public/docs-view.js` · `public/docs.js` · `public/docs.css` | the Documentation section: the model read out of itself (`docs-data`), one self-contained reader the export carries and the app runs for its previews (`docs-view`) — the export carries `flowview.js` and what it draws with as well, for Microflows & pages — the section that builds the one-file export (`docs`), and the `.dx`-scoped stylesheet, dark and light, that travels with it |
| `public/copilot.js` | descriptions through an AI chat assistant that cannot run code: the model in small text files and a prompt to carry to it, the answer read back from pasted text, checked against the model and added to what is there |
| `public/basket.js` | the context: entities, flows and pages put aside (+ Context, or a right-click) to talk over with a chat assistant; one prompt made of them, the answer pasted back as a Workbook item on the Assist page, whose technical description downloads with those elements appended; kept per project in the browser, sent nowhere |
| `public/home.js` | the projects page: a card per project saying where it is kept and what that means for Claude, its actions behind ⋯, a search, setting MxScout up once, the global settings in a line |
| `public/triage.js` | risk triage: false positive, fixed, reopen; only open risks count; new descriptions checked against what was decided; a comment that is a risk; kept in the browser's database apart from the descriptions |
| `public/describe.js` | the AI pack MxScout writes for an agent (the model as the documentation reads it, one section per module, a fingerprint per flow, each entity with its access per module role and its validation rules, each page's widgets shown or editable only on a condition) and the descriptions file it imports back — checked, kept as text, shown as an agent's; no model runs in MxScout and nothing is sent anywhere |
| `public/timeline.js` | the Timeline view: one time axis, the tracks on it, and the panel for whatever is picked |
| `public/palette.js` | the search: grouped by kind, or a `/` path through projects, sections and modules |
| `public/domain.js` | the Entities screen: the documentation's Domain model page, embedded, with Browse data and Add comment |
| `public/about.js` | the About & security page — data, rendered by one function that only sets text |
| `public/guide.js` | the Getting started walkthrough — same shape as About, but its mockups reuse the real screens' component classes |
| `public/guide-team.md` · `public/guide-team.html` | the team guide, English and Polish: the text MxScout writes into `mxscout/GUIDE.md`, and the same guide as one self-contained page (made by `tools/build-guide.js`, committed), served at `/guide-team.html` and written into `mxscout/GUIDE.html` |
| `public/version.js` | which version is running and what is in it |
| `public/logs/` | the log analysis, from MxDevSwissTool — `engine/` is the original's analysis code, `ui/` is the MxScout screen over it, plus one same-origin worker and `logs.css` (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)) |
| `public/index.html` · `public/styles.css` | the page every one of those renders into, and the stylesheet they all share |
| `public/tokens.css` · `public/fonts/` | the design tokens every stylesheet reads its colours from (dark and light, cobalt accent), and the two fonts, Instrument Sans and JetBrains Mono, under the SIL Open Font License (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)) |

Three directories are deliberately not in that table, because nothing in them
runs as part of the app: `test/` (see below), `tools/` (`build-guide.js`, run
by hand to make the team guide's page) and `skills/` (the skills, and the
two scripts that install mendix-describe and mendix-assist on a person's own
machine).

## The change-proposal skill

`skills/mendix-change-proposal/` is a skill for a coding agent, not code the
app loads. It picks up where the handover file leaves off: you export a
drawing from MxScout, ask for a change, and get back a second file in the same
format plus the reasoning — which MxScaffold imports and draws next to the
original, so the proposal is something to look at rather than something to
read.

It is a folder of Markdown and one zero-dependency Node script
(`check-proposal.js`), which answers the question the format itself cannot:
will the other tool draw what this file says? The rule that earns it is that
MxScaffold's importer **never overwrites** a flow it already has — it skips it
as "already here" — so a proposal that keeps the original's name imports as
nothing at all, and no screen says so. `node check-proposal.js proposal.json
--against original.json` catches exactly that. Like the other skills, it
writes nothing into the Mendix project: the proposal and its rationale go into
the work folder (`node agent.js workdir`), and the checker says so when the
file it checks sits inside a Mendix project. `test/43-change-proposal-skill.test.js`
runs its checks over a document built by the real exporter, so the two cannot
drift apart quietly.

To use it, copy that folder into `~/.claude/skills/`.

## The default language

**Default language**, in Settings, is the language an agent writes
everything in — descriptions, processes, risks, notes — for every project that
has not chosen its own: set it once (Polish, say) and every such project takes
it, now and when it is made. A project's Settings can still choose another.

## Your MxScout folder

One folder on disk, set once — **Choose…** beside *MxScout folder* in
Settings — where MxScout keeps a folder of its own for every project:
new projects, opened packages and imported documentation go there without
asking where. For a project kept in its Mendix project, the Mendix project's
`mxscout/` then holds only what the team commits (descriptions, docs, solved
cases, `mxscout.json`, the guide), and everything that is yours — the model's
copy, `documentation.md` and `ai-pack.md` for an agent, the inbox, your Assist
items — is in that project's folder in your MxScout folder, beside a
`project.json` that names the project's id. A `mxscout/.local/` from before is
moved there when the project is opened: copied, checked, then removed. Without
an MxScout folder, `.local/` (which git ignores) is used as before.

The skills find the local part by the project's id: `agent.js status` prints
where it is. They learn where your MxScout folder is once — `/mxscout-project`
asks and remembers it in `~/.mxscout/library.json` — or from
`MXSCOUT_PROJECTS`.

## Sending the documentation of many projects

**Export documentation…**, on the projects page, writes one encrypted file
with the documentation of the projects you tick — all of them, at first: for
each, the model it is drawn from, the descriptions an agent wrote and the
solved cases. Nothing else travels: no Assist items, comments, decisions about
risks, recordings, settings or package keys. One access code opens it, shown
once and never kept; send it by another channel than the file.

Whoever receives it chooses **New project** and picks the file. After the
code, MxScout lists the projects in it, each **New**, **Update** (they have it
from an earlier file, and this copy is newer) or **Up to date**, and takes the
ones ticked — by default into a **library folder on disk**, each project in a
folder of its own, where Claude reads them (`/mxscout-project`, below); or
into the browser only. A project that came from such a file remembers which
project it was, so the next file updates it rather than adding it twice; its
own name and settings stay.

## The mxscout-project skill — which app we are talking about

`skills/mxscout-project/` settles which application a Claude conversation is
about. `/mxscout-project` lists the projects in your library (the folder
above, or your own projects after **Move all projects to folders…**), asks
which one — or `/mxscout-project Order Portal` loads it at once — reads its
documentation, says in a few lines what the app is, and from then on answers
about it with mendix-describe and mendix-assist. The first time it asks where
the library is and remembers it in `~/.mxscout/library.json`
(`MXSCOUT_PROJECTS` wins). It reads the library and writes nothing into it, nor
into a Mendix project. The library can be a git repository, to share it with
a team. `test/96-mxscout-project.test.js` checks its script.

## Installing the skills on your own machine

In a Mendix project whose `mxscout/` a teammate committed, there is nothing to
install: the two skills come with the repository in `.claude/skills/`, and
Claude Code loads them when it starts in the project's root (restart it after
a pull that brought new ones). Anyone else — no such project, only a project
folder or a package — installs them from a clone of MxScout
(`git clone https://github.com/ksiejek/mxscout.git`), which carries the
scripts:

```
skills/install.sh                                          # macOS, Linux: links them
skills/install.sh --copy                                   #   or copies them
powershell -ExecutionPolicy Bypass -File skills\install.ps1  # Windows: copies them
```

Both scripts put `mendix-describe`, `mendix-assist` and `mxscout-project`
side by side in `~/.claude/skills/` (mendix-assist uses `../mendix-describe/`)
and touch nothing else — `mendix-change-proposal` is not among them: a link there is replaced, a
copy the script made is replaced, and any other folder of that name is moved to
`~/.claude/skills-backup/<name>-<date>`, never deleted. No dependencies, no
administrator rights; `-ExecutionPolicy Bypass` applies to that one run and
changes no setting. MxScout itself never runs them. Restart Claude Code, then
check with `/mxscout-project`, `/mendix-assist` or "use mendix-describe on <folder>". To update,
`git pull` — the links follow it; a copy needs the script run again.
`test/95-skills-install.test.js` runs `install.sh` against a temporary home.

**Codex, or another agent.** The skills are plain Markdown and Node scripts,
not tied to Claude. Newer Codex versions load skills in the same `SKILL.md`
format from `~/.agents/skills/` (where Codex looks now) and from
`~/.codex/skills/` (the older place, which it still reads);
`skills/install.sh --codex` (Windows: `skills\install.ps1 -Codex`) installs all three
skills into both, by the same rules, with a `skills-backup/` beside each for an
old folder of that name, and `--codex-only` (`-CodexOnly`) installs them for
Codex alone. `~/.codex` is `$CODEX_HOME` when `CODEX_HOME` is set, as Codex
itself does. With no
option, nothing of Codex's is touched. In a Mendix project with `mxscout/`,
Codex does not load `.claude/skills/` by itself and does not find
`mxscout/AGENTS.md` from the root: add one line to the repository's root
`AGENTS.md` — "Documentation of this Mendix app, and how to work with it: see
mxscout/AGENTS.md." — and `mxscout/AGENTS.md` tells it which `SKILL.md` to
read and follow. Or tell it once: "Read .claude/skills/mendix-assist/SKILL.md
and follow it." `/mendix-assist` is Claude Code's; in Codex, say "use the
mendix-assist skill".

## The describe skill

`skills/mendix-describe/` writes what MxScout cannot: prose. Point an agent at
the project's **folder** (the first way: "Use the mendix-describe skill on the
MxScout project in <folder>", or start it in the folder), or give it the
**AI pack** (Documentation → **Share with an agent**, or **Export AI pack**) and it writes, for a
business reader, what the application is for, its main processes and its
modules — each in two layers, a summary of a few sentences and a long
description of several paragraphs — and a sentence or two on each microflow
and nanoflow, as a descriptions file you import back (Documentation →
**Import descriptions…**). The two layers are defined once, in
[`reference/business-narrative.md`](skills/mendix-describe/reference/business-narrative.md),
and the mendix-docs skill works by the same file. The
same agent ranks the risks it sees, by
[`reference/risk-levels.md`](skills/mendix-describe/reference/risk-levels.md)
— P1 security and data, P2 functional errors, P3 maintenance — and writes what a developer should know before changing the
model. Each risk carries an **id** the agent keeps from one update to the
next, so laying a newer file over the kept one replaces a risk instead of
adding it twice. Each gets its own page in the documentation. It writes, per module, the **notes** a
developer needs ([`reference/module-notes.md`](skills/mendix-describe/reference/module-notes.md)),
and the **architecture** — the C4 context and containers as nodes and links
([`reference/c4.md`](skills/mendix-describe/reference/c4.md)), which MxScout draws
itself on an **Architecture** page next to how the modules depend on one another
and which user roles reach which module, both read from the model.
`test/54-architecture.test.js` and `test/60-modules-arch-dev.test.js` cover it.

The pack is built to be cheap to read: Marketplace modules are left out, an
index at the top gives each module's line range so the agent reads one module
at a time (or hands modules to parallel subagents), and every flow carries a
fingerprint — so the next run describes only what changed, and MxScout marks
an old description out of date instead of passing it off as current. The pack
and the documentation also say which version of the app the model is and which
one the descriptions describe; an agent bringing them up to date on the
developer's machine runs `git log --oneline <described>..<now>` in the Mendix
project — locally, read-only — and reads the commit messages beside the
fingerprints.
`check-descriptions.js` lists what is left to describe (`todo`), checks a file
against the pack before you import it (`check`), and joins per-module parts
(`merge`). `test/48-describe.test.js` runs it over a pack built by the real
exporter. Copy the folder into `~/.claude/skills/` to use it;
[`skills/mendix-describe/README.md`](skills/mendix-describe/README.md) walks
through it step by step, with a prompt to start from.

In a project folder, `node agent.js status | docs | module <Name> | pack <file>
| send <file> --folder <folder>` read the folder's files and write the result
into `inbox/` (whole, under a timestamped name), and `check-descriptions.js
todo --folder <folder>` works from its ai-pack.md and descriptions.json — the
same commands as through the channel. `test/83-folder.test.js` covers it.
Inside the Mendix project, `--folder` takes the Mendix project's directory or
its `mxscout/` (or run it in either): the pack is the current model's, made
from the `.mpr`, the documentation is in `.local/`, `status` compares the
commit the descriptions describe with the one HEAD names, `agent.js write
<file>` checks the file and puts the descriptions straight into
`descriptions/` — laid over what is there, `--replace` to make it the whole —
stamped with HEAD, and `send` hands a file to `.local/inbox/`. It never runs
git; the agent reminds you to commit `mxscout/` on its own.
`test/91-repo-folder.test.js` covers it, and that the documentation engine in
Node writes the same `docs/`; `test/96-skills-cli.test.js` the current model,
the checks before a write and the manifest.

Connected through **Share with an agent**, the agent also reads **the
documentation as Markdown** when the project has descriptions — the Markdown
copy the export writes, of the own modules, under a short header (project,
Mendix version, when, how many flows are described and how many of those are
out of date) that says it is what an agent understood earlier. It is held
beside the pack, behind the same token, gone with it, and sent again whenever
the descriptions change; `node agent.js docs` prints it. What the agent sends
back waits on the server in a queue, each result with its id, until the tab
takes it: the tab takes them one at a time and says which one it took, so a
result that arrives meanwhile is never lost; the same result sent twice (or
retried with the same `Idempotency-Key`) is queued once, and a full queue (32,
or 64 MB) refuses the next one and keeps what waits.
`test/99-agent-queue.test.js` covers it. The skill does not
start describing on its own when it connects: it reads the status and the
documentation, then does what you ask — describe the application or some
modules, bring the description up to date, one more process, a change, a
ticket, or a question about how something works. For everything but a first
description, the documentation is the map it reads first and the pack is what
it checks against, saying so where the two disagree.
`test/81-agent-docs.test.js` covers it.

After reading the documentation you can ask the agent for **one more
process** — "describe how an order gets its warehouse too". It follows that case
through the model and sends back only the process and the flows on its way,
in a file that says `"add": true`; MxScout lays it over the descriptions it
keeps, a process of the same name replaced, the rest as it was.

Or for **a change** you want made — "customers should be able to cancel an order
until it ships". The agent asks what is unclear, traces how that part works now
through the model, designs the solution in Mendix terms, the way the application
already does things (which flows, pages, entities, attributes, enumerations and
security rules to add, change or remove), and lists what it touches, its risks
and the questions the model cannot answer. It never changes the model; it sends
the proposal the same way, and it appears on the project's **Assist** page, under
Ideas — a change sent again with the same id replaces the one kept, its history
kept.

## The assist skill

`skills/mendix-assist/` is your help on the application, against its model —
start it with `/mendix-assist` or in plain words ("I have a Jira", "sprawdź
zgłoszenie", "mam pomysł"). It asks first what kind of thing it is and its
number:

- a **Service Desk ticket** — checked against the model, with a verdict (*bug
  in the model*, *works as designed*, *data or configuration*, or *cannot tell
  from the model*, with what would settle it), how sure it is, the evidence, a
  reply to paste back, and for a bug a proposed fix;
- a **Jira** issue — feasibility and scope, what it touches, a proposed
  solution in Mendix terms, risks, open questions, effort;
- an **idea** — how that part works now, traced, and a proposal;
- **other** help — a question about the app, an analysis, with its sources.

When a report leaves out what the answer hangs on, the agent says what to ask
the reporter, each question with why it matters, and the item waits; the
reporter's answer, pasted back later, is recorded in the item's thread and
checked again. Each becomes an **Assist item** with a status (open, waiting,
in progress, done, dropped), an optional planned date and a history, one file per item under the
project folder's `assist/` (inside the Mendix project, `mxscout/.local/assist/` — personal, never committed); the agent hands items back through `inbox/` or the
agent channel and never writes `assist/` itself. Assist items are local: not in
a `.mxscout` package, not in the exported documentation. When a case is solved
the agent writes a **case note** into `knowledge/` itself — committed, the
team's (see "Solved cases" above) — and searches those notes before it works a
new item out: `check-assist.js knowledge <note>` checks one (personal data is
an error), `check-assist.js cases <folder> --find "…"` searches them. The format is
[`skills/mendix-assist/reference/assist-format.md`](skills/mendix-assist/reference/assist-format.md);
`check-assist.js` checks a file and lists the items kept, and `node selftest.js`
tests it. It uses `skills/mendix-describe/`'s `agent.js` and
`check-descriptions.js` by the relative path `../mendix-describe/`, so install
the two folders side by side;
[`skills/mendix-assist/README.md`](skills/mendix-assist/README.md) says how. It
never changes the model, never opens a ticket's address and talks to no
tracker. It replaces the earlier mendix-ticket-check skill. `test/79-tickets.test.js`
checks the skill, `test/86-assist.test.js`, `test/87-assist-channel.test.js` and
`test/88-assist-folder.test.js` the Assist page, `test/92-knowledge.test.js` the
solved cases.

## Versions and updates

The sidebar shows which version is running — read from the running server, so
it cannot claim a version it is not — and opens a panel with the changelog that
ships inside that copy.

**MxScout does not check whether a newer version exists.** Not on startup, not
behind a button, not at all. A version check would mean reaching out to the
internet, and the promise that MxScout only ever connects to the app you are
testing is the single sentence a security review remembers; inside a corporate
network the check would usually fail anyway; and MxScout has no write access to its own directory and should not
have any.

So: to find out whether there is a newer version, look at the repository
yourself. To move to one, run `./update.sh` in the MxScout directory
(`Update.cmd` on Windows; `./start.sh --update` updates, then starts): it runs
`git pull --ff-only`, says the version before and after, and leaves a copy
with changes of its own — or a folder that is not a git clone — exactly as it
is. You run it; MxScout itself never rewrites its own files.
`test/96-update-script.test.js` runs it against a repository made for it.

What it *can* do without any of that, and does: it notices when the version has
changed since you last used it, and shows you what you moved onto. That fact
lives in this browser, so it needs no network at all — it is the "there's a new
version, here's what changed" moment, arriving when the update actually
happened rather than when a server was asked about one. Confirming it is what
records it: close the browser without reading it and it is waiting again next
time, rather than having been ticked off on your behalf.

## Tests

An automated suite runs before every commit that lands on this branch, and
needs no dependencies either — Node's standard library plus the Chromium
already on the machine, driven over the DevTools Protocol by a small client
on Node's built-in `WebSocket`. A suite that dragged in a tree of
packages would be the largest attack surface in the repository and the thing
nobody reads.

It ships with the app, in `test/`. Run it with `npm test`, or
`node test/run.js flow` to run only the files whose name matches — it starts
MxScout and a stand-in Mendix app on their own ports and drives a real
Chromium. There is no framework: a test file exports `async function (t)` and
calls `t.ok(condition, message)`. Each file starts from an empty browser — the
tabs the last one left closed, what MxScout and the stand-in app stored for
their addresses cleared — so none passes because of another. Every command
sent to the browser has a time limit, and so does each file
(`MXSCOUT_TEST_TIMEOUT`, in seconds, 300 by default): a test that hangs fails
with what it was waiting for, and the run goes on. When a test fails, the
runner saves a screenshot and the page's console for each of its tabs in the
system's temporary folder and prints where.

On GitHub, every push and pull request runs the same `npm test`, and the
mendix-assist skill's `node skills/mendix-assist/selftest.js`, on Windows,
Linux and macOS with Node 22 — `.github/workflows/test.yml`. Nothing is
installed for it: the browser is the Google Chrome each runner already has,
and the only actions are GitHub's own `checkout` and `setup-node`; it uses no
secrets and may only read the repository. The repository's `.gitattributes`
keeps every text file in LF on every machine (and `MxScout.cmd` in CRLF), so
a Windows checkout holds the same bytes the suite and the team guide's hash
expect, whatever `core.autocrlf` says.

What it covers today:

- the bridge protocol — token gating, long-poll delivery, the data round trip,
  a superseded session, and a busy bridge still counting as connected;
- versioning: the changelog reader, the "you moved to a new version" panel, and
  that opening any of it reaches nothing outside MxScout;
- the team guide's page: exactly what `tools/build-guide.js` makes from the
  Markdown, both languages, nothing it loads, its own policy with its script's
  hash, the fonts and the language switch working under it, and the links to it;
- every window as a modal dialog, with the keyboard alone: its role and name,
  the focus inside it, Tab and Shift+Tab kept inside, Escape, and the focus
  back on what opened it;
- line endings: files written with CRLF — a project folder in a Windows git
  checkout — read the same as with LF, and the team guide's page and the
  skills served with LF whatever this checkout holds;
- one repo-wide invariant: exactly one place in `public/` assigns markup, and
  it is the documented clipboard fallback — a second one fails the suite,
  because the About page makes that claim to a security reviewer;
- the log analysis: the original author's own assertions run against the
  ported engine, and the screen is driven in a real browser — one file loaded,
  Insights and the slow queries read off it, the removed tools still gone,
  nothing thrown, nothing requested beyond this server;
- the flow drawing: every node at its place, loops as containers, branch values on
  the arrows, the whole text of a step on hover, and a call that opens the called flow;
- the log analysis as a section of a project: a log read against the model — chips on
  errors that name a microflow or entity, Open, and Report into a real comment;
- the production guard, including a check that its two copies still agree;
- the whole bridge in a real browser — ten rows, a real count, paging, live
  search, search by id, and a second entity coming back with *its* columns;
- the flow popup, both ways: picking an object and running a microflow through
  MxScout, and doing the same inside the app tab against a page served with a
  genuinely restrictive Content-Security-Policy, so the browser does the
  blocking rather than a mock;
- the encrypted package — the access code, the envelope, and every way it must
  refuse (wrong code, one flipped byte, a newer format, a file that is not a
  package, an algorithm it does not know);
- how two copies of one comment reconcile, and finally the whole loop through
  the interface: package a project, catch the file, drop it back in, be refused
  with the wrong code, and import it with the right one;
- the project's key: a later package opening without the code, a kept key that
  does not open one falling back to the code, a format-1 package still opening
  with its code, Forget this project's key, and newer, older and the same
  version said before a package replaces a model;
- the model's version: reading `HEAD`, a ref, `packed-refs`, a loose commit and
  the reflog from a `.git` written by hand, a worktree, no `.git`, a `.mpr` on
  its own, and the stamp in the header, `project.json`, `documentation.md` and
  the AI pack, descriptions stamped with it, and the commits since.

## Status

In place: project management, importing a project either as a `.mpr` folder or
a JSON export, the read-only browsing views, the environment gate, the
one-snippet bridge with the entity Data tab, running a flow, the comments and
reports, the encrypted package, version notifications, and the About &
security and Getting started pages.

What's next lives in a working log kept beside the code rather than in it —
not part of this download.

## License

[GPL-3.0-or-later](LICENSE) — the complete source is readable, unminified,
with no build step between it and what runs. That is also the argument this
project makes to a security reviewer: read it yourself, there is nothing
hidden to take on faith.

The log analysis (`public/logs/`) is derived from
[MxDevSwissTool](https://github.com/RealMecowhy/MxDevSwissTool) by Mikołaj
(RealMecowhy), MIT licence, Copyright (c) 2026 Mikołaj; the notice and licence
text are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
