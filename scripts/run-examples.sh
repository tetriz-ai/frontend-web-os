#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Runs every example under examples/ that has a run.sh, with exactly the command in the ```sh
# block of its README.md, from the repo root, and compares standard output with the last fenced
# block of that README. On a mismatch it prints the diff and the command's standard error.
# CI's Examples job runs this same script.
set -u
cd "$(dirname "$0")/.." || exit 2
status=0
for readme in examples/*/README.md; do
  dir=$(dirname "$readme")
  if [ ! -e "$dir/run.sh" ]; then
    echo "skip  $dir (no run.sh; its README has its own commands)"
    continue
  fi
  if [ ! -x "$dir/run.sh" ]; then
    echo "FAIL  $dir (run.sh isn't executable: chmod +x $dir/run.sh)"
    status=1
    continue
  fi
  cmd=$(awk '/^```sh$/{f=1;next} /^```$/{if(f){exit}} f' "$readme")
  expected=$(awk '/^```/{if(f){f=0;next} f=1; buf=""; next} f{buf=buf $0 "\n"} END{printf "%s", buf}' "$readme")
  tmp=$(mktemp -d) || exit 2
  actual=$(NO_COLOR=1 sh -c "$cmd" 2>"$tmp/stderr")
  if [ "$actual" = "$expected" ]; then
    echo "ok    $dir"
  else
    echo "FAIL  $dir"
    printf '%s\n' "$expected" > "$tmp/expected"
    printf '%s\n' "$actual" > "$tmp/actual"
    diff -u "$tmp/expected" "$tmp/actual" | sed 's/^/      /'
    if [ -s "$tmp/stderr" ]; then
      echo "      standard error:"
      sed 's/^/      /' "$tmp/stderr"
    fi
    status=1
  fi
  rm -rf "$tmp"
done
exit $status
