/**
 * Copy diagnosis.
 *
 * Each rule answers one question: what is this sentence doing to the reader
 * that it should not be doing? The output is a finding with a pointer at the
 * psychology principle that fixes it, which is what the proposal stage and the
 * agent brief both consume.
 */

import {
  DEFAULT_SURFACES,
  type CopyFinding,
  type CopyItem,
  type LoopConfig,
  type ProductModel,
  type Surface,
} from '../types.js';

interface Rule {
  id: string;
  severity: 'low' | 'medium' | 'high';
  appliesTo?: string[];
  message: string;
  suggests: string[];
  test: (item: CopyItem, ctx: RuleContext) => boolean;
}

interface RuleContext {
  product: ProductModel;
  config: LoopConfig;
}

const GENERIC_CTAS = [
  'submit', 'click here', 'learn more', 'read more', 'continue', 'next', 'go',
  'ok', 'send', 'save', 'start', 'get started', 'sign up', 'register',
  'try it', 'try now', 'find out more', 'discover more', 'view more', 'see more',
  'download', 'request demo', 'contact us', 'apply now',
];

const HYPE = [
  'revolutionary', 'game-changing', 'game changing', 'cutting-edge', 'cutting edge',
  'best-in-class', 'world-class', 'next-generation', 'next generation', 'seamless',
  'seamlessly', 'robust', 'powerful', 'innovative', 'state-of-the-art', 'unparalleled',
  'unlock', 'supercharge', 'turbocharge', 'leverage', 'synergy', 'holistic',
  'disruptive', 'bleeding-edge', 'elevate', 'empower', 'effortless', 'magical',
];

const FEATURE_NOUNS = [
  'dashboard', 'platform', 'engine', 'suite', 'framework', 'architecture',
  'infrastructure', 'api', 'integration', 'module', 'workflow engine',
  'algorithm', 'system', 'toolkit', 'interface',
];

const HEDGES = ['maybe', 'perhaps', 'might', 'could possibly', 'we think', 'we believe', 'hopefully', 'sort of', 'kind of'];

