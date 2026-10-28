---
max_turns: 6
allowed_tools: [Skill]
tags: [tests]
---

Use the fwos:test-planner agent to write the test plan for this spec. Give it the text below and
return what it writes, unchanged.

### AC-reading-1: Saving a link puts it first
- Given an empty list, when I save https://example.com/a, then it is the first row with title "example.com".
- Proven against: local
- Release: first

### AC-reading-2: The zero state invites the first save
- Given no saved links, when I open the app, then I see "Save your first link" and the URL field is focusable.
- Proven against: local
- Release: first

### AC-reading-3: Data survives a reload
- Given one saved link, when I reload the page, then the link is still listed.
- Proven against: local
- Release: first
