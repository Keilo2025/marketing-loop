---
description: Improve the configured source-catalogue copy, then open human review
argument-hint: "[optional: source namespace to focus on]"
allowed-tools: Bash, Read, Write, Edit
---

Marketing-loop reads only the configured source catalogue. Never open or change application code or target locales.

If `language-loop` is available, establish messages before marketing and translate only after decisions settle:

```bash
language-loop scan
language-loop extract
marketing-loop propose
marketing-loop review
marketing-loop apply
language-loop translate
language-loop judge
language-loop apply
```

Without language-loop, marketing-loop is standalone: configure the source catalogue, then use the marketing commands below.

If `marketing-loop.config.json` is absent, run `npx marketing-loop@latest init`. Ask the product owner for `audience` and `allowedClaims`; do not infer either from code. If `marketing-data/` is empty, explain that priorities are a hypothesis.

```bash
npx marketing-loop@latest propose
```

Read `.marketing-loop/brief.md`. Use only source-catalogue text, approved claims, marketing data, and the brief. Write open-item responses only to `.marketing-loop/agent-output.json`, then validate them:

```bash
npx marketing-loop@latest import
npx marketing-loop@latest review --ui
```

Summarise the highest-value proposals and every `NEEDS-FACT` question. Do not run `apply` unless the user asks. Explain that approved source edits make translations stale; marketing-loop never updates target locales.
