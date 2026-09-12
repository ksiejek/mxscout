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
