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
