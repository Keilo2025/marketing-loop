/**
 * The deterministic proposal engine.
 *
 * This engine will only make a change it can justify from text already present
 * in the repo. It never invents a number, a customer, a guarantee or an
 * outcome. That restraint is the whole reason it can be trusted to run
 * unattended in someone's CI.
 *
 * Everything it cannot safely fix becomes an *open item* in the brief, which
 * is where the host coding agent (Claude Code, Cursor, Codex) or an API model
 * takes over — those have the judgement to write new claims, and a human then
 * approves them on the canvas.
 */

import type {
  BehaviorReport,
  CopyFinding,
  CopyItem,
  LoopConfig,
  ProductModel,
  Proposal,
} from '../types.js';
import { shortHash } from '../util/fsx.js';
import { findingsFor } from './analyse.js';

const HYPE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsupercharge\b/gi, 'speed up'],
  [/\bturbocharge\b/gi, 'speed up'],
  [/\bunlock\b/gi, 'get'],
  [/\bleverage\b/gi, 'use'],
  [/\belevate\b/gi, 'improve'],
  [/\bempower\s+(you|teams|users)\s+to\b/gi, 'let $1'],
  [/\bempower\b/gi, 'help'],
  [/\butilise\b/gi, 'use'],
  [/\butilize\b/gi, 'use'],
  [/\bfacilitate\b/gi, 'help'],
  [/\bdelve into\b/gi, 'look at'],
  [/\bin order to\b/gi, 'to'],
  [/\bat this point in time\b/gi, 'now'],
];

const HYPE_DELETIONS =
  /\b(revolutionary|game[- ]changing|cutting[- ]edge|best[- ]in[- ]class|world[- ]class|next[- ]generation|state[- ]of[- ]the[- ]art|unparalleled|seamlessly|seamless|robust|powerful|innovative|disruptive|bleeding[- ]edge|magical|effortless|holistic|synergistic)\s*/gi;

export interface ProposeInput {
  items: CopyItem[];
  findings: CopyFinding[];
  product: ProductModel;
  behavior: BehaviorReport;
  config: LoopConfig;
  /** Ranked copy items — proposals are generated in this order. */
  ranked: CopyItem[];
}

export interface ProposeOutput {
  proposals: Proposal[];
  /** Items the engine deliberately left for a model with judgement. */
  openItems: Array<{ item: CopyItem; findings: CopyFinding[]; ask: string }>;
}

export function propose(input: ProposeInput): ProposeOutput {
  const { findings, config, ranked, items, behavior } = input;
  const proposals: Proposal[] = [];
  const openItems: ProposeOutput['openItems'] = [];

  /*
   * Split the budget rather than letting the engine eat it.
   *
   * The engine's rewrites are the safe, mechanical ones — strip a hype word,
   * fix an article. The open items are the headlines and CTAs that actually
   * move a funnel, and they need a model with judgement. If the engine were
   * allowed to fill the whole cap it would crowd out the valuable half of the
   * work with the cheap half.
   */
  const engineBudget = Math.max(1, Math.ceil(config.maxProposals * 0.6));

  for (const item of ranked) {
    if (proposals.length >= engineBudget && openItems.length >= config.maxProposals) break;
    const itemFindings = findingsFor(findings, item.id);
    if (!itemFindings.length) continue;

    const evidence = buildEvidence(item, itemFindings, behavior);
    const rewrite = safeRewrite(item, items, input.product, itemFindings);

    if (rewrite && rewrite.after !== item.text && proposals.length < engineBudget) {
      proposals.push({
        id: shortHash('proposal', item.id, rewrite.after),
        copyId: item.id,
        file: item.file,
        line: item.line,
        kind: item.kind,
        before: item.text,
        after: rewrite.after,
        alternatives: rewrite.alternatives.filter((a) => a !== rewrite.after),
        rationale: rewrite.rationale,
        problemSolved: rewrite.problemSolved,
        principles: rewrite.principles,
        evidence,
        confidence: rewrite.confidence,
        status: 'pending',
        author: 'engine',
      });
      continue;
    }

    openItems.push({
      item,
      findings: itemFindings,
      ask: askFor(item, itemFindings),
    });
  }

  // Open items and engine proposals share one cap. Handing an agent 40 rewrites
  // on top of 60 engine proposals produces a 100-item review, and a review that
  // long does not get finished.
  const budget = Math.max(0, config.maxProposals - proposals.length);
  return { proposals, openItems: openItems.slice(0, budget) };
}

