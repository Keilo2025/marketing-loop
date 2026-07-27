/**
 * Guardrails run on every proposal before a human ever sees it.
 *
 * Two jobs:
 *   1. Block dark patterns. Persuasion that only works because the reader is
 *      confused is not persuasion, it is a refund waiting to happen — and in
 *      several jurisdictions it is also illegal.
 *   2. Block invented facts. The loop can only claim what the code, the config
 *      or the human has actually established.
 */

import type { LoopConfig, Proposal } from '../types.js';

export interface GuardrailHit {
  rule: string;
  severity: 'block' | 'warn';
  message: string;
}

interface Rule {
  id: string;
  severity: 'block' | 'warn';
  test: RegExp;
  message: string;
}

/** Patterns that are dark patterns regardless of context. */
const DARK_PATTERNS: Rule[] = [
  {
    id: 'fake-urgency',
    severity: 'block',
    test: /\b(offer ends (tonight|today|in \d)|only \d+ (left|remaining|seats?) (today|right now)|expires in \d+:\d+|last chance|hurry,? (only|before))\b/i,
    message:
      'Countdown or "last chance" urgency. Only allowed if a real deadline exists and is enforced — set it in allowedClaims and re-run.',
  },
  {
    id: 'confirmshaming',
    severity: 'block',
    test: /\bno[,\s]*(thanks[,\s]*)?i\s*('?d rather|don'?t|do not|prefer|like|enjoy|am (happy|fine) (to|with))\b|\bi prefer to (stay|keep|carry on)\s+\w+ing\b|\bno thanks,? i'?ll\b/i,
    message: 'Confirmshaming — the decline option insults the user. Write a neutral decline instead.',
  },
  {
    id: 'unverifiable-social-proof',
    severity: 'warn',
    test: /\b(join (over )?[\d,]+\+? (users|customers|teams|people|developers)|trusted by (thousands|millions|industry leaders)|[\d,]+\+? happy customers)\b/i,
    message:
      'User-count or "trusted by" claim. Add the real number to allowedClaims, or the loop is inventing social proof.',
  },
  {
    id: 'superlative-without-proof',
    severity: 'warn',
    test: /\b(the (best|#1|number one|leading|fastest|most popular)|world'?s (best|leading|first)|guaranteed to (double|triple|10x))\b/i,
    message: 'Unprovable superlative. Replace with a specific, checkable fact.',
  },
  {
    id: 'medical-financial-promise',
    severity: 'block',
    test: /\b(cure|treats? (your )?(anxiety|depression|cancer)|guaranteed (returns?|profit|income)|risk[- ]free investment|clinically proven)\b/i,
    message: 'Health or financial outcome promise. This is a regulated claim — a human with authority must write it.',
  },
  {
    id: 'forced-continuity',
    severity: 'block',
    test: /\b(free trial.{0,30}(auto[- ]?renew|card required.{0,20}charged)|cancel anytime\*|billed automatically unless)\b/i,
    message: 'Trial framing that hides automatic billing. State the charge date and amount plainly.',
  },
  {
    id: 'fake-personalisation',
    severity: 'warn',
    test: /\b(someone in your (area|city|company) just|\d+ people are (viewing|looking at) this (right now)?)\b/i,
    message: 'Live-activity proof. Only allowed if it reflects real, current data.',
  },
  {
    id: 'disguised-decline',
    severity: 'block',
    test: /\b(skip.{0,15}\(not recommended\)|continue without protection|maybe later,? and lose)\b/i,
    message: 'The decline path is framed as a mistake. Both options must be stated neutrally.',
  },
];

/** Weak copy the loop should never *produce*, even though it may find it. */
const WEAK_OUTPUT: Rule[] = [
  {
    id: 'generic-cta',
    severity: 'warn',
    test: /^\s*(submit|click here|learn more|read more|continue|go|ok|next|get started)\s*$/i,
    message: 'Generic CTA. Name the thing the user receives.',
  },
  {
    id: 'company-first',
    severity: 'warn',
    test: /^\s*(we (are|help|build|provide|offer)|our (platform|solution|product|software) (is|helps|provides))/i,
    message: 'Opens with the company rather than the reader. Lead with their situation.',
  },
];

export function checkProposal(proposal: Proposal, config: LoopConfig): GuardrailHit[] {
  const text = (proposal.edited ?? proposal.after) + ' ' + proposal.alternatives.join(' ');
  const hits: GuardrailHit[] = [];

  for (const rule of [...DARK_PATTERNS, ...WEAK_OUTPUT]) {
    if (!rule.test.test(text)) continue;
    // An allowed claim vouches only for matching copy, not every text in the
    // same regex category.
    const candidate = normalizeClaim(proposal.edited ?? proposal.after);
    const vouched = config.allowedClaims.some((claim) => {
      const normalized = normalizeClaim(claim);
      return candidate === normalized || candidate.includes(normalized);
    });
    if (vouched) continue;
    hits.push({ rule: rule.id, severity: rule.severity, message: rule.message });
  }

  // Numbers that appear in the new copy but nowhere in the old copy or the
  // allowed claims are, by definition, invented.
  const newNumbers = extractNumbers(
    [proposal.edited ?? proposal.after, ...proposal.alternatives].join(' '),
  );
  const known = new Set([
    ...extractNumbers(proposal.before),
    ...config.allowedClaims.flatMap(extractNumbers),
  ]);
  const invented = newNumbers.filter((n) => !known.has(n));
  if (invented.length) {
    hits.push({
      rule: 'unsourced-number',
      severity: 'warn',
      message: `Introduces figures not present in the source or allowedClaims: ${invented.join(', ')}. Verify before approving.`,
    });
  }

  // Banned vocabulary from the project's voice config.
  const banned = config.voice.banned.filter((word) =>
    new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(text),
  );
  if (banned.length) {
    hits.push({
      rule: 'banned-vocabulary',
      severity: 'warn',
      message: `Uses words banned in marketing-loop.config.json: ${banned.join(', ')}.`,
    });
  }

  // Principles the project switched off.
  const disabled = proposal.principles.filter((p) => config.disabledPrinciples.includes(p));
  if (disabled.length) {
    hits.push({
      rule: 'disabled-principle',
      severity: 'block',
      message: `Uses principles disabled for this project: ${disabled.join(', ')}.`,
    });
  }

  return hits;
}

/** Annotates proposals in place and drops anything hard-blocked. */
export function applyGuardrails(proposals: Proposal[], config: LoopConfig): {
  kept: Proposal[];
  blocked: Array<{ proposal: Proposal; hits: GuardrailHit[] }>;
} {
  const kept: Proposal[] = [];
  const blocked: Array<{ proposal: Proposal; hits: GuardrailHit[] }> = [];

  for (const proposal of proposals) {
    const hits = checkProposal(proposal, config);
    const blocking = hits.filter((h) => h.severity === 'block');
    if (blocking.length) {
      blocked.push({ proposal, hits: blocking });
      continue;
    }
    if (hits.length) proposal.warnings = hits.map((h) => `${h.rule}: ${h.message}`);
    kept.push(proposal);
  }

  return { kept, blocked };
}

function extractNumbers(text: string): string[] {
  const matches = text.match(/\b\d[\d,.]*\s?(%|x|k|m|bn|hrs?|hours?|mins?|minutes?|days?|weeks?|seconds?|s)?\b/gi);
  return matches ? matches.map((m) => m.trim().toLowerCase()) : [];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
}
