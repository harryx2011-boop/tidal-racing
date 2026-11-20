#!/bin/bash
# A queue for headless renders: at most two browsers at once on this machine, across every worktree.
# Same arguments as drive.mjs:  PORT=5181 tools/shot.sh out.png "q=medium&scale=1" "<script>" 1280 720
here="$(cd "$(dirname "$0")" && pwd)"
while :; do
  for n in 1 2; do
    exec {fd}>"/tmp/tidal-shot-$n.lock"
    if flock -n "$fd"; then node "$here/drive.mjs" "$@"; exit $?; fi
    exec {fd}>&-
  done
  sleep 3
done