/* ------------------------------------------------------------- rewriting */

interface Rewrite {
  after: string;
  alternatives: string[];
  rationale: string;
  problemSolved: string;
  principles: string[];
  confidence: number;
}

function safeRewrite(
  item: CopyItem,
  all: CopyItem[],
  product: ProductModel,
  findings: CopyFinding[],
): Rewrite | null {
  const rules = new Set(findings.map((f) => f.rule));

  if (rules.has('generic-cta')) {
    const rewrite = rewriteGenericCta(item, all, product);
    if (rewrite) return rewrite;
  }

  if (rules.has('company-centric')) {
    const rewrite = flipToReader(item);
    if (rewrite) return rewrite;
  }

  if (rules.has('hype-vocabulary')) {
    const rewrite = stripHype(item);
    if (rewrite) return rewrite;
  }

  if (rules.has('exclamation')) {
    const cleaned = item.text.replace(/!+/g, '.').replace(/\.\s*\./g, '.').trim();
    if (cleaned !== item.text) {
      return {
        after: cleaned,
        alternatives: [],
        rationale:
          'Removed the exclamation mark. Enthusiasm the reader has not yet agreed to reads as pressure, and pressure reads as weak evidence.',
        problemSolved: 'The copy was asking for a feeling instead of earning it.',
        principles: ['cognitive-fluency'],
        confidence: 0.8,
      };
    }
  }

  if (rules.has('headline-too-long')) {
    const rewrite = tightenHeadline(item);
    if (rewrite) return rewrite;
  }

  return null;
}

/**
 * Generic CTAs get an outcome, and the outcome is borrowed from the nearest
 * heading in the same file — a phrase the page already commits to, so nothing
 * is invented.
 */
function rewriteGenericCta(
  item: CopyItem,
  all: CopyItem[],
  product: ProductModel,
): Rewrite | null {
  const noun = nearestOutcomeNoun(item, all, product);
  if (!noun) return null;

  const primary = `Get my ${noun}`;
  const alternatives = [
    `Show me my ${noun}`,
    `Start my ${noun}`,
    `See my ${noun}`,
  ].filter((a) => a.length <= 34);

  if (primary.length > 34) return null;

  return {
    after: primary,
    alternatives,
    rationale:
      `"${item.text}" describes the mechanics of the click. "${primary}" describes what the reader walks away with, and the possessive puts it in their hands before they have it — the reliable half of the endowment effect. The noun is taken from "${noun}", which this page already promises, so no new claim is introduced.`,
    problemSolved:
      'The reader could not tell what pressing the button would give them, so pressing it felt like a cost with an unknown return.',
    principles: ['outcome-framing', 'endowment', 'specificity'],
    confidence: 0.72,
  };
}

/**
 * Pull a concrete deliverable noun phrase from the page's own headings.
 * Headings *above* the button win — that is the promise the reader has already
 * read by the time they reach it.
 */
function nearestOutcomeNoun(
  item: CopyItem,
  all: CopyItem[],
  product: ProductModel,
): string | null {
  const headings = all.filter(
    (i) => i.file === item.file && ['headline', 'subhead'].includes(i.kind),
  );

  const above = headings
    .filter((i) => i.line <= item.line)
    .sort((a, b) => b.line - a.line);
  const below = headings
    .filter((i) => i.line > item.line)
    .sort((a, b) => a.line - b.line);

  for (const heading of [...above, ...below]) {
    const noun = deliverableNoun(heading.text);
    if (noun) return noun;
  }

  return product.tagline ? deliverableNoun(product.tagline) : null;
}

/** Nouns that name a thing the reader walks away holding. */
const HEAD_NOUNS = new Set([
  'report', 'audit', 'analysis', 'plan', 'score', 'summary', 'breakdown',
  'estimate', 'quote', 'preview', 'draft', 'roadmap', 'checklist', 'dashboard',
  'invoice', 'forecast', 'itinerary', 'playlist', 'resume', 'design',
  'schedule', 'proposal', 'transcript', 'translation', 'receipt', 'quiz',
  'results', 'recommendations', 'insights',
]);

/** Words that end a noun phrase when walking backwards from the head noun. */
const PHRASE_STOP = new Set([
  'your', 'our', 'my', 'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'and', 'or', 'with', 'for', 'to', 'in', 'of', 'on', 'get', 'see', 'run',
  'start', 'build', 'make', 'is', 'are', 'you', 'we', 'it',
]);

