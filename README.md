# MxScout

MxScout is a local app that helps you understand and test a Mendix
application. Point it at a project and it shows you what a given user role
can actually see and do — which entities, which fields, which microflows —
and lets you try a flow against a real, running app, without touching a
database or writing any code.

It runs as a small Node.js server on your own machine and shows its UI in your
browser. Nothing is installed system-wide, nothing is sent anywhere, and
closing it leaves nothing behind.

It is built to run on a **company machine, inside a company network**, which
sets the bar for everything in it: only safe, non-invasive mechanisms, so a
security team has nothing to object to. No npm dependencies at all, no
installer, no administrator rights, no background service, nothing written to
disk, no telemetry, no CDN, and a listener bound to loopback only. The server
opens exactly one kind of outbound connection — to the admin port of the app
under test, at an address that passed the same non-production guard as the app
itself, asking two read-only actions: once when you connect a performance
recording, to check its password against that port, and then while that
recording runs. A feature that cannot be built inside those limits does not get
built.

**About & security** in the top bar is the page that explains all of it — the
technology inventory, every endpoint, where data lives, what MxScout refuses to
do, and the honest limits of each guard. It is written to be handed to a
security reviewer, and it prints to PDF if they want it as an attachment.

Next to it, **Getting started** walks through a project's life in MxScout in
six steps — import, browse as a role, open an object, connect to a running
app, run a flow, then write it up and send it — against a fictional app, so it
needs no project of your own open to make sense.

**Log analysis** in the sidebar is a second job MxScout does without any
project open: reading a Mendix application's logs — the Log Viewer, Query
Extractor, Microflow Tracer, REST & WS Extractor, Error Decoder, Nginx analyzer,
Anonymizer and Incident Report, all over one loaded file. It is the work of
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

Either way the address is http://127.0.0.1:4288 (override the port with
`MXSCOUT_PORT`).

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

The first screen is a project list. A **project** is a name plus one model
JSON:

- **New project** — name it and pick (or drag in) the exported JSON.
- **Replace model** — load a newer model, or a package someone sent back to
  you, keeping the project. The model is overwritten; comments merge by id,
  newest write wins, so a package that has been round-tripped does not lose
  either side's findings.
- **Package…** — encrypt the project (model, and optionally its comments) into
  a `<project-name>-<date>.mxscout` file for someone else, with a generated
  access code shown once. Send the file and the code by different channels.
- **Delete** — remove the project and its model from this browser.

Projects live in the browser's own database (**IndexedDB**) on this machine —
not on a server, not in a file next to the app. Consequences worth knowing:

- Clearing site data for `127.0.0.1:4288` deletes every project. Use
  **Export** to keep a copy.
- Projects are per-browser and per-profile; they do not follow you to
  another machine.
- MxScout asks the browser not to evict that database
  (`navigator.storage.persist()`). Browsers answer that request differently
  and may decline it, which is why exporting still matters.

Earlier versions kept projects in `localStorage`. They are moved across
automatically the first time this version runs — copied and verified before
anything is removed — and the move is reported on screen. Every persistent
read and write lives in `public/store.js` and nowhere else.

## Browsing a project

Open a project and you get six views over its model, all driven entirely by
the stored model (no server, no live app needed):

- **App Explorer** — the project as its own tree: modules, the folders the team
  made inside them, and every document in them. Every document, not only the
  kinds MxScout models: a real project holds around 29 kinds and MxScout models
  the inside of three, so a snippet, a Java action or a constant is here with
  its kind on it and nothing to click — which is a true answer, where leaving it
  out looked exactly like "not in this project". Empty folders are kept too: in
  every project measured, some of them are a note (`#v1.0.0` is how a team
  records which version of a Marketplace module it took). Nothing here renames,
  moves or deletes anything — MxScout never writes a `.mpr`.
- **Entities** — as a **List** (grouped by module, with per-role access
  badges) or a **Map** (a domain overview: each module's entities plus the
  relationships between them). Click any entity for its attributes and
  associations, access rules and relationships. A view entity — one whose
  rows are an OQL query's result rather than a table of its own — is marked
  as one, its popup shows that query, and its Data tab says the rows are
  served read-only.
- **Microflows**, **Nanoflows**, **Pages** — grouped by module, each showing
  which roles can run/open it and its inputs.
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
  nobody signed in.

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
  operation. That is named, and a flow that genuinely nothing reaches is shown
  as exactly that.

**View the app as a role.** A dropdown at the top switches between *Everything*
and each of the project's user roles. Pick a role and every view narrows to
what that role can actually reach — entities it can read or write, flows it can
trigger, pages it can open — with row-level (XPath) rules shown in plain text
on the entity popup. This is the read-only picture; connecting to a live app
comes next.

## Live app — connecting to a running app

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

A project leaves this browser one way: as an encrypted `.mxscout` package.
**Package…** builds one and shows an access code — 100 bits, in an alphabet
with no `I`, `L`, `O` or `U` so it survives being read down a phone. MxScout
does not keep that code and cannot recover it; a new export means a new code.