const RULES: Rule[] = [
  {
    id: 'generic-cta',
    severity: 'high',
    appliesTo: ['cta'],
    message:
      'Generic CTA. The button says what the click does mechanically, not what the reader gets. Name the outcome.',
    suggests: ['outcome-framing', 'endowment', 'specificity'],
    test: (item) => GENERIC_CTAS.includes(item.text.trim().toLowerCase().replace(/[.!→>\s]+$/, '')),
  },
  {
    id: 'feature-not-benefit',
    severity: 'high',
    appliesTo: ['headline', 'subhead', 'body', 'cta'],
    message:
      'Describes the machinery rather than the change in the reader\'s situation. Buyers do not want the engine, they want the arrival.',
    suggests: ['outcome-framing', 'before-after-bridge', 'problem-agitate-solve'],
    test: (item) => {
      const t = item.text.toLowerCase();
      const hasFeatureNoun = FEATURE_NOUNS.some((n) => t.includes(n));
      const hasOutcomeVerb = /\b(so you|so that|without|instead of|stop|never again|in (under )?\d|saves? you|cuts?|removes?|ends?)\b/.test(t);
      return hasFeatureNoun && !hasOutcomeVerb;
    },
  },
  {
    id: 'company-centric',
    severity: 'high',
    appliesTo: ['headline', 'subhead', 'body'],
    message:
      'Written from the company\'s side of the table. Every "we" is a word not spent on the reader.',
    suggests: ['outcome-framing', 'unity', 'negativity-bias'],
    test: (item) => {
      const t = item.text.toLowerCase();
      const we = (t.match(/\b(we|our|us)\b/g) ?? []).length;
      const you = (t.match(/\b(you|your|yours)\b/g) ?? []).length;
      return we > 0 && we >= you && item.length > 25;
    },
  },
  {
    id: 'hype-vocabulary',
    severity: 'medium',
    message:
      'Hype words. They are unfalsifiable, so the reader discounts everything around them.',
    suggests: ['specificity', 'cognitive-fluency'],
    test: (item, { config }) => {
      const t = item.text.toLowerCase();
      const banned = [...HYPE, ...config.voice.banned.map((b) => b.toLowerCase())];
      return banned.some((w) => new RegExp(`\\b${escape(w)}\\b`).test(t));
    },
  },
  {
    id: 'no-specificity',
    severity: 'medium',
    appliesTo: ['headline', 'subhead', 'pricing'],
    message:
      'Nothing checkable in it. A single real number does more work than a paragraph of adjectives.',
    suggests: ['specificity', 'social-proof', 'labor-illusion'],
    test: (item) => item.length > 30 && !/\d/.test(item.text),
  },
  {
    id: 'no-problem-named',
    severity: 'medium',
    appliesTo: ['headline'],
    message:
      'The headline never names a problem. The reader has to work out why they should care.',
    suggests: ['problem-agitate-solve', 'negativity-bias', 'loss-aversion'],
    test: (item) =>
      !/\b(without|no more|stop|instead of|tired of|struggl|waste|lose|losing|slow|manual|broken|missed?|late|hours?|days?)\b/i.test(
        item.text,
      ) && item.length > 20,
  },
  {
    id: 'headline-too-long',
    severity: 'medium',
    appliesTo: ['headline'],
    message: 'Over ~70 characters a headline stops being read and starts being skimmed.',
    suggests: ['cognitive-fluency', 'hicks-law'],
    test: (item) => item.length > 70,
  },
  {
    id: 'cta-too-long',
    severity: 'low',
    appliesTo: ['cta'],
    message: 'A button past ~30 characters reads as a sentence and loses its affordance.',
    suggests: ['cognitive-fluency', 'von-restorff'],
    test: (item) => item.length > 30,
  },
  {
    id: 'passive-voice',
    severity: 'low',
    message: 'Passive construction hides who acts. Active voice is faster to process and easier to trust.',
    suggests: ['cognitive-fluency'],
    test: (item) => /\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b(?!\s+(by\s+you|yourself))/i.test(item.text) && item.length > 25,
  },
  {
    id: 'hedging',
    severity: 'medium',
    message: 'Hedged language. If you are not sure it is true, do not say it; if it is true, say it flatly.',
    suggests: ['cognitive-fluency', 'authority'],
    test: (item) => HEDGES.some((h) => item.text.toLowerCase().includes(h)),
  },
  {
    id: 'jargon-density',
    severity: 'medium',
    appliesTo: ['headline', 'subhead', 'body', 'cta'],
    message: 'Long-word density is high. Reading effort is read as complexity, and complexity is read as risk.',
    suggests: ['cognitive-fluency'],
    test: (item) => {
      const words = item.text.split(/\s+/).filter(Boolean);
      if (words.length < 6) return false;
      const long = words.filter((w) => w.replace(/[^a-z]/gi, '').length >= 11).length;
      return long / words.length > 0.25;
    },
  },
  {
    id: 'no-risk-reversal',
    severity: 'low',
    appliesTo: ['cta'],
    message:
      'The CTA asks for commitment without lowering the cost of saying yes. One clause about what it does not cost usually pays for itself.',
    suggests: ['risk-reversal', 'commitment-consistency'],
    test: (item) =>
      /\b(sign ?up|start|buy|subscribe|get started|create account|register|upgrade)\b/i.test(item.text) &&
      !/\b(free|no card|no credit card|cancel|trial|instant|takes \d)\b/i.test(item.text),
  },
  {
    id: 'unhelpful-error',
    severity: 'high',
    appliesTo: ['error'],
    message:
      'Error text states failure without a recovery path. This is the single most expensive place to lose someone.',
    suggests: ['peak-end', 'cognitive-fluency', 'goal-gradient'],
    test: (item) =>
      /\b(error|failed|invalid|wrong|denied|unable|something went wrong)\b/i.test(item.text) &&
      !/\b(try|check|contact|retry|instead|make sure|use)\b/i.test(item.text),
  },
  {
    id: 'dead-empty-state',
    severity: 'medium',
    appliesTo: ['empty-state'],
    message:
      'Empty state describes emptiness instead of offering the first step. Empty states convert better than most landing pages and are almost always neglected.',
    suggests: ['goal-gradient', 'zeigarnik', 'commitment-consistency'],
    test: (item) => /\b(no |nothing|empty|none found|0 results)\b/i.test(item.text) && !/\b(add|create|start|try|import|connect)\b/i.test(item.text),
  },
  {
    id: 'exclamation',
    severity: 'low',
    message: 'Exclamation marks ask the reader to feel excitement the copy has not earned.',
    suggests: ['cognitive-fluency', 'specificity'],
    test: (item) => (item.text.match(/!/g) ?? []).length >= 1 && item.kind !== 'error',
  },
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function analyse(
  items: CopyItem[],
  product: ProductModel,
  config: LoopConfig,
): CopyFinding[] {
  const ctx: RuleContext = { product, config };
  const findings: CopyFinding[] = [];

  for (const item of items) {
    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo.includes(item.kind)) continue;
      try {
        if (!rule.test(item, ctx)) continue;
      } catch {
        continue;
      }
      findings.push({
        copyId: item.id,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        suggests: rule.suggests,
      });
    }
  }

  return findings;
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;