/**
 * Build the phrase by walking backwards from the head noun rather than by
 * regex, so "Real-time Analytics Dashboard" yields "analytics dashboard" and
 * never "time analytics dashboard".
 */
function deliverableNoun(text: string): string | null {
  const words = text.trim().split(/\s+/).map((w) => w.replace(/[^\w'’-]/g, ''));

  for (let i = words.length - 1; i >= 0; i--) {
    const word = (words[i] ?? '').toLowerCase();
    if (!HEAD_NOUNS.has(word)) continue;

    const phrase = [word];
    for (let j = i - 1; j >= i - 2 && j >= 0; j--) {
      const prev = (words[j] ?? '').toLowerCase();
      if (!prev || prev.includes('-') || PHRASE_STOP.has(prev) || prev.length < 3) break;
      if (!/^[a-z]+$/.test(prev)) break;
      phrase.unshift(prev);
    }

    return phrase.join(' ');
  }

  return null;
}

/** Strip the company out of the front of a sentence so the reader is the subject. */
function flipToReader(item: CopyItem): Rewrite | null {
  const patterns: RegExp[] = [
    /^we\s+(?:help|let|enable|allow|make it easy for)\s+(?:you|teams|companies|businesses|users|people|developers)(?:\s+to)?\s+/i,
    /^our\s+(?:platform|product|software|tool|app|solution|service)\s+(?:helps|lets|enables|allows|makes it easy for)\s+(?:you|teams|companies|businesses|users)(?:\s+to)?\s+/i,
    /^with\s+our\s+[\w\s]{2,30}?,\s*you\s+can\s+/i,
  ];

  for (const pattern of patterns) {
    if (!pattern.test(item.text)) continue;
    const stripped = item.text.replace(pattern, '').trim();
    if (stripped.length < 8) continue;

    // Removing the subject orphans anything that referred back to it.
    // "We help teams monitor their deployments" must not become "Monitor their
    // deployments" — and if the company is still in the tail, the flip did not
    // actually achieve anything. Both cases go to a model with judgement.
    if (/\b(we|our|ours|us|their|theirs|them|they)\b/i.test(stripped)) continue;

    const after = fixArticles(stripped.charAt(0).toUpperCase() + stripped.slice(1));
    return {
      after,
      alternatives: [],
      rationale:
        `Dropped the company from the front of the sentence. "${item.text.split(/\s+/).slice(0, 4).join(' ')}…" spends the first and most-read words on the seller; the rewrite hands them to the reader and gets to the verb they care about immediately.`,
      problemSolved:
        'The reader had to read past the vendor to find out what was in it for them, and most of them did not.',
      principles: ['outcome-framing', 'unity', 'cognitive-fluency'],
      confidence: 0.75,
    };
  }

  return null;
}

function stripHype(item: CopyItem): Rewrite | null {
  let after = item.text;
  const removed: string[] = [];

  for (const [pattern, replacement] of HYPE_REPLACEMENTS) {
    if (pattern.test(after)) {
      removed.push(...(after.match(pattern) ?? []));
      after = after.replace(pattern, replacement);
    }
  }

  const deletions = after.match(HYPE_DELETIONS);
  if (deletions) {
    removed.push(...deletions.map((d) => d.trim()));
    after = after.replace(HYPE_DELETIONS, '');
  }

  after = after.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  if (after) after = after.charAt(0).toUpperCase() + after.slice(1);
  // Deleting an adjective can strand the wrong article: "a robust API" → "a API".
  after = fixArticles(after);

  if (!after || after === item.text || after.split(/\s+/).length < 2) return null;

  return {
    after,
    alternatives: [],
    rationale:
      `Removed ${removed.map((r) => `"${r.trim()}"`).join(', ')}. Words that cannot be disproved are also words that cannot be believed, and readers discount the sentence around them. What is left is shorter and checkable.`,
    problemSolved:
      'Unfalsifiable adjectives were doing the work that a fact should be doing, so the whole claim read as marketing rather than information.',
    principles: ['specificity', 'cognitive-fluency'],
    confidence: 0.7,
  };
}

function tightenHeadline(item: CopyItem): Rewrite | null {
  const separators = [' — ', ' – ', ' - ', ': ', '; '];
  for (const sep of separators) {
    const idx = item.text.indexOf(sep);
    if (idx > 15 && idx < 70) {
      const after = item.text.slice(0, idx).trim().replace(/[.,]$/, '');
      const remainder = item.text.slice(idx + sep.length).trim();
      return {
        after,
        alternatives: [item.text.slice(idx + sep.length).trim()],
        rationale:
          `Split a ${item.length}-character headline at its natural break and kept the first clause. The second half ("${remainder.slice(0, 60)}${remainder.length > 60 ? '…' : ''}") belongs in the subhead, where it will actually be read. Past roughly 70 characters a headline is skimmed rather than read.`,
        problemSolved: 'Two ideas were competing inside one line, so neither landed.',
        principles: ['cognitive-fluency', 'hicks-law'],
        confidence: 0.6,
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------- grammar */

/** Letters whose name begins with a vowel sound, so "an" before an acronym. */
const VOWEL_SOUND_LETTERS = new Set(['a', 'e', 'f', 'h', 'i', 'l', 'm', 'n', 'o', 'r', 's', 'x']);
/** Vowel-initial words that are pronounced with a leading consonant. */
const CONSONANT_SOUND = /^(u[bcdgkmnprst]|uni|use|usu|eu|one|once)/i;
/** Consonant-initial words with a silent h. */
const SILENT_H = /^(hour|honest|honou?r|heir)/i;

/**
 * Correct a/an after a word has been deleted. Deleting an adjective is the
 * fastest way to make a sentence read as machine-written — "a API" is the
 * kind of mistake a reader notices and a linter does not.
 */
export function fixArticles(text: string): string {
  return text.replace(/\b([Aa]n?)(\s+)([A-Za-z][\w'-]*)/g, (_match, article: string, space: string, word: string) => {
    const needsAn = takesAn(word);
    const capital = article[0] === 'A';
    const corrected = needsAn ? 'an' : 'a';
    return (capital ? corrected.charAt(0).toUpperCase() + corrected.slice(1) : corrected) + space + word;
  });
}

function takesAn(word: string): boolean {
  // Acronyms are read letter by letter: "an API", "a URL".
  if (/^[A-Z]{2,}$/.test(word)) {
    return VOWEL_SOUND_LETTERS.has((word[0] ?? '').toLowerCase());
  }
  if (SILENT_H.test(word)) return true;
  if (CONSONANT_SOUND.test(word)) return false;
  return /^[aeiou]/i.test(word);
}

/* ------------------------------------------------------------------ asks */

function askFor(item: CopyItem, findings: CopyFinding[]): string {
  const rules = findings.map((f) => f.rule);
  if (rules.includes('feature-not-benefit')) {
    return `Rewrite so it names the situation the reader is in and the situation they end up in. Do not describe the machinery. Use only capabilities proven by the code.`;
  }
  if (rules.includes('no-problem-named')) {
    return `Name the specific problem this removes. If you cannot find the problem in the code or the product model, say so instead of guessing.`;
  }
  if (rules.includes('unhelpful-error')) {
    return `Add the recovery path: what the user should do next, in the same sentence. Keep the failure statement short.`;
  }
  if (rules.includes('dead-empty-state')) {
    return `Replace the description of emptiness with the single first action, and say how long it takes.`;
  }
  if (rules.includes('no-specificity')) {
    return `Add one checkable fact. Pull it from the codebase, the README or marketing-loop.config.json allowedClaims. If none exists, flag it as a fact the human needs to supply.`;
  }
  if (rules.includes('generic-cta')) {
    return `Name what the reader receives when they click. Take the deliverable from the surrounding page copy — do not invent one.`;
  }
  if (rules.includes('no-risk-reversal')) {
    return `If — and only if — the product genuinely has a free tier, trial without a card, or easy cancellation, add it as a short second clause.`;
  }
  return `Rewrite to fix: ${findings.map((f) => f.rule).join(', ')}.`;
}

function buildEvidence(
  item: CopyItem,
  findings: CopyFinding[],
  behavior: BehaviorReport,
): string[] {
  const evidence: string[] = [`${item.file}:${item.line} (${item.kind}, ${item.surface} surface)`];

  for (const finding of findings.slice(0, 3)) {
    evidence.push(`${finding.severity} · ${finding.rule}: ${finding.message}`);
  }

  for (const problem of behavior.problems) {
    if (problem.relatedCopyIds.includes(item.id)) evidence.push(`data · ${problem.evidence}`);
  }

  return evidence;
}
