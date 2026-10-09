# Changelog

What changed in each version of MxScout, newest first.

MxScout does not check for new versions and never contacts a server to find
out about one — that is deliberate, and the About & security page explains why.
This file is what it shows you instead: it ships inside the application, so the
copy you are running can always tell you what is in the copy you are running.

To see whether a newer version exists, open the repository yourself. To move to
one, run `git pull` in the MxScout directory (or replace the directory). MxScout
never rewrites its own files.

The version in `package.json` is the single source of truth. The About page
reads it from the running server rather than from a constant, so it cannot
claim a version it is not.

## Unreleased

### The business description: a summary on top, the long story under it

- **The application, each main process and each module now come in two
  layers**: a summary of two to four sentences, always shown, and a long
  description of several paragraphs under it, folded behind *Read the full
  description*. The main processes stand one under another instead of as
  tiles side by side.
- **One definition for both tools.** What a summary and a description are,
  how long, and how they are shown is written once, in
  `skills/mendix-describe/reference/business-narrative.md`; the mendix-describe
  skill writes by it, and so will the mendix-docs skill's business document.
- The descriptions file gains `story` next to `summary` for the application
  and each process, and a module may be `{ "summary", "story" }`. A file
  written before still imports: a module's single sentence is read as its
  summary. `check-descriptions.js` flags a summary without its story, a
  summary that runs long, and a story written as a list.

### Log analysis, cut to what a log is read for

- **Log analysis is one viewer now: the stream, Insights and the slow
  queries.** The other seven tools that came over from MxDevSwissTool — the
  Query Extractor, Microflow Tracer, REST & WS Extractor, Error Decoder,
  Nginx analyzer, Anonymizer and Incident Report — are gone, and so are the
  bar that shared a file between them and the Levels Matrix, Correlation Flow,
  Sequence Diagram and Gantt tabs. Insights still groups errors by the
  mechanism the decoder's rules name; there is no longer a screen that
  explains one.
- **A Slow queries tab**: every statement the runtime reported as slow — a
  warning it writes at default log levels, so a production log has them —
  one row per statement, the runs of the same statement with different values
  counted together, ordered by the time it cost in total. Open one for its SQL,
  highlighted, the model objects its tables belong to, and each run; a run
  opens its own line in the stream. The Insights card leads to it.
- **Dragging a window off the records-over-time chart zooms the chart to
  it.** It used to narrow the stream and leave the chart on the whole log,
  so the window you picked became a few bars in an empty strip — and the
  next drag, measured against the whole log again, widened it. Now the window
  fills the strip, a drag inside it narrows further, and Clear range goes
  back to the whole log.
- **⛶ Full screen** gives the log the whole window: the sidebar and the
  header text step aside, the filters, the chart and the tabs stay on top —
  the stream, Insights and Slow queries are all there — and the stream gets
  the rest. Esc comes back; an object or a comment opened from a log line
  still opens over it. The node filter and the date now share the time row,
  so the filters take half the height they did.

### Three more access checks, the signed-in user, and two Live fixes

- **The Security section checks what a role does, not only what it reads.**
  Write, create and delete rights nothing the role reaches uses (no input on
  its pages, no New or Delete button, no flow with its rights); a nanoflow or
  a microflow with entity access that a role can run and that needs a right
  the role lacks, so it fails for that role — these are counted at the top as
  something to act on; and a microflow that skips entity access doing for a
  role what its own rules forbid.
- **View as the person signed in to the app.** When MxScout is connected, the
  "View as" list offers that person next to the roles, with every user role
  they hold at once — a tester given two roles sees what both reach. The
  bridge reports the name and the role names when it connects; MxScout keeps
  them in memory while connected.
- **Disconnect disconnects.** It used to clear only a waiting request, so the
  bridge in the app tab kept the session alive and the app read as connected
  again a moment later. It now ends the bridge's session; the bridge stops and
  says it was disconnected.
- **The search over every text field works when one of them cannot be
  searched** — a field the signed-in user may not read, or one the app
  computes. Calculated attributes are left out, and when the search still
  fails the bridge searches the fields that can be searched.

### A light theme for MxScout

- **MxScout has a light palette**, the same one the exported documentation's
  light theme uses: warm paper, the amber deepened to read on white. Choose
  light, dark or the system's at the foot of the sidebar; the choice is kept
  with your other settings in this browser. Dark stays the default. The
  workflow in a flow's window and the documentation previews follow it.

### Entity access, set against what actually uses it

- **The Security section now compares every access rule with the pages and
  flows that use it**, per user role and from the model alone. Two lists:
  - *Reads every row, sees fewer* — the role's rule has no XPath, but every
    page, snippet and flow the role can reach narrows the entity: over an
    association, with an XPath, the object a page was given, or handed over
    by a microflow. A page is not what protects data, so this is the real
    extent of that role's access, and the card says whether strict mode is
    on in this project.
  - *Granted, never used* — the role holds a rule and nothing it can reach
    shows the entity, reads it, takes it or returns it.

  Each entity opens to the places, as badges, with the XPath kept exact on
  each; a badge opens that page or flow. A user role a published OData
  service is open to is named and left out rather than judged.
- **MxScout now reads where every page's data comes from**, snippets
  included, and how every retrieve in a flow reads. Replace a project's
  model from its folder to get both.
