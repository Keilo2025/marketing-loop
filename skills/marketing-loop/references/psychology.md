# The persuasion library

Every principle here is a documented finding, not a growth-hacking folk tale. Each entry gives you the mechanism, where it belongs, the honest application, and the version that turns it into a dark pattern — because the line between the two is usually one word, and knowing where it is matters more than knowing the principle.

The `id` column is what goes in the `principles` array of a proposal.

---

## Structural frameworks

These decide the shape of the sentence. Pick one before you pick a principle.

### `outcome-framing` — Jobs to be Done

People do not buy products, they hire them to make progress in a situation. The famous version: nobody wants a quarter-inch drill bit, they want a quarter-inch hole — and actually they want the shelf up before their partner gets home.

**Honest use:** describe the after-state the product genuinely produces.
**Abuse:** promising an outcome that depends on work you never mention.

```
Feature:  "Real-time collaborative editing with operational transforms"
Outcome:  "Stop merging three versions of the same doc on Friday afternoon"
```

Patterns: `{outcome} — without {pain}` · `Go from {before} to {after} in {timeframe}` · `Stop {pain}. Start {outcome}.`

Source: Christensen, *Competing Against Luck*; Levitt.

### `problem-agitate-solve` (PAS)

Name the pain, show what it costs, present the relief. The oldest structure in direct response and still the most reliable, because it earns the right to talk about the product before it talks about it.

**Honest use:** agitate with a consequence the reader already lives with.
**Abuse:** manufacturing fear they did not arrive with.

The agitation step is where most people overreach. One sentence of consequence is enough. Two is manipulation.

### `before-after-bridge` (BAB)

Today looks like this. It could look like that. Here is the bridge. Gentler than PAS and better suited to audiences who do not think of themselves as having a problem.

**Abuse:** an "after" that is aspiration rather than product capability.

---

## Attention and comprehension

### `cognitive-fluency` — processing fluency

Copy that is easy to read is judged **more true**, more trustworthy, and the underlying product is judged easier to use. This is not a style preference; fluency and perceived truth are measurably linked.

**Honest use:** short sentences, concrete nouns, familiar words, one idea per line.
**Abuse:** simplifying away a caveat that changes the deal.

Practical test: if a sentence needs a comma to survive, it probably needs to be two sentences.

Source: Reber, Schwarz & Winkielman.

### `specificity` — the specificity effect

"Cuts deploy time by 73%" is believed. "Dramatically faster deploys" is not. Precise numbers read as measurement; round numbers read as estimation; adjectives read as marketing.

**Honest use:** one real figure from your own data.
**Abuse:** inventing a precise-sounding number *because* precision is persuasive. This is the single most common failure in AI-written copy and it is why this tool refuses to output a number that is not sourced.

### `curiosity-gap` — the information gap

Loewenstein's finding: a gap between what you know and what you want to know is experienced as a deprivation, and deprivation motivates.

**Honest use:** open a gap the page then closes.
**Abuse:** clickbait — a gap you never close, or close with nothing.

Rule of thumb: if the answer is not visible within one scroll, you have written a headline that makes people feel cheated.

### `hicks-law` — choice reduction

Decision time rises with the number and complexity of options. Iyengar and Lepper's jam study: 24 varieties drew more browsers, 6 varieties sold ten times more.

**Honest use:** one primary action per screen, everything else demoted visually and verbally.
**Abuse:** hiding the option the user wants — cancellation, downgrade, decline — under the banner of simplicity.

### `von-restorff` — the isolation effect

The item that differs from its neighbours is the one remembered. Applies to the words as much as the button colour: if every CTA on the page reads the same, none of them read at all.

---

## Trust and risk

### `social-proof`

People look to similar others to decide what is correct, and the effect is strongest under uncertainty — which is exactly the state a first-time visitor is in.

**Honest use:** real counts, real named customers, real reviews. Proof from people *like the reader* beats proof from bigger names who are nothing like them.
**Abuse:** fake logos, invented testimonials, "join 10,000+ users" when you have forty.

If you have forty users, say forty. "Forty teams switched from spreadsheets last month" is more credible than ten thousand of anything.

Source: Cialdini; Asch.

### `authority`

Credentials reduce perceived risk. Works best when specific and checkable.

**Honest use:** genuine certifications, audits, standards compliance, the team's actual track record.
**Abuse:** implied endorsement, borrowed logos, "trusted by industry leaders".

### `risk-reversal`

Removing the downside is nearly always cheaper than adding upside. A buyer weighing a purchase is running two calculations — "is this good?" and "what happens if I'm wrong?" — and most copy only answers the first.

**Honest use:** a guarantee, free tier, or no-card trial you will actually honour, with terms stated plainly.
**Abuse:** guarantees with hidden conditions, "free" that requires a card, cancellation that requires an email to support.

The asterisk is the tell. If your risk reversal needs one, it is not a risk reversal.

### `labor-illusion`

Visible work increases the perceived value of the result. Users rated a travel search as better when it showed which sites it was checking — even though the results were identical.

**Honest use:** show the work you genuinely do. "Checked 340 strings across 28 files."
**Abuse:** artificial delays and progress theatre for work that took 40 milliseconds.

