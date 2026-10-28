# Evals

Cases for `claude plugin eval`, named `<module>-<case>`. They check the behaviours a deterministic
check can't: does discovery ask before it assumes, are ACs checkable, does the planner follow the
format, are secrets kept out of chat. `fwos check` covers everything mechanical, with fixtures.

Run them locally, or by hand from the Evals workflow in GitHub Actions. They call a model, so they cost money and never run on pull requests:

```bash
claude plugin eval plugin --trust-plugin --no-publish --max-cost-usd 5
claude plugin eval plugin --case "discovery-*" --runs 1 --trust-plugin --no-publish
```

Each run compares the plugin against a no-plugin baseline and reports the gap. Record the tested
model IDs and Claude Code version in `MODELS.md` and re-baseline when they change.
