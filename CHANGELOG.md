# Changelog

What changed in each version of MxScout, newest first.

MxScout does not check for new versions and never contacts a server to find
out about one — that is deliberate, and the About & security page explains why.
This file is what it shows you instead: it ships inside the application, so the
copy you are running can always tell you what is in the copy you are running.

To see whether a newer version exists, open the repository yourself. To move to
one, run `./update.sh` in the MxScout directory (`Update.cmd` on Windows) — it
runs `git pull` for you — or replace the directory. MxScout itself never
rewrites its own files.

The version in `package.json` is the single source of truth. The About page
reads it from the running server rather than from a constant, so it cannot
claim a version it is not.

## 2.0.0

### The first public release

**Runs entirely on your own machine.** A small Node server on 127.0.0.1
and your browser — no installer, no administrator rights, no account, no
cloud, no telemetry, and not one npm dependency. The model is read in the
browser; the server writes nothing to disk. Everything it promises is on
its About & security page, and the tests that check it ship beside it.

- **Read a Mendix app from its model.** Pick the Mendix project folder (the
  `.mpr`, Mendix 9 to 11): MxScout reads every module, entity, association,
  access rule, microflow, nanoflow, page, snippet, user role, scheduled event
  and published service. Nothing is installed in the app, and nothing is
  sent anywhere.
- **Version 2.0.0, and a history that starts here.** MxScout 1.x and MxScout
  Dev came before it; files they wrote into a Mendix project are replaced by
  this version's.

### Documentation people read

**Overview, Processes, Modules, Architecture.** What the application is
for and who uses it, its business processes told case by case with a
diagram where they branch, each module in two layers, and the C4 model
adapted to Mendix — with how the modules depend on one another and which
roles reach which module. The structure is read from the model; the words
are written by the agent you choose (see AI on your terms), and say so.

- **Every microflow and nanoflow, drawn.** Step by step in words, with a
  variable traced through the flow, or exactly as Studio Pro lays it out,
  with each activity's properties. Pages are drawn as Studio Pro's page
  editor draws them, with what is shown or editable only on a condition.
- **The domain model, one module at a time**, and for every entity who may
  read, write, create and delete it — and on which rows.
- **One file to send.** The whole documentation as one HTML file that opens
  offline in any browser, or as Markdown; or kept in the Mendix project's
  git (`mxscout/`), for the team, beside the app.

### Review

**Risks ranked P1 to P3**, grouped by pattern — missing access checks,
secrets in the model, commits in loops, errors that vanish, switched-off
events a process relies on — each with what happens, where and what to do — written
by mendix-describe, the agent that writes the documentation.

- **Model quality**: checks read straight from the model against Mendix's
  own guidelines, no AI needed. **For developers**: where things are, the
  naming conventions, and what breaks easily.

### AI on your terms

**MxScout runs no AI; it works with yours**, and marks every sentence an
agent wrote as the agent's. Three Claude skills ship with it:
`/mxscout-project` opens any of your projects by name, **mendix-describe**
writes the documentation and keeps it current when the model changes, and
**mendix-assist** checks a Service Desk ticket against the model, works
out a Jira issue or an idea, and keeps each as an Assist item with its
status. `skills/install.sh --codex` installs them for Codex too.

- **Copilot, or any chat assistant.** Put the entities, flows and pages you
  are talking about into the **Context**, copy one prompt, work the solution
  out, paste the JSON back: a Workbook item with a business and a technical
  description, the technical one with those elements appended for whoever
  builds it.
- **Solved cases**: what stayed behind when a ticket was solved, in
  `knowledge/`, for the next one — and for the agent, which reads them first.

### Projects, folders and teams

**Every project says where it is kept** — this browser only, a folder of
its own, your MxScout folder, or its Mendix project (`mxscout/`) — and what
that means for Claude. Set your MxScout folder and the language Claude
writes in once; nothing of yours goes into a Mendix project unless you put
it there.

- **Packages**: a project as one AES-256-GCM file for a colleague,
  WebCrypto only, opened with an access code shown once.
- **Export documentation**, on the projects page: the documentation of many
  projects in one encrypted file — the model, the descriptions and the solved
  cases of each, nothing else — and, on import, only the ones you tick.

### Developer tools, per project

**Off by default, a switch in a project's Settings.** On, the project also
shows the Live app (its data, and running a flow in your own signed-in app
tab), Performance recordings through the admin port of a non-production
app, Logs, Comments with the review report, deciding about risks (mark
one fixed or a false positive and it stays decided), MxScaffold drawings,
and the Security screen.

### Credits

**Log analysis is brought over from MxDevSwissTool**
([github.com/RealMecowhy/MxDevSwissTool](https://github.com/RealMecowhy/MxDevSwissTool)),
by RealMecowhy, under the MIT licence — see THIRD-PARTY-NOTICES.md.
