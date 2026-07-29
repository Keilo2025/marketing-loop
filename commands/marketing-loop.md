---
description: Run one filtered marketing and translation Content Loop
argument-hint: "[optional: --types cta,headline --groups hero --locales de,fr]"
allowed-tools: Bash, Read, Write, Edit
---

Marketing-loop is the primary Content Loop app. Its marketing stage reads only
the configured source catalogue. Never open or change application code or
target locales on behalf of that stage; the imported Language Loop engine owns
translation.

If `language-loop` is available, establish messages first, then use the one
resumable command:

```bash
language-loop scan
language-loop extract
npx marketing-loop@latest content $ARGUMENTS
```

Without language-loop, marketing-loop is standalone: configure the source catalogue, then use the marketing commands below.

If `marketing-loop.config.json` is absent, run `npx marketing-loop@latest init`. Ask the product owner for `audience` and `allowedClaims`; do not infer either from code. If `marketing-data/` is empty, explain that priorities are a hypothesis.

Run `npx marketing-loop@latest content plan $ARGUMENTS` first when filters were
requested. Confirm its types/groups/exact keys and target languages, then run
`npx marketing-loop@latest content $ARGUMENTS`. It will propose and pause for
human review.

Read `.marketing-loop/brief.md`. Use only source-catalogue text, approved claims,
marketing data, and the brief. Write open-item responses only to
`.marketing-loop/agent-output.json`, then validate them without widening the
persisted Content selection:

```bash
npx marketing-loop@latest import
npx marketing-loop@latest review --ui
```

Summarise the highest-value proposals and every `NEEDS-FACT` question. Do not run `apply` unless the user asks. Explain that approved source edits make translations stale; marketing-loop never updates target locales.

After explicit approval, rerun `content`; use `content --llm` for provider-backed
translation. Do not report completion until status shows every selected message
accepted in every selected language. A partial batch, rework item, or
`needs-human` language is not complete.