Source: Buell & Norton (2011).

---

## Motivation and loss

### `loss-aversion`

A loss is felt roughly twice as strongly as an equivalent gain. This is why "stop losing 6 hours a week" outperforms "save 6 hours a week" despite describing the same thing.

**Honest use:** frame the status quo as an ongoing cost — a loss that is real and already happening.
**Abuse:** inventing a loss, or implying a deadline-driven one that does not exist.

Source: Kahneman & Tversky (1979).

### `negativity-bias`

Negative information is weighted more heavily than positive. Leading with the problem you remove usually beats leading with the capability you add.

**Abuse:** fear-mongering, implying danger that is not there.

### `anchoring`

The first number seen frames every number after it. Anchor against the real cost of the problem — the contractor you would otherwise hire, the hours you would otherwise spend — rather than against a fake original price.

**Abuse:** fake "was" prices, permanent discounts, anchors against a tier nobody can buy.

### `scarcity-honest`

Genuinely limited things are valued more. The word doing the work here is *genuinely*.

**Honest use:** a limit that is real and enforced — cohort seats you actually cap, a price that actually rises on the date you say.
**Abuse:** countdown timers that reset on refresh, "3 left" that is always 3, urgency with no mechanism behind it. This is the most-abused principle in software marketing and the most likely to be recognised as a lie.

### `fresh-start` — temporal landmarks

People act on intentions at boundaries between time periods — new year, new quarter, new sprint, new job. Tying the ask to a real boundary the reader cares about outperforms tying it to an arbitrary date.

**Abuse:** invented deadlines, evergreen "ends tonight".

Source: Dai, Milkman & Riis (2014).

---

## Commitment and momentum

### `commitment-consistency`

Small first agreements make larger later ones feel consistent. The foot in the door.

**Honest use:** ask for the smallest true first step, and make that step useful on its own even if they stop there.
**Abuse:** a small step that exists only to trap the large one.

### `goal-gradient` / endowed progress

Effort increases as the finish line approaches — and progress you are *given* counts. A loyalty card with 10 stamps of which 2 are pre-stamped gets completed more than an 8-stamp card.

**Honest use:** real progress, real remaining steps, a genuinely short path.
**Abuse:** fake progress bars, "almost done" with six screens left.

### `zeigarnik`

Unfinished tasks occupy memory more than finished ones.

**Honest use:** surface the genuinely unfinished step and make finishing it one click.
**Abuse:** manufacturing incompleteness to drive re-engagement — the endless badge.

### `endowment`

Ownership raises perceived value, and *imagined* ownership counts. This is the mechanism behind "Get my report" outperforming "Get your report" outperforming "Submit".

**Honest use:** possessive framing where the thing really is theirs.
**Abuse:** implying ownership of something they must keep paying for, without saying so.

### `peak-end`

An experience is remembered by its most intense moment and its ending, not its average. Which means the success screen and the last screen are worth more copy attention than everything in the middle.

---

## Identity and reciprocity

### `unity`

We say yes to people we consider one of us. Cialdini's addition to the original six, and the strongest of them.

**Honest use:** speak in the vocabulary your audience uses about themselves — pulled, ideally, from their own support tickets and reviews.
**Abuse:** faking membership of a community you are not part of. Readers detect this faster than any other kind of dishonesty.

### `reciprocity`

Value given first creates a felt obligation.

**Honest use:** give something genuinely useful before asking — a real audit, a working free tier, a tool that solves the problem once.
**Abuse:** "free" gifts gated behind a sales call.

---

## Pricing

### `decoy-effect` — asymmetric dominance

A third option changes which of the other two looks correct. Ariely's *Economist* subscription example: adding a print-only option nobody bought moved most buyers to the print-and-web bundle.

**Honest use:** design tiers so the middle one is genuinely the best value for most people — and then say "most teams pick this one", which is true.
**Abuse:** a tier that exists only to look bad.

### `status-quo-default` — the default effect

Whatever is pre-selected is what most people end up with. Organ donation rates differ by 60+ percentage points between opt-in and opt-out countries with otherwise similar populations.

**Honest use:** default to the option that is best for the user, and make changing it obvious.
**Abuse:** pre-ticked upsells, opt-out consent, defaults chosen for your margin.

---

## The blocked list

The guardrails reject these outright. They are not aggressive persuasion; they are deception with a conversion-rate justification attached.

| pattern | why it is blocked |
| --- | --- |
| Countdown timers with no real deadline | The deadline is a lie. Refunds and chargebacks follow. |
| "Only 3 left" that is always 3 | Same. |
| Confirmshaming — "No thanks, I like losing money" | Insulting a user to win a click. |
| Invented social proof | Unverifiable claims that a competitor can disprove. |
| Hidden auto-renewal | Regulated in the EU, UK, and increasingly the US. |
| Fake live-activity — "someone in your area just bought" | Fabricated data presented as real. |
| Decline framed as a mistake — "Skip (not recommended)" | Removes the neutrality of a choice. |
| Health or financial outcome promises | Regulated claims. A human with authority writes these, not a model. |

Every one of them converts in the short run. Every one of them costs more than it earns once you count refunds, support load, review scores and the people who never come back.