Underneath: PBKDF2-HMAC-SHA256 at 600,000 iterations derives an AES-256-GCM
key, the payload is gzipped before encryption, and the whole thing is
WebCrypto — no hand-written cryptography and no library. The envelope is JSON
so a reviewer can open it and confirm what it declares; nothing identifying is
outside the encrypted part, the file name aside.

Opening one asks for the code. A wrong code is refused by the GCM tag rather
than producing garbage, and sloppy retyping — lower case, spaces, `O` for `0`
— is normalised before it is judged.

This protects the file **in transit**. Once imported, the model and comments
sit unencrypted in that browser's database, which is stated plainly on the
About page too.

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

Every screen has an **About & security** button in the top bar. It opens an
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

## How the source is laid out

No build step, no bundler, no dependencies — what runs is what you read. One
subject per file. Each of the browser's own modules is reached through a single
named object and given what it needs through `init()` rather than reaching for
it; the `.mpr` decoding is the exception, because it runs in a Web Worker and
so has no object on the page at all. Nothing here is over 2,500 lines:

| file | what it is |
| --- | --- |
| `server/` | the whole HTTP server: loopback bind, security headers, the same-origin gate, the routes, static files |
| `server/admin-port.js` | pulled out of that row because it is the one file here that can open an outbound connection, and the allowlists that bound it are the shortest way to check what this README claims about that |
| `public/app.js` | the shell: state, projects, the browsing views, and what each other file is given |
| `public/live.js` | everything about talking to a running application — the guard, the session, reading rows, running a flow |
| `public/bridge.js` | the snippet pasted into the app tab, written as ordinary code and serialized when generated |
| `public/objects.js` | the two object popups |
| `public/security.js` | the Security section: the project's own security settings, the roles, and what the model says about its passwords |
| `public/accessrule.js` | one row-level access rule — the readable rendering of its XPath, and whether MxScout could follow it at all |
| `public/comments.js` | comments: writing, filtering, history, and how two copies of one reconcile |
| `public/report.js` | the encrypted HTML report and the clipboard copy for Word |
| `public/crypto.js` | the package format and the access code — WebCrypto only |
| `public/transfer.js` | how a project leaves this browser and how one arrives |
| `public/mprImport.js` | picking a Mendix project — one folder pick where the browser allows it, the progress dialog, and handing the finished model over |
| `public/sqlite.js` · `public/bson.js` · `public/mpr.js` · `public/mprWorker.js` | reading the `.mpr` itself, in that order: SQLite pages, then the BSON documents inside them, then the model shape, all of it in a Web Worker off the page's main thread |
| `public/explorer.js` | the App Explorer: the project as its own tree — modules, folders, and every document in them, including the kinds MxScout models nothing else about |
| `public/exchange.js` | the flow-drawing handover file for MxScaffold — translation into that tool's vocabulary, and compaction |
| `public/store.js` | every persistent read and write, and nothing else does storage |
| `public/perf.js` | performance recordings: the admin port, saving and importing one, and every aggregation over its samples |
| `public/timeline.js` | the Timeline view: one time axis, the tracks on it, and the panel for whatever is picked |
| `public/palette.js` | the command palette |
| `public/about.js` | the About & security page — data, rendered by one function that only sets text |
| `public/guide.js` | the Getting started walkthrough — same shape as About, but its mockups reuse the real screens' component classes |
| `public/version.js` | which version is running and what is in it |
| `public/logs/` | the log analysis, from MxDevSwissTool — `engine/` is the original's analysis code, `ui/` is the MxScout screen over it, plus three same-origin workers and `logs.css` (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)) |
| `public/index.html` · `public/styles.css` | the page every one of those renders into, and the stylesheet they all share |

Two directories are deliberately not in that table, because nothing in them
runs as part of the app: `test/` (see below) and `skills/`.

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
--against original.json` catches exactly that. `test/43-change-proposal-skill.test.js`
runs its checks over a document built by the real exporter, so the two cannot
drift apart quietly.

To use it, copy that folder into `~/.claude/skills/`.

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
yourself. To move to one, run `git pull` in the MxScout directory. MxScout
never rewrites its own files.

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
already on the machine, driven over the DevTools Protocol by a sixty-line
client on Node's built-in `WebSocket`. A suite that dragged in a tree of
packages would be the largest attack surface in the repository and the thing
nobody reads.

It ships with the app, in `test/`. Run it with `npm test`, or
`node test/run.js flow` to run only the files whose name matches — it starts
MxScout and a stand-in Mendix app on their own ports and drives a real
Chromium. There is no framework: a test file exports `async function (t)` and
calls `t.ok(condition, message)`. What it covers today:

- the bridge protocol — token gating, long-poll delivery, the data round trip,
  a superseded session, and a busy bridge still counting as connected;
- versioning: the changelog reader, the "you moved to a new version" panel, and
  that opening any of it reaches nothing outside MxScout;
- one repo-wide invariant: exactly one place in `public/` assigns markup, and
  it is the documented clipboard fallback — a second one fails the suite,
  because the About page makes that claim to a security reviewer;
- the log analysis: the original author's own assertions run against the
  ported engine, and the screen is driven in a real browser — one file loaded,
  handed to every tool, nothing thrown, nothing requested beyond this server;
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
  with the wrong code, and import it with the right one.

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
