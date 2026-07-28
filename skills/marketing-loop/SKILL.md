---
name: marketing-loop
description: Improve user-facing copy in a configured source catalogue. Use for headlines, CTAs, empty states, errors, landing pages, onboarding, store listings, metadata, and email copy. It never reads application code or target locales and requires human approval before source edits.
---

# Marketing loop

Marketing-loop is a catalogue-only producer. It reads and writes only the configured source catalogue. Never inspect or modify application code or target locales.

If language-loop is available, use the lifecycle below. It extracts hardcoded text first, and it translates only after marketing decisions have settled:

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

Marketing-loop also works without language-loop: configure a source catalogue and run `scan`, `propose`, `review`, and `apply`. Approved source edits make translations stale; marketing-loop never rewrites those translations.

## Workflow

```bash
npx marketing-loop scan
npx marketing-loop propose
npx marketing-loop import
npx marketing-loop review --ui
npx marketing-loop apply
```

Read `.marketing-loop/brief.md`. Use only its source-catalogue context, `marketing-data/`, `allowedClaims`, and the marketing config. Write open-item responses only to `.marketing-loop/agent-output.json`, using the exact schema version 5, `runId`, `inventoryDigest`, and `copyId` values. Import validates this untrusted file; humans approve before apply.

## Copy constraints

- Sell the reader's problem and outcome, not product mechanics.
- Give a real alternative for every proposal.
- Never invent facts, numbers, testimonials, timings, or guarantees. Use `NEEDS-FACT: <question>` instead.
- Never use dark patterns.
- Never edit code, target locales, or canonical marketing state directly.

## Reference

- `references/psychology.md` — persuasion principles and abuse cases
- `references/diagnostics.md` — rules used by the analyser
