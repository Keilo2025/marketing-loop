---
name: marketing-loop
description: Rewrite product copy so it sells the problem it solves rather than the feature that solves it. Use whenever the user asks to write, improve, review or fix user-facing copy — headlines, hero sections, CTAs, buttons, empty states, error messages, landing pages, pricing pages, onboarding, app store listings, meta descriptions or email templates. Also trigger on "my landing page isn't converting", "make this copy better", "why is nobody signing up", "write the marketing for this app", "improve my CTA", "this copy is too salesy", "make it sell", "conversion copy", or when the user shares analytics showing a drop-off and asks what to change. Always use this skill rather than writing copy freehand — it reads the codebase first, checks the claim against the code, and routes every change through a human approval gate.
---

# Marketing loop

## What this is for

Most AI-written product copy fails the same way: it describes the software. "Advanced analytics dashboard with real-time sync." Nobody wakes up wanting a dashboard. They wake up not knowing whether last week was good or bad, and hating that feeling.

This skill closes that gap by reading the code before writing a word, so the copy is grounded in what the product genuinely does — and by refusing to ship anything a human has not read.

## The loop

```bash
npx marketing-loop scan      # find every user-facing string, diagnose each one
npx marketing-loop propose   # engine rewrites what it can prove; writes brief.md for you
npx marketing-loop import    # validate your agent-output.json into the active run
npx marketing-loop review    # human approves — markdown, or --ui for the canvas
npx marketing-loop apply     # writes only what the human approved
```

If `marketing-loop` is not installed, use `npx marketing-loop@latest`. No global install needed.

## Your job, step by step

### 1. Scan and propose

```bash
npx marketing-loop propose
```

This writes four things into `.marketing-loop/`:

| file | what it holds |
| --- | --- |
| `product.json` | what the codebase says this product does — routes, capabilities, integrations, pricing tiers |
| `behavior.json` | whatever was in `marketing-data/` — funnels, drop-offs, CTR, human notes |
| `proposals.json` | rewrites the deterministic engine could make without inventing anything |
| `agent-output.json` | the only state file you may write; the CLI treats it as untrusted |
| `brief.md` | **read this** — the full brief, the open items, and your output schema |

### 2. Read `.marketing-loop/brief.md`

Do not skip it. It contains the product model, the behavioural evidence, the voice constraints, the persuasion library with its abuse cases, and the list of open items — strings the engine deliberately refused to rewrite because doing it well needs judgement about the product.

### 3. Verify before you write

For each open item, go and read the code that implements the thing you are about to make a claim about. If the brief says there is a "bulk import" capability, open the file. Find out what it actually imports, what the limits are, how long it takes. That detail is the copy.

Copy written from a feature list is guesswork. Copy written from the implementation is specific, and specific is what converts.

### 4. Write proposals

Write `.marketing-loop/agent-output.json` using the complete schema and exact `runId` and `inventoryDigest` at the bottom of the brief. Each proposal needs:

- `copyId` from the open item; this is the only target identifier you provide
- `after` — your rewrite
- `alternatives` — at least one genuine second option, because the human should get a real choice
- `rationale` — why this wins, written for a sceptical founder, naming the mechanism and why it applies to this string
- `problemSolved` — the reader's problem, in their words
- `principles` — ids from the persuasion library
- `evidence` — the code fact or data point behind it, or `NEEDS-FACT: <question>` where you need the human to supply something

Do not add `id`, `file`, `line`, `kind`, `before`, `status`, or `author`. The CLI reconstructs those fields from the active inventory so model output cannot redirect or approve its own change.

Validate the file:

```bash
npx marketing-loop import
```

Fix every rejected or blocked entry before handing off.

### 5. Hand back to the human

```
I've written and imported N proposals from .marketing-loop/agent-output.json.
Run `npx marketing-loop review --ui` to approve them.
```

Do not run `apply` unless they explicitly ask you to in this session. The approval gate is the product.

## How to write the copy

**Sell the problem you remove.** Every rewrite should name a situation the reader recognises and the situation they end up in. The feature is how; the reader only cares about what and why.

- *Feature:* "Automated CI/CD pipeline with parallel test execution"
- *Problem:* "Find out your branch is broken in 4 minutes, not after lunch"

**Lead with them.** "We help teams ship faster" is a sentence about you. Delete the first four words and it becomes a sentence about them.

**One idea per string.** If a headline is carrying two, propose the split — first clause stays, second goes to the subhead.

**Specific beats strong.** One checkable number outperforms a paragraph of adjectives. Round numbers read as marketing; precise ones read as evidence. But you may only use numbers that exist in the code, the brief, or `allowedClaims`.

**CTAs name the deliverable.** "Submit" describes the mechanics of the click. "Get my audit" describes what they walk away with, and the possessive gets them holding it before they own it.

**Errors and empty states are conversion surfaces.** They are the two places a user is most likely to leave, and the two places copy is least often thought about. An error that states failure without a recovery path is the most expensive sentence in most products.

## Hard rules

**Never invent a fact.** No user counts, testimonials, percentages, guarantees, timings, awards or customer names — unless they appear in the code, in `allowedClaims`, or in the brief. When a line would be better with a fact you do not have, write it without and put `NEEDS-FACT: how many teams actually use this?` in the evidence array. A missing number the human fills in beats a plausible number that turns out to be false.

**Never produce a dark pattern.** Fabricated urgency or scarcity, confirmshaming, hidden billing, fake live-activity notifications, invented social proof, decline options framed as mistakes. The guardrails reject these before a human sees them, so it is wasted work — but the real reason is that they cost more in refunds and reputation than they earn in signups, and in several jurisdictions they are illegal.

**Copy only.** No component restructuring, no new props, no logic changes, no styling. If the copy fix genuinely requires a structural change, say so in the rationale and let the human decide.

**Never edit source files, `inventory.json`, `proposals.json`, or `decisions.json` directly.** Your only write target is `agent-output.json`; then `marketing-loop import` validates it before the canvas.

## When there is no behavioural data

`marketing-data/` empty means every priority in the brief is a hypothesis. Say so. Then tell the user what one export would sharpen it most — usually a GA4 or PostHog funnel for the page they care about, dropped into `marketing-data/` as CSV. It takes them two minutes and changes which strings you work on.

## Reference

- `references/psychology.md` — the full persuasion library with sources, honest uses and abuse cases
- `references/diagnostics.md` — every rule the analyser applies and what to do about each
