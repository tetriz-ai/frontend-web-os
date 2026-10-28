Lock an existing test by its content hash, edit it through the shell, and see `tests/locked` fail. A named reviewer unlocks it with a reason before the revised file is locked again. This synthetic example runs offline in a temporary project that it removes on exit.

`--existing` describes a characterisation test. New behaviour needs `--red` and a failing run first.

```sh
examples/protect-locked-tests/run.sh
```

```text
ok        tests/list.test.mjs
changed   tests/list.test.mjs
check after edit: exit code 1
unlocked  tests/list.test.mjs (unlocked by Jane Doe: The requirement changed)
ok        tests/list.test.mjs
check after relock: exit code 0
```