- **The documentation reads more easily.** A workflow carries what the flow
  takes above Start, as Studio Pro draws its parameters, and what it returns
  below the last step, so the drawing gets the room the two cards above it
  took. A step's details open next to the step, not in a panel at the side;
  a step with a complicated expression says so on its card and shows the
  expression in its details, laid out with "then" and "else" on lines of their
  own. An entity's page opens on who may read, write, create and delete it,
  rule by rule, with the XPath that limits the rows. Model quality no longer
  lists entities without access rules or microflows that skip entity access.
  The title band stands apart from the menu, the domain map's cards are
  narrower and further apart, and the scrollbars take the theme's colours.
- **The export asks which modules go into the file**: every module is offered,
  the Marketplace ones unticked.
- **The Studio Pro layout of a flow fills the screen**, and only the drawing
  moves; a parameter is drawn pointing into the flow, as Studio Pro draws it.
- **In the Security section, a microflow is a link** — the one a scheduled
  event runs, and the one behind a published REST operation.
- **"Reached from" in a flow's popup is grouped by kind** — a heading per
  kind and the names under it as badges, like "Can be triggered by" — and
  the side column is wider.

### Documentation — the whole model, in one place and one encrypted file

**Every project has a new Documentation section: everything the model says
about itself, drawn as a documentation portal, and exportable as a single
encrypted HTML file.** It is built from the model each time one is loaded —
there is nothing to keep in step by hand — and it never leaves the browser
except as the file you choose to export.

- A rail of five views. **Start** is a hero and the project's numbers —
  modules, microflows, nanoflows, pages, entities, roles, scheduled events,
  published services. **Modules** is what each one holds, own modules before
  Marketplace. **References** is every microflow, nanoflow and page, each on
  its own page: what it takes and returns, who may run it, what it calls and
  what calls it, and — for a flow — its **workflow drawn top to bottom**, the
  same cards the mendix-docs skill produces, a decision's branches side by
  side, loops as frames, error handling as a side path. **Domain** is each
  entity with its attributes and access, and the entities that point to it and
  that it points to. **Quality** is where the model looks unfinished: what
  nothing reaches, entities with no access rule, microflows that skip entity
  access, disabled steps.
- A step that calls another flow opens it. A flow's page has **Open in
  MxScout**, which brings up that object's own window — with the Studio Pro
  drawing — over the documentation.
- **Export is one HTML file, encrypted.** It carries the documentation (under
  a fresh access code, the same WebCrypto envelope as the review report), the
  reader's own source, and its stylesheet — nothing else. It opens in any
  browser, asks for the code, and shows exactly what the app showed. The
  documentation names an application's weak spots, so it is never written in
  the clear; the code travels separately from the file. It is built in your
  browser and handed to the download — the server never sees it, and nothing
  is sent anywhere.

A model imported as JSON carries no drawings, so its flows are listed without a
workflow; load the model from the Mendix project folder to see them.

### Microflows and nanoflows, drawn

**A flow's window has a new Diagram tab: the flow drawn the way Studio Pro
draws it.** MxScout has been reading the drawing out of the project file for a
while — where every activity sits, how big it is, which side each arrow leaves
and enters by, how it curves — and only handing it to MxScaffold. Now it draws
it itself, for microflows and nanoflows alike.

- Nothing is laid out: the boxes are where their author put them, so the
  picture is the one the developer already knows. There is no layout library
  behind it, and nothing new to install.
- A box holds as much of its text as fits, wrapped; **hovering it shows all of
  it** — the action, the variable, the XPath or expression, what it returns,
  its documentation, whether it is disabled — in a card, not a tooltip.
- Activities are coloured by what they do: read data, change objects, call
  something, talk to the user, call outside the app. Decisions carry their
  branch values on the arrows, error handlers are dashed red, loops are
  containers with their steps inside.
- A step that calls another microflow or nanoflow is a link: click it and that
  flow opens on its own drawing. A step that opens a page or touches an entity
  opens that page or entity.
- It opens readable — at its start, near full size — with Fit one click away;
  drag to move, Ctrl + wheel to zoom.

A model imported as JSON carries no drawings, so its flows have no Diagram tab.

### Log analysis — brought over from MxDevSwissTool

