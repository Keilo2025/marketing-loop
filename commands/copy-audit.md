---
description: Audit the user-facing copy in this repo and report what is costing conversions — no changes made
argument-hint: "[optional: path, route, or surface to focus on]"
allowed-tools: Bash, Read, Glob, Grep
---

Audit the copy in this repository. Scope: $ARGUMENTS

```bash
npx marketing-loop@latest scan
```

Then read `.marketing-loop/findings.json`, `.marketing-loop/product.json` and `.marketing-loop/behavior.json`, and write the user a report. Do not change any files.

Structure it like this:

## What this product actually does

One paragraph, written from the code — not from the README's own description of itself. Where the code and the marketing disagree, that gap is usually the most valuable finding in the audit.

## The five strings costing you the most

For each, in priority order:

- the string, with `file:line`
- what is wrong with it, in one sentence a founder would agree with
- what it should be doing instead — the direction, not the finished copy
- the evidence: the diagnostic rule, plus any behavioural data pointing at it

## Patterns

Rules that fired repeatedly are worth more than any individual string, because they tell you how the team writes. "Every CTA on the site is generic" is a fixable habit; one bad button is a typo.

## What you cannot fix with copy

Be straight about this. If the funnel drops 60% at a form with four required fields, that is not a headline problem. Say so.

## What to do next

If `marketing-data/` was empty, say which single export would sharpen the priority order most and where to get it.

Then offer to run `/marketing-loop` to generate actual rewrites.
