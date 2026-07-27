---
description: Run the full marketing copy loop — scan the code, rewrite the copy to sell the problem, open the approval canvas
argument-hint: "[optional: a page, route or file to focus on]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

Run the marketing loop on this repository. Focus: $ARGUMENTS

## 1. Set up if needed

Check whether `marketing-loop.config.json` exists. If it does not:

```bash
npx marketing-loop@latest init
```

Then read the generated config and fill in two fields properly, using what you can learn from the codebase and the README:

- `audience` — who this is actually for, in plain words
- `allowedClaims` — facts the copy is cleared to state. **Ask the user for these.** Anything not in here, the copy may not claim.

Also check `marketing-data/`. If it is empty, tell the user that one funnel export from GA4, PostHog or Amplitude dropped in there will change which strings get worked on — and that without it, the priority order is an informed guess.

## 2. Scan and propose

```bash
npx marketing-loop@latest propose
```

## 3. Read the brief

Read `.marketing-loop/brief.md` in full. It has the product model inferred from the code, the behavioural evidence, the voice constraints, the persuasion library, and the open items.

## 4. Verify, then write

For each open item:

1. Open the code that implements whatever the string is talking about. Find the real detail — limits, formats, timings, what it actually does.
2. Write the rewrite from that detail, not from the feature name.
3. Give at least one genuine alternative, so the human gets a real choice rather than a rubber stamp.

Write only `.marketing-loop/agent-output.json` using the exact schema, `runId`, `inventoryDigest`, and open-item `copyId` values in the brief. Do not write paths, source text, ids, authors, or statuses; the importer reconstructs them from the active inventory.

**Never invent a fact.** Where a rewrite wants a number you do not have, write it without and add `NEEDS-FACT: <the question>` to that proposal's evidence array.

## 5. Hand over

First validate the untrusted output:

```bash
npx marketing-loop@latest import
```

Resolve every refused entry. Then summarise for the user:

Summarise for the user:

- how many proposals, and the three you think matter most, with the before → after for each
- any `NEEDS-FACT` questions, gathered into one list they can answer in one go
- anything the behavioural data pointed at that you could not fix with copy alone

Then:

```
npx marketing-loop review --ui
```

Stop there. Do not run `apply` unless they ask you to.
