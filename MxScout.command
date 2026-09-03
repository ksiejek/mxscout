#!/bin/sh
# MxScout - double-click this file in Finder to start MxScout and open it in
# your browser. It is the same thing as running ./start.sh in a terminal, only
# reachable without one: nothing is installed system-wide, and closing the
# Terminal window stops MxScout.
cd "$(dirname "$0")" || exit 1

PORT="${MXSCOUT_PORT:-4288}"
URL="http://127.0.0.1:$PORT"
# The Node line to fetch if this machine has none. Bump it here, in one place,
# when the line goes out of support.
NODE_LINE="latest-v22.x"

# Already running? Then just open the copy that is there, rather than starting
# a second server that would only fail on the port.
if command -v curl >/dev/null 2>&1 && curl -s -m 2 -o /dev/null "$URL/api/health" 2>/dev/null; then
  echo "MxScout is already running - opening it in your browser."
  open "$URL" 2>/dev/null
  exit 0
fi

# A Node.js in this folder wins over the machine's own: a copy of MxScout that
# was handed a runtime runs on a machine that has none installed. start.sh
# picks it the same way, so this only has to put it there.
if [ ! -x "./runtime/bin/node" ] && ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on this machine."
  echo
  echo "MxScout itself has no dependencies at all, but it is a Node program, so"
  echo "it needs one to run. Two ways out:"
  echo
  echo "  1. Install Node.js LTS from https://nodejs.org - the normal way, and"
  echo "     the right one if you can install software on this machine."
  echo "  2. Let MxScout put a copy in its own folder (./runtime, about 60 MB,"
  echo "     downloaded from nodejs.org). Nothing is installed, nothing outside"
  echo "     this folder is touched, and deleting the folder removes it."
  echo
  printf "Download Node.js into this folder now? [y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Nothing was downloaded."; printf "Press Return to close this window. "; read -r _; exit 1 ;;
  esac

  case "$(uname -m)" in
    arm64) plat="darwin-arm64" ;;
    *) plat="darwin-x64" ;;
  esac
  base="https://nodejs.org/dist/$NODE_LINE"
  echo "Asking $base which build is current…"
  file=$(curl -fsSL "$base/" 2>/dev/null | grep -o "node-v[0-9][0-9.]*-$plat\.tar\.gz" | head -1)
  if [ -z "$file" ]; then
    echo
    echo "Could not reach nodejs.org (a company proxy usually explains this)."
    echo "Install Node.js yourself, or unpack a Node build here so that"
    echo "./runtime/bin/node exists, and double-click this file again."
    printf "Press Return to close this window. "; read -r _; exit 1
  fi
  echo "Downloading $file…"
  mkdir -p runtime
  if ! curl -fL --progress-bar -o runtime/node.tar.gz "$base/$file"; then
    echo "The download failed. Nothing was left behind except an empty ./runtime."
    rm -f runtime/node.tar.gz
    printf "Press Return to close this window. "; read -r _; exit 1
  fi
  tar -xzf runtime/node.tar.gz --strip-components=1 -C runtime
  rm -f runtime/node.tar.gz
  if [ ! -x "./runtime/bin/node" ]; then
    echo "The download arrived but did not unpack into ./runtime/bin/node."
    printf "Press Return to close this window. "; read -r _; exit 1
  fi
  echo "Node.js is now in ./runtime - MxScout will use it from here on."
  echo
fi

echo "Starting MxScout... your browser will open by itself in a moment."
echo "Close this window (or press Ctrl-C) when you are done - that stops it."
echo
exec ./start.sh
