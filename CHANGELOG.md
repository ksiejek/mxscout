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
