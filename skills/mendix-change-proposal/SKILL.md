---
name: mendix-change-proposal
description: Propose a change to a Mendix model as a file that can be drawn. Reads an exchange file written by MxScout (`mxscaffold: "flows"` or `"domain-model"`), writes a changed copy plus the reasoning behind it, and checks the result against what the reader on the far side actually accepts. Use when asked to redesign, extend, split or restructure a microflow, nanoflow or domain model that came out of a real Mendix project.
---

# Proposing a change to a Mendix model

MxScout reads a `.mpr` and hands out a JSON file. MxScaffold imports that file
and draws it. This skill is the step in between: **read the file, make the
change that was asked for, and write a second file plus an explanation** — so
the proposal is something to look at on a canvas, next to the original, rather
than a description of a drawing.

You are not reviewing anybody's Mendix. Neither tool validates these files on
purpose: telling a developer their working microflow "has no end event" is
judging Mendix, not helping. Change what was asked for and leave the rest.

## What you produce

Two files, next to the input:

1. `<name>.proposal.json` — the same format as the input, carrying the changed
   model.
2. `<name>.proposal.md` — what changed, why, what to look at on the drawing,
   and what you deliberately did not change.

Then tell the person to import the JSON in MxScaffold — the **Import** button
above the canvas on the Workflow screen, **Import ▾** on the Domain model
screen — and to open both documents.

## The rules that decide whether the proposal is visible at all

These are not style preferences. Each one is something the importer on the far
side does, and getting it wrong means the proposal silently does nothing.

**A changed flow needs a new name.** `mergeFlows.ts` matches a flow on the pair
(module, name) and **never overwrites** one that is already there — it reports
it as "already here, left unchanged". A proposal that keeps the original's
qualified name imports as nothing at all. Give it a distinct name, keep the
module:

```
"name": "Sales.ACT_Order_Confirm"   →   "name": "Sales.ACT_Order_Confirm_Proposal"
```

Say in the rationale which document it is meant to replace. Renaming back is
the person's job inside Studio Pro, not something a file can do for them.

**A domain model proposal behaves differently, and the asymmetry matters.** An
entity matched by qualified name is *not* skipped: `merge.ts` keeps it and
**adds the attributes it does not have yet**, by name. So:

- adding an attribute to an existing entity — write it, it lands in place;
- adding an entity, an association or an enumeration — write it, it lands;
- changing an attribute's type, renaming it, removing anything — **the file
  cannot say this.** Existing attributes are never touched. Write it in the
  rationale as prose, or propose a new entity beside the old one and say so.

**Never invent a step `type`.** The reader checks `type` against its own
catalog of 64 element types (listed in `check-proposal.js`). A type it does not
know does not fail — it is drawn as an **annotation** carrying `Mendix: <what
you wrote>`, plus a warning. That is deliberate on both sides: a plausible
wrong activity is worse than a visible gap. If no type fits what you mean, use
`"kind": "annotation"` and say it in words.

**Give positions.** A step without `at` lands at `{x: 0, y: 0}`, so a proposal
written without positions imports as one pile. Copy the original's coordinates
for steps you kept, place new ones in the gaps (the files use ~180 px between
step centres horizontally, ~120 px vertically), and tell the person about the
**Auto-arrange** button if you would rather it laid itself out.

**Branch outcomes live on the edges, not on the step.** A `decision` gets its
outcomes from the `caseValue` of the edges leaving it. Two edges with
`"caseValue": "true"` and `"false"` make a boolean split; other values make it
an enumeration split. A decision whose edges carry no `caseValue` draws with no
labelled outlets.

## How to work

1. **Read the input file.** `reference/flows-file.md` and
   `reference/domain-model-file.md` describe every field the reader looks at
   and what it does with it. Read the one that matches `mxscaffold`.
2. **Say what you are about to change, before changing it.** One or two
   sentences. If the request is ambiguous — "add error handling" can mean an
   error outlet, an error event, or a surrounding retry — ask rather than pick.
3. **Copy, then edit.** Start from the input document, keep every field you are
   not changing, including `at`, `size`, `fromSide`, `toSide` and the vectors:
   they are the drawing the person already recognises.
4. **Check it**, from this directory:

   ```bash
   node check-proposal.js proposal.json --against original.json
   ```

   `--against` is what catches the name collision, so pass it whenever you have
   the original. Errors mean the reader will drop something; warnings mean it
   will draw something other than what you may have meant. Fix errors before
   handing the file over.
5. **Write the rationale.** Short, concrete, and honest about limits:

   ```markdown
   # <what this proposes>

   ## What changed
   - <each change, in the terms of the drawing: "the Retrieve now sits inside
     the loop", not "node n4 moved">

   ## Why
   <the reasoning, tied to what the original actually does>

   ## What to look at
   <which document to open, next to which>

   ## What this does not change
   <anything you left alone on purpose, and anything the file format cannot
   express — see the domain model rule above>
   ```

## Where the files come from

MxScout writes them from a real `.mpr`. In the flow popup the button is
**Export drawing** (that one flow); on the Microflows and Nanoflows lists it is
**Export N drawings**, and the number *is* the scope — it counts what the
filters above leave on screen, so clearing them exports the project. Both
produce the same shape of file, named `mxscout-flows-<project>-<date>.json`;
the importer cannot tell which button made it.

The file never leaves the browser on its own — it is a download, and MxScout
opens no connection to produce it. Everything in it is already in the person's
project; it carries no credentials and no runtime data.
