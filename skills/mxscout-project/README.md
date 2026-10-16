# mxscout-project

A Claude skill that settles **which Mendix application a conversation is
about**, from your library of MxScout projects, and loads its documentation.

## The library

One folder on disk with a folder of its own for each project — for example
`~/MxScout-projects`. You get one in MxScout:

- **Documentation someone sent you** — New project, pick the
  `mxscout-documentation-….mxscout` file, enter the access code, and choose
  **In a library folder on disk**: each project goes into a folder of its own
  there.
- **Your own projects** — **Move all projects to folders…** on the projects
  list, into the same folder.

The library can be a git repository, to share it with your team.

## Using it

In Claude Code:

```
/mxscout-project
```

lists your projects and asks which one; `/mxscout-project Order Portal` loads
that one straight away. Claude says in a few lines what the application is,
and from then on answers about it — how it works (mendix-describe), tickets,
Jira issues, ideas and notes (mendix-assist). "Switch to …" changes the
project.

The first time, it asks where your library is and remembers it in
`~/.mxscout/library.json`; `MXSCOUT_PROJECTS` set in your environment wins.

## What it writes

Only `~/.mxscout/library.json`. It reads the library and never writes into it
or into a Mendix project; descriptions, tickets and notes go through the
mendix-describe and mendix-assist skills, which keep their working files
outside.

Install it with MxScout's `skills/install.sh` (or `install.ps1` on Windows),
beside mendix-describe and mendix-assist.
