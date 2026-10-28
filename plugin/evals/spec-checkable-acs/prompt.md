---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
tags: [spec]
---

You're in the fwos spec step for a reading-list app (single device, data saved locally). The approved
brief says: save a link with an optional title, list newest first, mark read or unread, filter
All / Unread / Read, delete with undo. The list page's states in ia.json are: loading, empty,
filtered-empty, error, ready. The user also said "it should feel fast".

Write only section 10 of the spec (Acceptance criteria) in fwos's AC format. Use the feature id
`reading`.
