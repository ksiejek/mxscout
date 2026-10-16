---
name: mxscout-project
description: Pick which Mendix application this conversation is about, from the person's library of MxScout projects (documentation they received or made — one folder per project), and load its documentation, so every question after it is answered about that app. Lists the projects, lets the person choose from the list or by name, reads the chosen project's documentation and says in a few lines what the app is. Then mendix-describe answers how it works and mendix-assist works out tickets, Jira issues and ideas on it. Never writes into the library or a Mendix project except through those skills. Use when started with /mxscout-project (optionally with a project's name), or asked "which projects do I have", "switch to the project …", "pracujemy na projekcie …", "wybierz projekt", "jakie mam projekty", "przełącz na …".
---

# mxscout-project: which application we are talking about

The person has a **library of MxScout projects**: one folder on disk with a
folder of its own for each Mendix application — the documentation someone sent
them (MxScout's **Export documentation…**, imported into a library folder) or
their own projects (**Move all projects to folders…**). Each project folder
holds `documentation.md` (what the app is, its processes, modules, risks),
`ai-pack.md` (the model, the evidence), `descriptions.json`, `knowledge/` (solved
cases) and `project.json`. A Mendix project kept with `mxscout/` inside it, in
the same library folder, counts too.

This skill does one thing: **it settles which of those applications the
conversation is about**, and loads it. After that, everything the person asks
is about that app.

## Keep everything clean

**Write nothing into the library or into any Mendix project yourself.** This
skill only reads. The one file its script writes is `~/.mxscout/library.json`
(where the library is), with `set`. Descriptions, tickets, notes and solved
cases go through mendix-describe's and mendix-assist's `agent.js`, which keep
working files in their work folder and write only what MxScout reads. The
library may be a git repository: whatever lands in it goes into the next
commit, so nothing of yours does. Never commit.

## How to start

`projects.js` is in this skill's folder; run it by its full path.

1. **Where is the library?** `node projects.js where`. If there is none yet,
   ask the person in one line: "Which folder holds your MxScout projects? (the
   library folder you chose when you imported the documentation)". Then
   `node projects.js set <folder>`; it is remembered from then on.
   `MXSCOUT_PROJECTS`, when set, wins.
2. **Which project?**
   - Started with a name (`/mxscout-project Order Portal`, "switch to the
     order portal"): `node projects.js show <name>`. One match: that is the
     project. Several: list them and ask which. None: say so and list the
     library.
   - Started without one: `node projects.js list` and show the person the
     numbered list as it prints — name, described or model only, the model's
     version. Ask: "Which one? A number or a name." `--find <words>` narrows
     a long list. Then `node projects.js show <n | name>`.
3. **Load it.** Read the chosen project's `documentation.md` — the whole of
   it when it is short, otherwise its first part (what the app is for, who uses
   it, its processes and modules) and its table of contents — and keep its
   folder's path. If it has no documentation yet ("model only"), say so: the
   model is there (`ai-pack.md`), and mendix-describe can describe it.
4. **Say it back** in three to five lines, in the project's language (or the
   person's): the project's name, what the application is for, its main
   processes or modules, the model's version, and that you will answer about
   it from now on. Then stop and wait for the question.

## From then on

- **"How does …", "who can …", "where is …"** — mendix-describe, on the
  project's folder: `node <skills>/mendix-describe/agent.js … --folder <the
  project's folder>`, following that skill (the documentation is the map, the
  pack is the proof).
- **A ticket, a Jira issue, an idea, a note to keep, a description of a
  change** — mendix-assist, on the same folder.
- **Another project** ("switch to …", "a teraz projekt …"): run step 2 again.
  Say which project you leave and which you load; never mix two projects in
  one answer unless the person asks to compare them.
- The project is the conversation's, not a setting: a new conversation starts
  with `/mxscout-project` again.

If the mendix-describe or mendix-assist skill is not installed beside this one,
answer from `documentation.md` and `ai-pack.md` yourself, say what you read, and
tell the person that installing them (MxScout's `skills/install.sh` or
`install.ps1`) lets you check answers against the model and keep their work.

## Files

- `projects.js` — `where`, `set <folder>`, `list [--find words]`, `show <n | name>`.
- `README.md` — for the person: what the library is and how to get one.