**A new section in the sidebar, Log analysis: the log tools from
[MxDevSwissTool](https://github.com/RealMecowhy/MxDevSwissTool), written by
Mikołaj ([RealMecowhy](https://github.com/RealMecowhy)) and used here under
its MIT licence.** The analysis is theirs — every parser, rule and heuristic
was carried over unchanged, so MxScout reads a log the way their tool does,
and their own test assertions run against the ported code in `npm test` to keep
it that way. The licence text and the list of what came from where are in
`THIRD-PARTY-NOTICES.md`; every ported file carries a header naming the
original. The screens are MxScout's own.

It works on a log with no project open: it is not part of a model. One viewer
(cut down to it on 2026-10-09, see above) reads Studio Pro CSV, Mendix Cloud
live logs, on-premises logs and Grafana exports: a stream with level, node and
text filters, a records-over-time chart you can drag to narrow, bookmarks,
merge and undo, error aggregation by signature, Insights, and the slow queries.

**It is a section of the project, and that is where it earns its keep.** Open a
project and *Logs* is in its list, beside Comments. Read there, a log is read
against that project's model:

- A warning or error that names a microflow, nanoflow, page or entity of the
  project — or a PostgreSQL table such as `sales$order`, which is resolved to
  its entity — carries a chip under the line. Click the name and the object
  opens over the log; close it and you are back on the same line.
- **⚑ Report** starts a comment on that object with the log lines, the time and
  a severity from the level already written in. Nothing is saved until you save
  it, and then it is an ordinary comment — in the object's Comments tab, on the
  Comments page, in a report.
- A new tab, **In your model**, ranks the objects the errors point at, with
  their error and warning counts, and narrows the stream to any of them. The
  same chips appear on the Insights breakdown, Aggregate Errors signatures and
  a slow query's statement.

With no project open the same tools work under *Tools → Log analysis*, without
the links.

Nothing you load leaves the tab. What contacts the network, and the rest of
MxDevSwissTool's toolbox, was never carried. Its charting libraries are
replaced by a chart drawn directly, so MxScout still has no third-party code
beyond the licence notice above.

### "Reached from" was pointing at the wrong document, and sometimes at none

**A microflow that said "nothing in this model reaches this" was often wrong.**
Three separate faults, all in the one path that works out what reaches a flow
no role can trigger:

- A reference in a Mendix project is a plain name, and the same name can
  belong to two documents — a microflow and a page both called
  `Sales.EditForm`, or a scheduled event named after the microflow it runs.
  MxScout matched on the name alone, so for a shared name whichever document
  it had indexed last took every reference. The property the name sits under
  says which kind was meant, and now that is what decides.
- "Is this the document talking about itself?" was answered by name alone too,
  so a scheduled event named after its own microflow looked like the microflow
  mentioning itself and was dropped. That is how Mendix teams normally name
  them, so this one was quietly losing a lot.
- The rows under **Reached from** look like links, and had never been
  clickable: clicking one threw and did nothing, since the day the list was
  added. They work now, and they open the right one of two documents sharing a
  name.

Measured on four real projects, the number of microflows, nanoflows and pages
saying "nothing reaches this" fell from 234 to 206, 337 to 280, 155 to 148 and
107 to 98. Six references in one of them moved off a page that never had them.

Re-import a project (Replace model…) to get the corrected answers — this is
read at import time, not while browsing.

### The project, as its own tree

**A new first section, App Explorer: modules, the folders your team made
inside them, and every document in them.** Until now MxScout read a folder
only to work out which module something belonged to, and then forgot the name
— so a project that its developers had carefully organised arrived here as
four flat lists.

**It shows every document, not only the kinds MxScout models.** One real
project holds 3,377 documents of 29 kinds, and MxScout models the inside of
three of them. A snippet, a Java action, a constant, a layout or a mapping is
now a row with its kind on it and nothing to click, because leaving it out
looked exactly like "not in this project" — which was a different and wrong
answer. The three kinds that have a window still open one, over the tree, so
closing it leaves your branches where you left them.

Empty folders are kept as well. In every project measured, some of them are a
note rather than an oversight: `#v1.0.0` and `_Version 11.1.0` are how a team
writes down which version of a Marketplace module it took.

Typing in the filter opens whatever still has something in it, and clearing it
puts the tree back the way you had it. A module leads with its **Domain
model**, which takes you to that module's entities.

**Nothing here renames, moves, creates or deletes anything.** MxScout has no
way to write a Mendix project file and is not getting one; a tree that offered
to reorganise your app would be offering something it cannot do.

Two smaller things came with it. Flows handed to MxScaffold now say which
folder they came out of. And the About page's source map is now checked against
the disk by the test suite — it had drifted to naming 28 entries when it listed
29, which is exactly the kind of small untruth that page cannot afford.

### Microflow drawings can leave as a file

**MxScout now reads the drawing of a microflow, not just a summary of it, and
can hand it over.** Studio Pro keeps the picture in the project file — the
position and size of every activity, the arrows between them, which side each
one leaves and enters by, the branch values, the error outlets. All of it was
there and none of it was read. Now it is, for every microflow and nanoflow in
a project, along with a readable label for each activity built from its own
fields ("Retrieve from database · Order", "Call microflow · SUB_CalcDueDate").

**Two new buttons write it out.** Above the Microflows and Nanoflows lists,
one that says how many drawings it will write — the number counts what is on
screen under the filters, so there is nothing to guess about what lands in the
file. And inside a flow's own window, one that writes just that flow. The file
is for **MxScaffold**, a separate planning tool that draws microflows; its
format is MxScaffold's own handover JSON, which already had a kind for a
domain model and now has one for flows.

Two things worth knowing. The file is **not encrypted**: it carries project
structure, so treat it like any other copy of the model — unlike a `.mxscout`
package, which is. And writing it **opens no connection**: the file is built
in the page and handed to the browser's own download, the same way the
encrypted report and the package already are. The server never sees it, and
nothing about MxScout's network behaviour changed.

A project whose model was imported as JSON, rather than read from a project
folder, holds no drawings — the buttons do not appear for it, and the export
says so rather than writing a file full of flows with no steps.

### "What it does" was saying less than the truth about two things

**A flow that reads objects over an association no longer claims to read
nothing.** The panel above the Run button lists the entities a flow touches
before you set it off. It read an association-based retrieve from the wrong
place, so those retrieves contributed nothing: on a real 1536-microflow
project, 464 flows were missing entities they genuinely read, and 305 of them
said they read nothing at all while reading from the database. They now name
what they read, and the entity list on the flow does too.

**A call to a nanoflow is counted as a call.** It was read from the action
instead of from the call inside it, so none of them counted — 147 on the same
project. The separate "Can be triggered by" panel was never affected: it finds
call sites a different way, and had them right all along.

Nothing else changed: the same reader, the same panel, two fields read from
where Mendix actually keeps them.

### The Timeline's overview strip stops jumping

**Dragging the edges of the window on the overview strip now does what the
pointer does.** It used to redraw the window at the wrong width on every frame
of a drag — long, then short, then long — because each repaint sized it off a
700-pixel stand-in rather than the panel actually on screen; for a frame the
view also sat at the very start of the recording. Pressing the strip just
beside an edge grip zoomed straight into 20 ms around the pointer, before the
pointer had moved. Now an edge lands under the pointer, a click on the strip
moves the window there without changing the zoom, and a new range is picked
only by dragging one. The edge grips are wider, too.

**The ruler says where you are at every zoom.** Stretched all the way in, every
tick across the panel read "+9.3 s"; ticks now carry as many decimals as the
step between them needs.

### Self time can no longer exceed total

**The Call tree could show a call spending more time in itself than it ran
for** — self 18.3 s, total 18.0 s on a real recording. Self was counted as
samples × the typical gap between samples, while total came off the real
timestamps, and real gaps are uneven. Both are measured on the same clock now.

### The Security section uses the width it has

**Security is no longer squeezed into a reading column.** On a real project the
user-role table wrapped module chips in half, dot on one line and name on the
next. The section now uses the full width, and module roles are laid out as a
grid of small framed modules instead of one full-width table each. A module
whose roles carry no description says so once, in its heading, rather than
"no description" on every row; roles that no user role carries are shown with
their module in front, since "Administrator" alone names nothing.

### The Overview stops blaming the runtime's background work on your clicks

**"Selects — 37 per request" is gone.** The database counters belong to the
whole Mendix process, and dividing them by the requests a recording caught
charged every scheduled event and queue poll to the scenario being recorded —
594 selects over 16 requests, on an app with a dozen queues. The heading now
says the counters are the whole process's, the tile gives a rate per second,
and the note under the card says to compare two recordings made on an otherwise
quiet app.

**A request the runtime put nothing on the stack for is called "no action
reported"**, and such requests are grouped as one row in "Where the time went",
instead of appearing as bare request ids that read like different things. The
id is still there — beside the name on the Timeline, and as a tooltip in
Slowest requests.

**The request count appears once.** "How much work this took" repeated the tile
from the card above it.

### View entities are marked as what they are

**A view entity — whose rows are what an OQL query returns, not rows stored
for it — used to look exactly like any other entity.** It is now marked "view
entity" in the entity list and "view" on the map, its window carries a View
entity badge and the OQL query that defines it, and its Data tab says the rows
are that query's result, served read-only by the app. They are browsed with the
same XPath retrieve a stored entity is, which is how Mendix's own data grids
read a view entity — though that has not yet been tried against a running app
that has one.

Read from a project folder, the query comes from the view entity's own source
document, where Mendix 11 keeps it; a copy Mendix 10 also kept on the entity is
used only when that document is missing. If neither is in the model, the window
names the document the query lives in rather than showing an empty box. No
project MxScout has been tried on so far had a view entity in it, so this was
built from the Mendix metamodel's own names — a project that has one will say
whether the reading is right.

### The changelog reads as a list of changes, not one long page

**Each change is now a heading and one sentence, with the detail a click
away.** The version panel used to be a 620-pixel window that opened with the
`git pull` note and then ran every release into a single scroll. It is wider
now, with the versions down the side — each with how many changes it holds,
one click to jump to it — and each change folded to its heading and the bold
sentence it opens with. The version you are running opens unfolded, since
that is usually the one you came for; "Expand all" and "Collapse all" do the
rest. "MxScout was updated" shows the new version as headings only, as a
summary of what moved. The note on why MxScout never checks for updates is
still there, beside the list rather than above it.

### Hidden is not gone

**A comment on something in a hidden Marketplace module is no longer reported
as orphaned.** MxScout hides Marketplace modules by default, and the check
behind "points at an object that is no longer in this model" was run against
that filtered view — so a comment on, say, `Administration.Account` was
counted with the ones whose object had really been renamed or deleted, and
following it said the object "may have been renamed or removed". Nothing had
changed. Such a comment is now marked "in a hidden Marketplace module", is
announced on its own line with a button that shows those modules, and
following it offers to show them and then opens the object. A comment whose
object really is gone is still reported exactly as before.

The same fault showed in one more place: a flow input whose type is an entity
of a hidden module said "not in this model". It now says the module is
hidden.

### The documentation looks like MxScout, and says what each step does with data

**A click on a step now shows the data it works with: every member a create
or change sets and the value it gets, every argument a call passes.** MxScout
had only kept which members a step touched; it now reads the values too, from
the same place in the project file. On a real project that is 581 create and
1,513 change actions, and 1,440 microflow calls, that can now answer "how was
this object made, and from what".

- **The documentation file looks like MxScout** — its mark, its amber, its
  sidebar — in a dark theme and a light one designed for reading it outside
  MxScout; the reader picks, or it follows the system.
- **Every flow starts with its entry and its exits:** what it takes, what
  starts it (roles, pages, other flows), what it returns and every way it
  can end — before the first step.
- **A step's details are pinned by a click**, beside the workflow, instead of
  a card that came and went with the mouse.
- **The domain model is a map:** the entity in the middle, the entities that
  point to it on the left and the ones it points to on the right, joined by
  arrows. A click moves another entity to the middle.
- **The Documentation section is where the file is made:** what it holds,
  previews that are the file's own pages drawn small from your project, and
  the export. The documentation itself is read in the file.
- **A flow's Diagram tab in MxScout draws the same workflow, with the same
  code.** Studio Pro's own layout is one click away on the same tab.

Re-import a project (Replace model…) to get the values on its steps — they
are read at import time.

### Descriptions for the business, written by an AI agent you run

**The documentation can now say what the application is for, what its main
processes are, and what each microflow does — in words a business reader
uses.** MxScout still runs no language model and opens no connection for it.
It writes an **AI pack** (Documentation → Export AI pack): the model as the
documentation reads it, as plain text, one section per module, with an index
of line ranges so an agent reads one module at a time, and a fingerprint per
flow. The new **mendix-describe** skill, in `skills/`, tells an agent what to
write and checks the result; you import the file it writes (Import
descriptions…).

- Every imported sentence is marked **✦ AI** in the documentation, and the
  overview stops saying nothing in it was written by a machine.
- The overview gets **About the application** and **Main processes**, each
  process with its steps and links to the flows that carry it.
- A description whose flow changed since it was written is marked **out of
  date**, and the skill's `todo` lists only those and the new ones — so the
  next run reads a fraction of the pack.
- Marketplace modules are left out of the pack. On a real project it is ~1.7 MB
  for 27 modules and 1,310 flows.

## 1.5.0

### The About page said the outbound connection only happens while recording. It does not

**MxScout contacts a Mendix admin port at two moments, not one**, and the About
& security page named only the second. Checking the admin password when you
connect a recording reaches that port too — it has to, because that is how a
wrong password is refused before anything is stored. The page now says so, in
the three places that had it wrong, and states the bound the code actually
enforces rather than the one that reads best: **the allowlist, not the clock.**
Two read-only actions, an address that passed the non-production guard, one
file able to open a socket — that is what holds, and it held before this
sentence was corrected. Nothing about what MxScout does changed here; what
changed is that the page describing it is true. A page like this is worth
exactly as much as its least accurate sentence.

The new first-step check below has its own entry in the endpoint table, same as
every other endpoint.

### The admin port address is asked, not just allowed

**Step one of a recording now checks that an admin port is really at that
address.** Before, its ✓ meant only that the address had passed the
non-production guard, so a dead address and a live one looked identical — and
you found out which you had after running the PowerShell script and pasting a
password for nothing. MxScout now asks the address the same read-only question
it asks while recording. It needs no password to do it: a real admin port
refuses an empty one, and that refusal is the answer. Nothing is stored by
asking, so this cannot stand in for the password check that follows.

### A failure no longer reads as quietly as a hint

**Errors in the recording setup were the same grey as the help text around
them.** They now get the alarm colour, while the same line still carries
"Checking the admin port…" in grey while a step is working. The wording is
unchanged — it already said what happened, why, and what to do next.

That line also announces itself to a screen reader now. It is the first live
region in MxScout, which means every status change before this one was silent
to anyone not watching the screen.

### The bridge snippet is one click away instead of filling a peephole

**Step three used to open with a 1,105-line script in a box seven lines
tall** — too small to read, too big to ignore. "Copy the code" comes first now,
one sentence says what the code may and may not do, and the source sits behind
**Show the code (1,105 lines)**, which gives it real room when you open it.
Reading it before pasting it into your own browser is a reasonable thing to
want on a company machine, so it is still all there.

### The first screen no longer says you need another tool first

**"A project is a name plus one model JSON exported from MxSonar"** was left
over from before MxScout could read a `.mpr` file itself — which is the very
thing the New project dialog now leads with. The empty state says what is
actually true: a model read straight from a Mendix project folder, or from a
JSON export.

### Deleting a recording can be taken back

**A recording now deletes and offers to undo it**, instead of asking first
through the browser's own confirm box. A confirmation arrives before the
mistake and gets dismissed out of habit; an undo catches the mistake after it
happens, which is the one that works. The offer stands for nine seconds in the
message bar.

**Nothing is held back from the database to make that possible.** The row
really is deleted the moment you press Delete. Undo writes back the copy the
card on screen was already drawn from, which lives in this page's memory — so
every sentence in MxScout about deleting is exactly as true as it was before.
The test for this reads the browser's database directly at each step rather
than trusting the list, so it stays that way.

**Deleting also says it happened.** It used to succeed in silence — the card
vanished and nothing else changed — while a *failure* got a message. That was
the wrong way round.

**Delete now sits further away from what it sits next to.** On a recording it
was six pixels from Export, exactly as far as Export is from Open; in the
project header it was eight from Package…, exactly as far as Package… is from
Replace model…. The colour said "careful" while the geometry said "just
another button". There is distance and a hairline between them now.

### The About page's own numbers are checked by a test now

**The About page states how many files the test suite is, and it had drifted.**
It said 41 against a real 47, and then wanted correcting by hand three times in
three days as the suite grew. Nothing else on that page depends on the number,
but it is the row somebody reads to judge whether they can audit this tool
themselves, and a stale count there costs the same as a stale claim anywhere
else on it.

The suite counts it against the disk now, so it cannot quietly drift again.

### The interface gets a scale

**MxScout had no spacing scale and no type scale.** Measuring the stylesheet
found 571 spacing declarations using 23 different values — three quarters of
them on no scale at all, essentially every whole number from 1 to 18 — and 17
font sizes including half-pixels like 10.5 and 12.5. That, rather than the
colours, is what made it look homemade: every value had been picked once, on
its own, with nothing to be consistent with.

There is a scale now — 4, 8, 16, 24, 32, 48, 64 for space and 12, 14, 16, 18,
20, 24 for type — and the performance setup and recordings list have moved onto
it. **The visible difference is that three setup steps now read as three
steps.** The gap between them was two pixels — smaller than the padding inside
a single step — so they grouped into one block of rows. The gap is the larger
of the two now, which is the way round it should always have been.

**The rest of the stylesheet has not moved, on purpose.** Rewriting 571
declarations in one go, with a test suite that checks behaviour rather than
layout, is the kind of change that has put this app on a blank screen before.
Surfaces move one at a time.

Nothing about the colours changed. They were checked and they hold: the screens
read with the colour removed entirely, and the lowest contrast anywhere in that
flow is 6.26:1 against a 4.5:1 requirement.

### Starting and finishing a recording now look like they registered

**Pressing Start changed nothing until the server answered.** No label, no
disabled button, nothing — and a press that leaves a button exactly as it was
reads as a press that missed, so the natural thing to do is press it again. A
second Start clears the samples the first one had begun collecting. Both
controls now say what they are doing and refuse a second press while the first
is still in flight.

### "Copied." stops lying about when you copied

**It was written once and never cleared**, so it sat beside the button for the
rest of the session, saying nothing about whether the last press had worked.
The button answers for itself now and goes back to normal after a couple of
seconds. A failure still stays put, because that one asks you to do something —
select the text and copy it by hand.

### Two sentences in the app said more than the code does

**"Leave that tab open. Nothing runs there unless you ask for it here."** That
was not true. The snippet keeps one request open to MxScout the whole time it
is pasted in — which is why a keystroke here reaches that tab at once instead
of on a timer. What is true, and is what the sentence was reaching for, is that
nothing is read, written or run there unless you ask. It says that now.

**"Talks to nothing but MxScout on 127.0.0.1."** Also not true, and this one
was added by the same round of work that is now correcting it. The snippet also
talks to the app it is pasted into — that is its whole job. It talks to those
two and to no third thing, which is what it says now.

Neither was on the **About & security** page. That page already described the
same open request accurately. Both errors were in quieter copy beside a status
panel, which is the useful part: accuracy drifts wherever attention is lowest,
and a claim is a claim regardless of its font size.

### A wrong address gets a real page

**Typing an address MxScout does not have used to return the words "Not
found"** as plain text, with none of the product's own look. It is the one
screen somebody reaches purely by mistake, in a tool whose whole argument is
that you should read it — so it is held to the same bar as the rest now: a
sentence saying what happened, and the way back.

It deliberately does not repeat the address you typed. An error page that
echoes the request back is how error pages turn into a security problem, and a
404 has nothing to gain by telling you what you just typed.

## 1.4.0

### "What it does" moved to where it can be read

**The summary of a flow's body is now a band across the top of its window**,
under the name and above the tabs, instead of a panel squeezed into the side
rail. The rail is the narrowest column MxScout has and qualified entity names
are the widest thing it had to show there, so a flow touching three entities
used to arrive as a stack of wrapped fragments. Being above the tabs is the
other half of it: what a flow does to data is a fact about the flow, not about
the Run tab, and it stays on screen while you read the comments on it.

**Red now means one thing.** A delete is the only thing in that summary that
closing the tab cannot undo, so it is the only thing that gets the alarm
colour — one filled marker, at the front. Commits, creates, changes and a call
that leaves the app are writes worth reading first, and they say so in full
strength type with no colour of their own; reads, calls and messages stay
quiet. The verdict line ("Deletes data", "Writes data", "Reads only") is a
sentence now rather than a pill, so it cannot compete with the one marker that
earned the fill.

**The browsing grid lost its write marker.** Two words on a card could say
that a flow writes but never what it writes, so the only question the marker
raised was answered one click away — where the band now names every entity. A
grid of cards is for finding a flow; judging one happens in the window that
holds the button that runs it.


### The Security section says what it found, before you scroll

**It opens on a band, not on a settings table.** One line of verdict — which
of the three security levels this app runs at and what that means — then what
was actually found, one line each. Before this, "Page URL check: On" and "the
administrator password is weak" were the same row in the same table, so
learning which two lines mattered meant reading all of them.

**Everything the section says is now one of three things, and each has a shape
of its own.** A *finding* is something MxScout concluded and somebody should
act on: a weak password, a security level that enforces nothing, a user role
that unlocks no module at all. *Worth knowing* is true and quite possibly
deliberate — anonymous access, a role that can hand out every other role, a
service with nothing in front of it, which in a real project is usually the
login callback that has to be reachable before anyone is signed in. *Not
checked* is where MxScout could not follow something and says so instead of
implying it did. One grey badge used to carry five of these meanings at once,
which is why none of them read as anything.

There is still **no score**. The band orders what it found; it does not grade
it. A service with nothing gating it is a defect in one project and the front
door in the next, and a tool that pretends to know which is which is a tool
you stop believing.

**The row-level rules MxScout could not follow are now on this page**, listed
with the entity and the role that owns each one, and clicking one opens it.
They already existed — but only in the access matrix of one entity, visible
only if you had also set the role filter to Everything, which means you found
them by stumbling on them. Clicking one from here drops that role filter on
the way in, so you land on a popup that actually contains the rule you clicked.

**User roles and module roles became one card.** They were two tables where the
second was a join of the first: "held by nobody" is a statement about the list
directly above it, and you were being asked to make that join by eye. A module
role no user role carries now drops out of its module and into a group of its
own at the bottom — where it sits is the fact, so the badge is gone.

**The administrator's password is stated once.** It had a note on the
Administrator row and a row of its own saying the same thing, and the standing
explanation of how MxScout knows — it read the password to judge it and kept
only the judgement — is now said once per card instead of once per account. It
was true every time and told you nothing new after the first.

## 1.3.0

### The model says more, because more of it is now read

A Mendix project file holds a great deal MxScout was walking straight past.
Six of those things are read now, and each of them answers a question somebody
actually had.

**Which Studio Pro wrote this project** now shows next to the project name. It
comes from the file's own metadata table, in all three of the shapes that
table really has.

**A new Security section** shows how the app is secured, as the project records
it: which of the three security levels it runs at, whether anonymous visitors
are let in and as which role, the demo accounts, the password policy, and every
user role and module role — including the roles no access rule happens to
mention, which are read from the module itself and were invisible before.

**And when the app does not enforce its rules, every view that filters by role
says so.** A project set to Prototype or Off has an access picture that is real
in the model and inert at run time; MxScout used to show it without comment.

**What a flow does, before you run it.** Running a microflow is the one thing
in MxScout that is not read-only, and the panel with the button now says what
pressing it does: whether it reads, creates, changes, commits or deletes, and
what; whether it calls a Java action or reaches outside the app; and whether it
does any of that inside a loop, which is one database round trip per row. The
browsing card carries the short version — "writes", "deletes", "calls out" —
and only ever when it is true.

**What reaches a flow no role can trigger.** About half the microflows in a
real app have no role at all, and "no user role can trigger this directly" was
never the whole answer: most of them are run by another flow, a page's button,
a scheduled event, a published REST operation or an entity event. Those are
named now, and clicking one opens it without losing your place. A flow that
genuinely nothing reaches is shown as exactly that.

**What the app publishes, and what runs with nobody signed in.** Published
REST, OData and web services get their own list, with their own role lists and
their own authentication — none of which goes through the access rules the
other views show. Scheduled events and queues get theirs: what they run, how
often, and whether they are switched on.

**An enumeration attribute says what it may hold**, captions included, instead
of only naming the enumeration — and the **Data tab shows those captions**
instead of the stored key. A Mendix app answers with `wf_in_progress`; the
caption is a design-time translation the data layer never carries, so MxScout
supplies it from the model and keeps the key on the cell, where an XPath
needs it.

**A row-level rule MxScout could not follow now says so.** A rule whose path
goes through the System module and keeps going cannot be followed from the
model at all — the System module is not in the project file, so there are no
members there to follow it through. The same goes for a rule naming something
this model does not contain. Those are marked on the entity popup, with the
reason. They are not marked as broken: MxScout says what it could not check
and points at the running app. The ordinary case — a rule ending at
`System.owner`, the standard "their own rows" idiom — is deliberately not
marked; it was every one of the 28 System-touching rules measured across three
real projects, and marking it would make the marker mean nothing.

**And a rule can now be checked against the running app.** Whether a
constraint actually selects anything is a fact about the application, not
about the file, so MxScout asks: how many rows the constraint matches, next to
how many rows of that entity the session can see at all. Zero matched means
nothing on an empty table and everything on a full one, so both numbers are
always shown — and so is whose rights they were counted with, since MxScout is
told the app session's user name and never its role list.

**A password in the model is now judged, not just counted.** A Mendix project
keeps the administrator's password and every demo user's password in the file
in plain text. MxScout reads them in the browser only long enough to measure
them against that project's own password policy and against a short list of
passwords that need no cracking — then keeps the verdict and drops the value.
So it can tell you the administrator account of an app that demands twelve
characters of its users has a one-character password that is one of the most
common there are, and still never hold the password: not in the model, not in
this browser's database, not in a package, not in a printed report. A password
that passes leaves nothing behind but "set" — not even its length, which is
kept only where the length is itself the finding.

**A comment keeps the line breaks you typed.** The box to write one in is
half again as tall, and the blank lines and steps you put in it survive
everywhere it is shown afterwards: the comments list, the object's own
Comments tab, the standalone HTML report, and the block pasted into Word.
Where a comment is shown, the breaks are kept by styling a plain piece of
text; only the Word clipboard turns them into a tag, and only after the text
has been escaped — so nothing written in a comment can become markup in
somebody else's document.

### Notes

- No password value ever leaves the Worker. They are read there to be judged
  and dropped; what travels on is the verdict, never the password.
- Reading a project still leaves no trace in it. Of the three tables in a .mpr,
  MxScout reads two and has no reason to touch the third — the one Studio Pro
  uses to notice an outside edit.
- A project imported before this version has none of the new information and
  says so rather than guessing. **Replace model** from the project folder fills
  it in.

## 1.2.0

### Record performance from the app, without pasting anything on the admin port

Recording performance used to mean pasting a second script into a browser tab
opened on the Mendix admin port. That is gone. MxScout's own server reads the
admin port now, and the record button lives on the badge already sitting in
the app's tab — so you start and finish a recording where you are actually
clicking, without switching windows.

Setting it up is three steps, shown as a checklist that stays on screen so you
can see what is done and what is left:

1. The admin port address, as a URL like `http://localhost:8090`.
2. The password, read by the small PowerShell script MxScout hands you. Press
   Connect and MxScout checks it against the port before keeping it.
3. The app tab — the same snippet the Live app tab already uses, not a second
   one. Once it is pasted, its badge grows a ⏺.

The connection is held by the server, so it survives a page reload: the
password is a once-per-app-run step, not once per sitting.

This is a deliberate, narrow change to what MxScout promised, and **About &
security** now has a section of its own about it — *Reading a running app's
admin port*. In short: the server makes one kind of outbound connection, to an
address that passed the same non-production guard as the app itself, asking two
read-only actions and no third, only while a recording is running. The admin
password is checked before it is kept, held in the server process's memory for
the session, written nowhere, and returned by no endpoint; Disconnect forgets
it.

- Connecting says what actually went wrong: a production address, nothing
  listening, a wrong password, or something that is not a Mendix admin port.
- If the port stops answering mid-recording, both the app's badge and MxScout
  say so, instead of saving an empty recording.
- Stopping from the app tab saves the recording in MxScout and opens it.
- The Timeline was drawing two long grey bars called `feedback` and `result`
  on a real recording. The Mendix admin API answers in an envelope —
  `{ feedback, result }` — and MxScout was storing that envelope as if it were
  the list of live requests. It is unwrapped now, and a recording already
  saved the wrong way is unwrapped when it is read, so nothing captured is
  lost.
- A recording can be exported as JSON from its card.

## 1.1.0

### Associations are members too, and write shows on the value

- **Attributes & access** now lists the **associations the entity owns**
  alongside its attributes, in the same matrix and under the same rule
  columns. In Studio Pro an association is a member of the entity exactly as
  an attribute is, and an access rule grants read or read+write on it the same
  way — so it gets the same traffic-light dot and the same per-rule cell. Only
  the owned end is listed: an incoming association is a member of the entity at
  the other end, and this entity's rules say nothing about it. The column is
  headed **Member** rather than Attribute.
- A rule's **default member access** now reaches those associations. It always
  covered them in Mendix; MxScout was applying it to attributes only, which
  showed an association as "no access" on every entity that leaves its members
  on the default.
- In the **Data** tab, a value this session may **write** is shown in green,
  **per cell**. The running application answers it, object by object
  (`isReadonlyAttr` — the same question its own input widgets ask before
  allowing an edit), so a rule's XPath deciding which rows it covers is
  reflected honestly: the same field can be writable on one row and read-only
  on the next. It sends nothing extra and writes nothing; a runtime that will
  not answer simply leaves the table unmarked.

## 1.0.1

### Pages are browsable, not runnable

MxScout no longer offers to open a page in the connected app tab. It used to,
through `mx.ui.openForm` from the bridge — but a page opens through the app's
own navigation, carrying the context that navigation built, and driving that
from outside the client is not dependable enough to put a button on.

- A page's popup keeps everything it was worth opening for: what it takes and
  which module roles may open it, read-only, plus its own Comments tab. It just
  no longer has a Run tab.
- The `page` command kind is gone from the bridge and from the server's
  validation, so it cannot be armed at all — not from the UI, not by hand.
- Running a **microflow** or a **nanoflow** is unchanged.
- **About & security** and the **Getting started** guide say the same thing.

## 1.0.0

### First release

MxScout is a local Mendix app explorer for developers and testers — a small
server on your own machine, a browser doing all the real work, and nothing
else involved.

- **Browse a project's model**: entities, microflows, nanoflows and pages,
  filterable by module and role, plus an entity map.
- **View it as a role**: every list, and the map, narrow to what that role can
  actually reach, with row-level access rules written out in plain words
  instead of raw XPath.
- **Read the running application**: paged, searchable data with a real count,
  and run a microflow, nanoflow or page against a real object — or one you
  create for the occasion — from inside your own logged-in session.
- **Leave comments** on any entity or flow: what is wrong, what should change,
  a severity and a status, filterable and exportable, and merged rather than
  overwritten when two copies of a review come back together.
- **Reports**: an encrypted `.mxscout` package to hand to a colleague, or a
  standalone HTML/Word report with the findings written out block by block.
- Runs entirely on your own machine: zero dependencies, no installer, no
  telemetry, no outbound connection — see **About & security** for the full
  list of promises this makes.
