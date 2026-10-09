# Describing a Mendix app with AI, from MxScout

How to have an AI agent write the business descriptions for a project you
have in MxScout: what the application is for, its main processes and its
modules — each as a short summary and a long description of several
paragraphs — and a sentence or two on each microflow and nanoflow. MxScout reads the
model; it does not write prose about it. This skill does, on your machine,
from a file MxScout exports — no MCP server, no Studio Pro, no connection to
anything.

`SKILL.md` in this folder is what the agent reads. This file is for you.

## What you need

- MxScout, with the project loaded.
- [Claude Code](https://claude.com/claude-code), or another coding agent that
  reads skills.

## 1. Install the skill (once)

Copy this folder into your skills folder:

```bash
cp -r skills/mendix-describe ~/.claude/skills/
```

On Windows that is `C:\Users\<you>\.claude\skills\mendix-describe`.

## 2. Export the AI pack

In MxScout: open the project → **Documentation** → **Export AI pack**.

You get `<Project>.mxscout-ai-pack.md`: the model as the documentation reads
it — every own module, its entities, and every flow step by step with the
values each step sets. Marketplace modules are left out. Put it in a folder
of its own, for example next to the project.

The pack is **not encrypted**. It is meant for an agent on your machine; keep
it where you keep the project.

## 3. Run the skill

Open Claude Code in that folder and ask, for example:

```
Run the mendix-describe skill on <Project>.mxscout-ai-pack.md.
Write the descriptions in English, for a business reader: they have to make
sense, you may be creative, but never invent what the model does not show.
Work module by module, in parallel subagents: per module a
descriptions.<Module>.json and a notes.<Module>.md. Then write the overview of
the application and its main processes from the notes — for the application,
each process and each module both layers of reference/business-narrative.md,
a summary and a long description — merge everything into
descriptions.json and check it with check-descriptions.js. Read long flows in
full, never from a truncated excerpt. At the end, tell me how many were
described, what stayed unclear, and how many tokens it took.
```

The same in Polish:

```
Uruchom skill mendix-describe na paczce <Projekt>.mxscout-ai-pack.md.
Opisy po polsku, z perspektywy biznesu: ma to mieć sens, możesz być
kreatywny, ale nie wymyślaj faktów, których nie ma w modelu.
Rób to moduł po module, równolegle subagentami: na każdy moduł
descriptions.<Moduł>.json i notes.<Moduł>.md. Potem z notatek napisz
opis aplikacji i główne procesy — dla aplikacji, każdego procesu i każdego
modułu obie warstwy z reference/business-narrative.md, podsumowanie i długi
opis — scal wszystko w descriptions.json
i sprawdź check-descriptions.js. Długie flowy czytaj w całości, nie
z ucinanych fragmentów. Na koniec podaj, ile opisano, co zostało
niejasne i ile tokenów to zużyło.
```

For a large project, add: *"Keep your progress in RESUME.md so the work can
be resumed in a new session."*

## 4. Import the result

In MxScout: **Documentation** → **Import descriptions…** → pick
`descriptions.json`.

The descriptions appear in the previews and in the exported documentation
file, each marked **✦ AI**, so a reader can always tell what an agent wrote
from what the model says.

## When the model changes

Export a new pack. Every flow in it carries a fingerprint, so MxScout marks a
description whose flow changed as out of date instead of passing it off as
current, and the checker lists only what is left to do:

```bash
node ~/.claude/skills/mendix-describe/check-descriptions.js todo <Project>.mxscout-ai-pack.md descriptions.json
```

The other two commands:

- `check <pack> <descriptions.json>` — checks a file against the pack before
  you import it.
- `merge <out.json> <part.json> …` — joins per-module parts into one file.

The formats are in `reference/pack-format.md` and
`reference/descriptions-format.md`.
