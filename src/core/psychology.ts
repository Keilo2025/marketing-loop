/**
 * The persuasion library.
 *
 * Every principle here is a documented finding from behavioural economics,
 * social psychology or direct-response practice. Each one carries an honest
 * use and a dishonest use, and the dishonest use is written down on purpose —
 * `guardrails.ts` uses it to block proposals that cross the line.
 *
 * Persuasion that survives contact with a real customer is persuasion that was
 * true when they bought and still true a month later. That is the whole bar.
 */

export interface Principle {
  id: string;
  name: string;
  /** One-line mechanism. */
  summary: string;
  /** Where it belongs. */
  bestFor: Array<'headline' | 'subhead' | 'cta' | 'body' | 'pricing' | 'empty-state' | 'error' | 'label'>;
  /** How to apply it honestly. */
  honestUse: string;
  /** The version that turns into a dark pattern. Never generate this. */
  abuse: string;
  /** Copy patterns. `{}` slots get filled from the product model. */
  patterns: string[];
  /** Provenance, so a human can go read the source. */
  source: string;
}

export const PRINCIPLES: Principle[] = [
  {
    id: 'outcome-framing',
    name: 'Outcome framing (Jobs to be Done)',
    summary: 'People buy a changed situation, not a capability. Name the after-state.',
    bestFor: ['headline', 'cta', 'subhead'],
    honestUse: 'Describe the state the user reaches, using an outcome the product genuinely produces.',
    abuse: 'Promising an outcome the product cannot deliver, or one that depends on the user doing work you never mention.',
    patterns: [
      '{outcome} — without {pain}',
      'Go from {before-state} to {after-state} in {timeframe}',
      'Stop {pain}. Start {outcome}.',
      '{audience} who use {product} {outcome}',
    ],
    source: 'Christensen, "Competing Against Luck"; Levitt\'s "quarter-inch hole" framing',
  },
  {
    id: 'problem-agitate-solve',
    name: 'Problem–Agitate–Solve (PAS)',
    summary: 'Name the pain, show its cost, then present the product as the relief.',
    bestFor: ['headline', 'subhead', 'body'],
    honestUse: 'Agitate with a consequence the reader already lives with and recognises as true.',
    abuse: 'Manufacturing fear the reader did not have, or inflating stakes to force a decision.',
    patterns: [
      '{pain}. Every {frequency}. {consequence}.',
      "You already know {pain}. What it costs you is {consequence}.",
      '{pain} is not a {tooling} problem. It is a {real-problem} problem.',
    ],
    source: 'Classic direct-response structure; Sugarman, "The Adweek Copywriting Handbook"',
  },
  {
    id: 'loss-aversion',
    name: 'Loss aversion',
    summary: 'A loss is felt roughly twice as strongly as an equivalent gain.',
    bestFor: ['headline', 'body', 'cta'],
    honestUse: 'Frame the status quo as the ongoing cost — the loss is real and already happening.',
    abuse: 'Inventing a loss, or implying a deadline-driven loss that does not exist.',
    patterns: [
      'Stop losing {resource} to {pain}',
      "Every {period} without {product} costs you {quantified-loss}",
      "Keep the {resource} you're currently throwing at {pain}",
    ],
    source: 'Kahneman & Tversky, Prospect Theory (1979)',
  },
  {
    id: 'specificity',
    name: 'Specificity effect',
    summary: 'Precise numbers read as evidence; round numbers read as marketing.',
    bestFor: ['headline', 'subhead', 'body', 'cta', 'pricing'],
    honestUse: 'Use a real, verifiable figure from your own data. "3.2 seconds" beats "lightning fast".',
    abuse: 'Fabricating a precise-sounding number because precision is persuasive.',
    patterns: ['{n} {unit} in {time}', 'Cuts {task} from {before} to {after}', '{n}% of {audience} {result}'],
    source: 'Concreteness and processing fluency research; Ogilvy on factual advertising',
  },
  {
    id: 'social-proof',
    name: 'Social proof',
    summary: 'People look to similar others to decide what is correct.',
    bestFor: ['headline', 'subhead', 'body', 'cta'],
    honestUse: 'Show real counts, real named customers, real reviews — and prefer proof from people like the reader.',
    abuse: 'Fake logos, invented testimonials, inflated user counts, "join 10,000+" when you have 40 users.',
    patterns: ['Join {n} {audience} who {outcome}', 'Used by {named-customers}', '{n} teams switched from {alternative}'],
    source: 'Cialdini, "Influence"; Asch conformity studies',
  },
  {
    id: 'authority',
    name: 'Authority',
    summary: 'Credentials and demonstrated expertise reduce perceived risk.',
    bestFor: ['subhead', 'body'],
    honestUse: 'Cite genuine certifications, audits, standards compliance, or the team\'s real track record.',
    abuse: 'Implied endorsements, borrowed logos, vague "trusted by industry leaders".',
    patterns: ['{certification} certified', 'Built by the team behind {credential}', 'Audited by {auditor}'],
    source: 'Cialdini, "Influence"; Milgram authority studies',
  },
  {
    id: 'risk-reversal',
    name: 'Risk reversal',
    summary: 'Removing the downside is usually cheaper than adding upside.',
    bestFor: ['cta', 'pricing', 'subhead'],
    honestUse: 'Offer a guarantee, free tier, or no-card trial you will actually honour, and say the terms plainly.',
    abuse: 'Guarantees with hidden conditions, "free" that requires a card, cancellation that takes an email.',
    patterns: ['{action} — no card needed', 'Cancel in one click', '{n}-day refund, no questions', 'Free while {condition}'],
    source: 'Direct-response practice; endowment and ownership research',
  },
  {
    id: 'anchoring',
    name: 'Anchoring',
    summary: 'The first number seen sets the frame for every number after it.',
    bestFor: ['pricing', 'body'],
    honestUse: 'Anchor against the real cost of the problem or the real price of the alternative.',
    abuse: 'Fake "was" prices, permanent discounts, anchors against a tier nobody can buy.',
    patterns: ['Cheaper than {real-alternative-cost}', '{price} vs the {larger-cost} you spend on {pain}'],
    source: 'Tversky & Kahneman anchoring-and-adjustment (1974)',
  },
  {
    id: 'decoy-effect',
    name: 'Decoy / asymmetric dominance',
    summary: 'A third option changes which of the other two looks correct.',
    bestFor: ['pricing'],
    honestUse: 'Design tiers so the middle one is genuinely the best value for most people, and say so.',
    abuse: 'A tier that exists only to look bad, priced to trap rather than to serve.',
    patterns: ['Most {audience} pick {tier}', '{tier} — everything in {lower}, plus {differentiator}'],
    source: 'Huber, Payne & Puto (1982); Ariely, "Predictably Irrational"',
  },
  {
    id: 'cognitive-fluency',
    name: 'Processing fluency',
    summary: 'Copy that is easy to read is judged as more true and more trustworthy.',
    bestFor: ['headline', 'subhead', 'body', 'label', 'error'],
    honestUse: 'Short sentences, concrete nouns, familiar words, one idea per line.',
    abuse: 'Simplifying away a material caveat the buyer needs.',
    patterns: ['{subject} {verb} {object}.'],
    source: 'Reber, Schwarz & Winkielman on fluency and truth judgements',
  },
  {
    id: 'curiosity-gap',
    name: 'Information gap',
    summary: 'A gap between what you know and want to know is felt as an itch.',
    bestFor: ['headline', 'subhead'],
    honestUse: 'Open a real gap the page then closes. The answer must be on the page.',
    abuse: 'Clickbait — a gap you never close, or close with something trivial.',
    patterns: ['The reason {audience} {surprising-fact}', 'What {pain} is actually costing you'],
    source: 'Loewenstein, "The Psychology of Curiosity" (1994)',
  },
  {
    id: 'goal-gradient',
    name: 'Goal gradient / endowed progress',
    summary: 'Effort rises as the finish line gets closer, and progress already granted counts.',
    bestFor: ['cta', 'empty-state', 'label'],
    honestUse: 'Show real progress, real remaining steps, and a genuinely short path.',
    abuse: 'Fake progress bars, "almost done" when there are six screens left.',
    patterns: ['Step {n} of {total}', "You're {n}% set up", '{n} minutes to your first {outcome}'],
    source: 'Hull (1932); Nunes & Drèze endowed-progress effect (2006)',
  },
  {
    id: 'zeigarnik',
    name: 'Zeigarnik effect',
    summary: 'Unfinished tasks stay in memory more than finished ones.',
    bestFor: ['empty-state', 'cta', 'label'],
    honestUse: 'Surface the genuinely unfinished step and make finishing it one click.',
    abuse: 'Manufacturing incompleteness to drive re-engagement — endless badges and nags.',
    patterns: ['Finish setting up {thing}', 'One step left: {step}'],
    source: 'Zeigarnik (1927)',
  },
  {
    id: 'commitment-consistency',
    name: 'Commitment and consistency',
    summary: 'Small first agreements make later, larger ones feel consistent.',
    bestFor: ['cta', 'body'],
    honestUse: 'Ask for the smallest true first step. Make the first step actually useful on its own.',
    abuse: 'Foot-in-the-door funnels where the small step exists only to trap the large one.',
    patterns: ['Try it on one {unit}', 'See your {result} first', 'Start with {smallest-step}'],
    source: 'Cialdini, "Influence"; Freedman & Fraser (1966)',
  },
  {
    id: 'reciprocity',
    name: 'Reciprocity',
    summary: 'Value given first creates a felt obligation to return it.',
    bestFor: ['cta', 'body'],
    honestUse: 'Give something genuinely useful before asking — a real audit, a working free tier, a usable tool.',
    abuse: '"Free" gifts gated behind a sales call, or given to create obligation rather than value.',
    patterns: ['Get your free {deliverable}', 'See what {product} finds — free, no signup'],
    source: 'Cialdini, "Influence"; Regan (1971)',
  },
  {
    id: 'labor-illusion',
    name: 'Labour illusion',
    summary: 'Visible work increases perceived value of the result.',
    bestFor: ['body', 'label', 'empty-state'],
    honestUse: 'Show the work you actually do — files scanned, checks run, sources read.',
    abuse: 'Artificial delays and fake progress theatre for work that took 40ms.',
    patterns: ['Checked {n} {things} across {m} {places}', 'Analysed {n} {units} in {time}'],
    source: 'Buell & Norton, "The Labor Illusion" (2011)',
  },
  {
    id: 'peak-end',
    name: 'Peak–end rule',
    summary: 'An experience is remembered by its most intense moment and its ending.',
    bestFor: ['empty-state', 'body', 'error'],
    honestUse: 'Invest copy effort in the success moment and the last screen, not the middle.',
    abuse: 'Manufacturing a high before a bad ending you know is coming.',
    patterns: ['{outcome} — done.', "That's it. {result} is live."],
    source: 'Kahneman, Fredrickson, Schreiber & Redelmeier (1993)',
  },
  {
    id: 'hicks-law',
    name: "Hick's law / choice reduction",
    summary: 'Decision time grows with the number and complexity of options.',
    bestFor: ['cta', 'pricing', 'label'],
    honestUse: 'One primary action per screen. Demote everything else visually and verbally.',
    abuse: 'Hiding the option the user wants (like cancelling) under the guise of simplicity.',
    patterns: ['{primary-action}', '{primary-action} · {secondary} (quiet)'],
    source: 'Hick (1952), Hyman (1953); Iyengar & Lepper jam study (2000)',
  },
  {
    id: 'von-restorff',
    name: 'Isolation effect',
    summary: 'The item that differs from its neighbours is the one remembered.',
    bestFor: ['cta', 'pricing', 'headline'],
    honestUse: 'Make the single most valuable action look and read differently from everything near it.',
    abuse: 'Making the harmful option the prominent one.',
    patterns: ['{action} →'],
    source: 'von Restorff (1933)',
  },
  {
    id: 'status-quo-default',
    name: 'Default effect',
    summary: 'Whatever is pre-selected is what most people end up with.',
    bestFor: ['pricing', 'label'],
    honestUse: 'Default to the option that is best for the user, and make changing it obvious.',
    abuse: 'Pre-ticked upsells, opt-out consent, defaults chosen for your margin.',
    patterns: ['Recommended for {audience}', 'Default: {best-for-user-option}'],
    source: 'Johnson & Goldstein, organ-donation defaults (2003)',
  },
  {
    id: 'negativity-bias',
    name: 'Negativity bias',
    summary: 'Negative information is weighted more heavily than positive.',
    bestFor: ['headline', 'body'],
    honestUse: 'Lead with the problem you remove rather than the feature you add.',
    abuse: 'Fear-mongering, doom framing, implying danger that is not there.',
    patterns: ['No more {pain}', 'The {pain} tax you stop paying'],
    source: 'Baumeister et al., "Bad is Stronger than Good" (2001)',
  },
  {
    id: 'endowment',
    name: 'Endowment effect',
    summary: 'Ownership raises perceived value, and imagined ownership counts.',
    bestFor: ['cta', 'body'],
    honestUse: 'Use possessive framing where the thing really is theirs: "your report", "my dashboard".',
    abuse: 'Claiming ownership of something they must pay to keep, without saying so.',
    patterns: ['Get my {deliverable}', 'See your {result}', 'Your {thing}, ready in {time}'],
    source: 'Thaler (1980); Kahneman, Knetsch & Thaler (1990)',
  },
  {
    id: 'fresh-start',
    name: 'Temporal landmark / fresh start',
    summary: 'People act on intentions at the boundaries between time periods.',
    bestFor: ['cta', 'headline'],
    honestUse: 'Tie the ask to a real boundary the user cares about — a new sprint, quarter, project.',
    abuse: 'Invented deadlines and evergreen "ends tonight" timers.',
    patterns: ['Start your next {period} with {outcome}', 'Before your next {milestone}'],
    source: 'Dai, Milkman & Riis, "The Fresh Start Effect" (2014)',
  },
  {
    id: 'scarcity-honest',
    name: 'Honest scarcity',
    summary: 'Genuinely limited things are valued more.',
    bestFor: ['cta', 'pricing'],
    honestUse: 'Only state a limit that is real and enforced — seats you actually cap, a price that actually rises.',
    abuse: 'Countdown timers that reset, "3 left" that is always 3, urgency with no mechanism behind it.',
    patterns: ['{n} seats in this cohort', 'Price rises to {new-price} on {real-date}'],
    source: 'Cialdini, "Influence"; Worchel, Lee & Adewole cookie study (1975)',
  },
  {
    id: 'unity',
    name: 'Unity / shared identity',
    summary: 'We say yes to people we consider one of us.',
    bestFor: ['headline', 'body', 'cta'],
    honestUse: 'Speak in the vocabulary your audience actually uses about themselves.',
    abuse: 'Faking membership of a community you are not part of.',
    patterns: ['For {audience} who {shared-behaviour}', 'Built by {audience}, for {audience}'],
    source: 'Cialdini, "Pre-Suasion" (2016)',
  },
  {
    id: 'before-after-bridge',
    name: 'Before–After–Bridge',
    summary: 'Show today, show the better day, then name the product as the bridge.',
    bestFor: ['headline', 'subhead', 'body'],
    honestUse: 'The "after" must be an outcome existing customers actually report.',
    abuse: 'An "after" that is aspiration rather than product capability.',
    patterns: ['Today: {before}. With {product}: {after}.', 'From {before} to {after}'],
    source: 'Direct-response structure; widely used in conversion copywriting',
  },
];

export const PRINCIPLE_IDS = PRINCIPLES.map((p) => p.id);

export function getPrinciple(id: string): Principle | undefined {
  return PRINCIPLES.find((p) => p.id === id);
}

export function principlesFor(kind: string): Principle[] {
  return PRINCIPLES.filter((p) => (p.bestFor as string[]).includes(kind));
}

/** Compact markdown table for the agent brief. */
export function principleCheatSheet(disabled: string[] = []): string {
  const rows = PRINCIPLES.filter((p) => !disabled.includes(p.id)).map(
    (p) => `| \`${p.id}\` | ${p.summary} | ${p.bestFor.join(', ')} | ${p.abuse} |`,
  );
  return [
    '| id | mechanism | use on | never do this |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