export interface Prioritised {
  ranked: CopyItem[];
  /** Held back because their surface is not in scope, counted per surface. */
  outOfScope: Record<string, number>;
}

/** Ranks copy items by how much a rewrite would be worth. */
export function prioritise(
  items: CopyItem[],
  findings: CopyFinding[],
  behaviorSubjects: string[] = [],
  surfaces: Surface[] = DEFAULT_SURFACES,
): CopyItem[] {
  return prioritiseDetailed(items, findings, behaviorSubjects, surfaces).ranked;
}

export function prioritiseDetailed(
  items: CopyItem[],
  findings: CopyFinding[],
  behaviorSubjects: string[] = [],
  surfaces: Surface[] = DEFAULT_SURFACES,
): Prioritised {
  const score = new Map<string, number>();

  for (const finding of findings) {
    score.set(finding.copyId, (score.get(finding.copyId) ?? 0) + WEIGHT[finding.severity]);
  }

  const kindBoost: Record<string, number> = {
    cta: 6, headline: 5, subhead: 3, pricing: 4, 'empty-state': 3,
    error: 2, meta: 2, body: 1, label: 1, nav: 0, unknown: 0,
  };
  const surfaceBoost: Record<string, number> = {
    landing: 4, store: 3, email: 2, app: 1, docs: 0, legal: 0, internal: 0, unknown: 0,
  };

  const inScope = new Set(surfaces);
  const outOfScope: Record<string, number> = {};
  const candidates: CopyItem[] = [];

  for (const item of items) {
    if (!score.has(item.id)) continue;
    // Your terms of service having a passive voice finding is true and useless.
    if (!inScope.has(item.surface)) {
      outOfScope[item.surface] = (outOfScope[item.surface] ?? 0) + 1;
      continue;
    }
    candidates.push(item);
  }

  const ranked = candidates
    .map((item) => {
      let s = score.get(item.id) ?? 0;
      s += kindBoost[item.kind] ?? 0;
      s += surfaceBoost[item.surface] ?? 0;
      // Anything the behavioural data pointed at jumps the queue.
      if (behaviorSubjects.some((subject) => matches(item.text, subject))) s += 10;
      return { item, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);

  return { ranked, outOfScope };
}

function matches(text: string, subject: string): boolean {
  const a = text.toLowerCase().trim();
  const b = subject.toLowerCase().trim();
  if (!b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function findingsFor(findings: CopyFinding[], copyId: string): CopyFinding[] {
  return findings.filter((f) => f.copyId === copyId);
}
