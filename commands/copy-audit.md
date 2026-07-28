---
description: Audit configured source-catalogue copy without changing files
argument-hint: "[optional: source namespace to focus on]"
allowed-tools: Bash, Read
---

Marketing-loop reads only the configured source catalogue. Never open application code or target locales, and change nothing.

If language-loop is available, run `language-loop scan` and `language-loop extract` before this audit. Marketing-loop can also run standalone once a source catalogue is configured.

```bash
npx marketing-loop@latest scan
```

Read `.marketing-loop/findings.json`, `.marketing-loop/inventory.json`, `.marketing-loop/brief.md`, and `.marketing-loop/behavior.json`. Report the source-catalogue strings costing the most, recurring diagnostic patterns, and unanswered facts. Ground every claim in the catalogue, approved claims, marketing data, or the brief.

State that source edits make translations stale and that language-loop translates only after marketing decisions are final. Offer `/marketing-loop` for rewrites; never offer to modify target locales.
