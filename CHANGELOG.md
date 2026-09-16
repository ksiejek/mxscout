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

### A count on the About page that had drifted

**The About page said the test suite is 41 files.** It is 48. Nothing else on
that page depends on the number, but it is the row somebody reads to judge
whether they can audit this tool themselves, and a stale count there costs the
same as a stale claim anywhere else on it.

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
steps.** The gap between them was two pixels while the padding inside one was
twelve, so they grouped into a single block of rows; the gap is bigger than the
padding now, which is the way round it should have been.

**The rest of the stylesheet has not moved, on purpose.** Rewriting 571
declarations in one go, with a test suite that checks behaviour rather than
layout, is the kind of change that has put this app on a blank screen before.
Surfaces move one at a time.

Nothing about the colours changed. They were checked and they hold: the screens
read with the colour removed entirely, and the lowest contrast anywhere in that
flow is 6.26:1 against a 4.5:1 requirement.

### The About page's own numbers are now checked by a test

**The count of test files on the About page is a claim like every other one on
that page**, and it had been corrected by hand three times in three days. It is
counted against the disk by the test suite now, so it cannot quietly drift
again.

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
