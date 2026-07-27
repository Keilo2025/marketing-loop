# Diagnostics

Every rule the analyser runs, what it means, and how to fix it. Rule ids appear in `findings.json` and in the Open items section of the brief.

Severity drives priority: `high` findings on a `cta` or `headline` on a `landing` surface float to the top of the queue, and anything the behavioural data pointed at jumps ahead of all of it.

---

## High severity

### `generic-cta`

The button describes the mechanics of the click rather than what the reader receives. `Submit`, `Continue`, `Learn more`, `Get started`, `Contact us`.

**Fix:** name the deliverable, in the reader's possession. `Get my audit`, `Show me the estimate`, `See my report`. The deliverable must be something the page already promises — do not invent one to make the button sound better.

**Watch for:** a CTA that promises more than the next screen delivers. `Get my report` leading to a signup form is a broken promise, and the bounce happens on the form, not the button.

Principles: `outcome-framing`, `endowment`, `specificity`

### `feature-not-benefit`

The string describes machinery — dashboard, platform, engine, API, workflow, architecture — with no statement of what changes for the reader.

**Fix:** finish the sentence "…so that". Whatever comes after "so that" is the copy. If you cannot finish it, the feature may not be worth mentioning at all.

```
"Advanced analytics dashboard"
  → so that you know by Monday whether last week worked
```

Principles: `outcome-framing`, `before-after-bridge`, `problem-agitate-solve`

### `company-centric`

More "we/our/us" than "you/your". The first few words of a sentence are the ones most likely to be read, and they are being spent on the seller.

**Fix:** the fix is usually deletion. "We help teams ship faster" → "Ship faster". "Our platform lets you automate reporting" → "Automate reporting". You lose nothing.

Principles: `outcome-framing`, `unity`

### `unhelpful-error`

Error text that states failure without a recovery path.

**Fix:** failure statement short, recovery path in the same sentence. "That file is over 10 MB — try splitting it, or upload a CSV instead." The most expensive place in the product to lose someone, and almost always written last by whoever was closest.

Principles: `peak-end`, `cognitive-fluency`, `goal-gradient`

---

## Medium severity

### `hype-vocabulary`

Revolutionary, seamless, game-changing, powerful, cutting-edge, unlock, supercharge, leverage, elevate, empower. Words that cannot be disproved are also words that cannot be believed, and readers discount everything near them.

**Fix:** delete first, then check whether the sentence lost anything. Usually it did not. If it did, replace with the fact the adjective was standing in for.

### `no-specificity`

Nothing checkable in a string long enough to have earned a fact.

**Fix:** one real number. Where from, in order of preference: your own analytics, the code (limits, timeouts, batch sizes, supported formats), the README, `allowedClaims`. If none of those has it, write `NEEDS-FACT:` and let the human supply it.

### `no-problem-named`

A headline that never names a problem, so the reader has to work out why they should care.

**Fix:** name the situation they are in before you name what you do about it. Words that carry a problem: *without*, *no more*, *stop*, *instead of*, *tired of*, *still*, *manual*, *missed*, *late*.

### `jargon-density`

More than a quarter of the words are 11+ characters. Reading effort is read as complexity, and complexity is read as risk.

**Fix:** shorter words, not fewer ideas.

### `headline-too-long`

Over ~70 characters. Past that a headline gets skimmed rather than read.

**Fix:** split at the natural break. First clause is the headline, second becomes the subhead — where it will actually get read, and where it has room to be specific.

### `hedging`

Maybe, might, perhaps, we think, hopefully. If you are not sure it is true, do not say it. If it is true, say it flatly.

### `dead-empty-state`

An empty state that describes emptiness. "No projects yet."

**Fix:** the first action, and how long it takes. "Add your first project — takes about a minute." Empty states convert better than most landing pages because the user is already inside and already interested, and they are almost universally neglected.

Principles: `goal-gradient`, `zeigarnik`, `commitment-consistency`

---

## Low severity

### `cta-too-long`

Past ~30 characters a button reads as a sentence and loses its affordance.

### `passive-voice`

Passive constructions hide who acts. "Your report will be generated" → "We'll have your report in 30 seconds" or better, "Your report, in 30 seconds".

### `exclamation`

Exclamation marks ask for a feeling the copy has not earned. One is a choice; two is a tell.

### `no-risk-reversal`

A CTA asking for commitment without lowering the cost of yes.

**Fix, conditionally:** only if the product genuinely has a free tier, a no-card trial, or one-click cancellation. Add it as a short second clause. If it does not, leave the CTA alone — inventing a guarantee is the worst possible fix.

---

## How ranking works

```
score = Σ(finding severity)          high 3 · medium 2 · low 1
      + kind boost                   cta 6 · headline 5 · pricing 4 · subhead 3 · empty-state 3
      + surface boost                landing 4 · store 3 · email 2 · app 1
      + 10 if behavioural data named this string
```

The behavioural boost is deliberately large. A mediocre rewrite of the string where 60% of users leave is worth more than a brilliant rewrite of a string nobody reads — and without data in `marketing-data/`, that boost never fires and the whole ranking is a well-informed guess.
