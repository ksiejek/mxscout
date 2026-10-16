#!/usr/bin/env bash
# Installs MxScout's three skills, mendix-describe, mendix-assist and mxscout-project, for Claude Code on this machine — and, when
# asked, for Codex (macOS, Linux). For someone who works without a Mendix project that already carries them in
# .claude/skills/.
#
#   skills/install.sh                links them into ~/.claude/skills/ — `git pull` in this folder updates them
#   skills/install.sh --copy         copies them instead — run it again after `git pull` to update
#   skills/install.sh --codex        also for Codex: into ~/.agents/skills/ (where Codex looks now) and
#                                    ~/.codex/skills/ (the older place it still reads)
#   skills/install.sh --codex-only   only for Codex, into both of those (either one combines with --copy)
#
# ~/.codex is $CODEX_HOME when that is set (Codex's own variable).
# They go side by side, because mendix-assist uses ../mendix-describe. In each skills folder it touches
# mendix-describe, mendix-assist and mxscout-project and nothing else: a link there is replaced, a copy this script made is
# replaced, and any other folder there is moved to the skills-backup folder beside it
# (~/.claude/skills-backup/<name>-<date>, ~/.agents/skills-backup/…, ~/.codex/skills-backup/…), never deleted.
# No dependencies (bash, ln, cp, mv), no administrator rights. MxScout itself never runs this.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
MARK=".installed-by-mxscout"
MODE=link
CLAUDE=yes
CODEX=no
usage() { echo "usage: $0 [--copy] [--codex | --codex-only]" >&2; exit 2; }
for arg in "$@"; do
  case "$arg" in
    --copy) MODE=copy ;;
    --codex) [ "$CLAUDE" = yes ] || usage; CODEX=yes ;;
    --codex-only) [ "$CODEX" = no ] || usage; CODEX=yes; CLAUDE=no ;;
    *) usage ;;
  esac
done

for name in mendix-describe mendix-assist mxscout-project; do
  if [ ! -f "$HERE/$name/SKILL.md" ]; then
    echo "No $HERE/$name/SKILL.md — run this script from the MxScout folder you cloned." >&2
    exit 1
  fi
done

# install_into <skills folder> <its backup folder>
install_into() {
  local dest="$1" backup="$2" name src target moved
  mkdir -p "$dest"
  for name in mendix-describe mendix-assist mxscout-project; do
    src="$HERE/$name"
    target="$dest/$name"
    if [ -L "$target" ]; then
      rm "$target"
    elif [ -f "$target/$MARK" ]; then
      rm -rf "$target"
    elif [ -e "$target" ]; then
      mkdir -p "$backup"
      moved="$backup/$name-$(date +%Y%m%d-%H%M%S)"
      mv "$target" "$moved"
      echo "moved the old $name to $moved"
    fi
    if [ "$MODE" = link ]; then
      ln -s "$src" "$target"
      echo "linked $target -> $src"
    else
      cp -R "$src" "$target"
      printf '%s\n' "Copied from $src by MxScout's skills/install.sh --copy. Run it again after git pull to update." > "$target/$MARK"
      echo "copied $src -> $target"
    fi
  done
}

if [ "$CLAUDE" = yes ]; then install_into "$HOME/.claude/skills" "$HOME/.claude/skills-backup"; fi
# Codex: ~/.agents/skills is where it looks for a user's skills now; $CODEX_HOME/skills it still reads, marked
# deprecated in its source (checked 2026-10-15) — both, so an older and a newer Codex find them.
if [ "$CODEX" = yes ]; then install_into "$HOME/.agents/skills" "$HOME/.agents/skills-backup"; install_into "$CODEX_DIR/skills" "$CODEX_DIR/skills-backup"; fi

restart="Claude Code"
if [ "$CODEX" = yes ]; then restart="Claude Code and Codex"; fi
if [ "$CLAUDE" = no ]; then restart="Codex"; fi
echo
if [ "$MODE" = link ]; then
  echo "Done. Restart $restart. To update: git -C \"$(dirname "$HERE")\" pull — the links follow it."
else
  echo "Done. Restart $restart. To update: git -C \"$(dirname "$HERE")\" pull, then run this script again with the same options."
fi
if [ "$CLAUDE" = yes ]; then echo "Check it: in Claude Code, type /mxscout-project or /mendix-assist, or ask \"use mendix-describe on <folder>\"."; fi
if [ "$CODEX" = yes ]; then echo "Check it: in Codex, ask \"use the mendix-assist skill\", or \"use mendix-describe on <folder>\"."; fi
