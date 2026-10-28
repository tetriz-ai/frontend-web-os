# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT

Output .github/assets/demo.gif
Require node
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 17
Set Width 1100
Set Height 530
Set Padding 20
Set Theme "GitHub Dark"
Set Framerate 12
Hide
Type "exec env PS1='$ ' bash --noprofile --norc"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms
Show
Type@15ms "node plugin/dist/fwos.mjs check tests/traceability --dir examples/prove-every-requirement/project"
Enter
Sleep 6s
