#!/bin/sh
# Updates this copy of MxScout from the git repository it was cloned from — and only when you run it.
#
# MxScout itself never does this: the app runs no program and connects nowhere to look for a newer
# version (About & security). This script is the step you take by hand, written down: it runs
# `git pull --ff-only` in this folder, against the repository it was cloned from, and says which version
# you had and which you have now.
#
# It changes nothing it should not: a copy with changes of your own in it, one on a branch that has
# moved apart from the repository's, or a folder that is not a git clone is left exactly as it is, and the
# script says why. It never stashes, resets or forces anything. No dependencies but git.
#
#   ./update.sh            update, then say what changed (the app shows the rest: What's new)
#   ./start.sh --update    the same, then start MxScout
cd "$(dirname "$0")" || exit 1

version() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json 2>/dev/null | head -n 1; }

if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed, so this copy cannot update itself. Download the newest MxScout and replace this folder (your projects are in your browser and your MxScout folder, not here)." >&2
  exit 1
fi
if [ ! -d .git ]; then
  echo "This folder is not a git clone of MxScout, so there is nothing to pull. Replace it with a newer copy instead (your projects are not in it)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "This copy has changes of its own (git status lists them), so it is left as it is. Commit or undo them, then run this again." >&2
  exit 1
fi

before="$(version)"
if ! git pull --ff-only; then
  echo "Not updated: the pull could not fast-forward (this branch and the repository's have moved apart, or the repository could not be reached). Nothing was changed." >&2
  exit 1
fi
after="$(version)"
if [ "$before" = "$after" ]; then
  echo "MxScout $after — already the newest version on this branch."
else
  echo "MxScout updated: $before → $after. Restart it if it is running; it shows what changed (What's new)."
fi
