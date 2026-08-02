/**
 * The markdown half of the approval canvas.
 *
 * `render` writes a review file with one decision block per proposal.
 * `collect` reads the human's ticks and edits back out of it.
 *
 * This exists so the gate works over SSH, in a PR diff, on a phone, and inside
 * an agent session where nobody wants to open a browser. The web canvas is the
 * same data with a nicer surface.
 */

import type { Proposal, ProposalSet } from '../types.js';

const MARK = {
  approve: '- [ ] APPROVE',
  reject: '- [ ] REJECT',
  all: '- [ ] SAME DECISION FOR ALL IDENTICAL COPIES',
};

export function renderReview(set: ProposalSet): string {
  const s: string[] = [];

  s.push('# Copy review');
  s.push('');
  if (set.runId && set.inventoryDigest) {
    s.push(`<!-- marketing-loop-run:${set.runId}:${set.inventoryDigest} -->`);
    s.push('');
  }
  s.push(`${set.proposals.length} proposals for **${set.product}**, generated ${set.generatedAt}.`);
  s.push('');
  s.push('**How to use this file**');
  s.push('');
  s.push('1. For each block, tick `APPROVE` or `REJECT` by putting an `x` in the box.');
  s.push('2. To change the wording, edit the text inside the `FINAL` block. Whatever is in there wins.');
  s.push('3. If you reject a proposal, explain why in its `REASON` block so the next run can learn from it.');
  s.push('4. Save, then run `npx marketing-loop apply`.');
  s.push('');
  s.push('Anything left unticked is treated as a reject. Nothing is written to your code until you run `apply`.');
  s.push('');
  s.push('---');
  s.push('');

  const byFile = new Map<string, Proposal[]>();
  for (const p of set.proposals) {
    byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  }

  for (const [file, proposals] of byFile) {
    s.push(`## \`${file}\``);
    s.push('');
    for (const p of proposals) s.push(...renderProposal(p));
  }

  return s.join('\n');
}

function renderProposal(p: Proposal): string[] {
  const s: string[] = [];
  const confidence = Math.round(p.confidence * 100);

  s.push(`### ${p.kind} · line ${p.line} · \`${p.id}\``);
  s.push('');
  s.push('**Now**');
  s.push('');
  s.push('> ' + p.before.replace(/\n/g, '\n> '));
  s.push('');
  s.push('**Proposed**');
  s.push('');
  s.push('> ' + p.after.replace(/\n/g, '\n> '));
  s.push('');

  if (p.alternatives.length) {
    s.push('**Alternatives** — paste one into FINAL to use it instead');
    s.push('');
    for (const alt of p.alternatives) s.push(`- ${alt}`);
    s.push('');
  }

  s.push(`**Why.** ${p.rationale}`);
  s.push('');
  s.push(`**Problem it solves.** ${p.problemSolved}`);
  s.push('');
  s.push(
    `**Principles:** ${p.principles.map((x) => `\`${x}\``).join(', ') || '—'}  ·  **Confidence:** ${confidence}%  ·  **Author:** ${p.author}`,
  );
  s.push('');

  if (p.evidence.length) {
    s.push('<details><summary>Evidence</summary>');
    s.push('');
    for (const e of p.evidence) s.push(`- ${e}`);
    s.push('');
    s.push('</details>');
    s.push('');
  }

  if (p.warnings?.length) {
    s.push('> [!WARNING]');
    for (const w of p.warnings) s.push(`> ${w}`);
    s.push('');
  }

  if (p.localeWarning) {
    s.push('> [!NOTE]');
    s.push(`> **Translation.** ${p.localeWarning}`);
    s.push('');
  }

  s.push(`<!-- marketing-loop:${p.id} -->`);
  s.push(MARK.approve);
  s.push(MARK.reject);

  // Without this line, a localised repo means ticking the same box forty times.
  // It is opt-in rather than default because the whole gate is worth nothing if
  // one tick can silently change forty files.
  if (p.siblings?.length) {
    s.push(MARK.all + ` (${p.siblings.length} other${p.siblings.length === 1 ? '' : 's'})`);
  }

  s.push('');
  s.push('```FINAL');
  s.push(p.after);
  s.push('```');
  s.push('');
  s.push('```REASON');
  s.push(p.rejectionReason ?? '');
  s.push('```');
  s.push('');
  s.push('---');
  s.push('');

  return s;
}

export interface Decision {
  proposalId: string;
  approved: boolean;
  finalText?: string;
  /** Human explanation for a rejection. */
  reason?: string;
  /** The human ticked "same decision for all identical copies" on this block. */
  fanOut?: boolean;
  /**
   * Whether the human actually ticked a box on this block, as opposed to
   * leaving it at the default reject.
   *
   * Every block in review.md produces a decision, so without this a fan-out
   * could never find a sibling to carry to — they would all look decided.
   * Undefined counts as explicit: a hand-built decision is a real one.
   */
  explicit?: boolean;
}

export function collectReview(markdown: string): Decision[] {
  const decisions: Decision[] = [];
  const blocks = markdown.split(/<!--\s*marketing-loop:/).slice(1);

  for (const block of blocks) {
    const idMatch = /^([\w-]+)\s*-->/.exec(block);
    if (!idMatch?.[1]) continue;
    const id = idMatch[1];

    const approved = /- \[[xX]\]\s*APPROVE/.test(block);
    const rejected = /- \[[xX]\]\s*REJECT/.test(block);
    const fanOut = /- \[[xX]\]\s*SAME DECISION FOR ALL/.test(block);
    const reason = /```REASON\n([\s\S]*?)\n```/.exec(block)?.[1]?.trim();

    if (!approved || rejected) {
      decisions.push({
        proposalId: id,
        approved: false,
        ...(reason ? { reason } : {}),
        fanOut,
        explicit: rejected,
      });
      continue;
    }

    const final = /```FINAL\n([\s\S]*?)\n```/.exec(block);
    decisions.push({
      proposalId: id,
      approved: true,
      finalText: final?.[1]?.trim(),
      fanOut,
      explicit: true,
    });
  }

  return decisions;
}

export interface FoldResult {
  set: ProposalSet;
  /** Proposals decided by a fan-out rather than directly, for reporting. */
  fannedOut: number;
}

/**
 * Folds decisions back into the proposal set, carrying any ticked fan-out
 * across that proposal's siblings.
 *
 * A fan-out only ever reaches siblings the human left untouched. If they
 * approved one locale and explicitly rejected another, that reject stands —
 * an explicit decision is never overwritten by a bulk one.
 */
export function applyDecisions(set: ProposalSet, decisions: Decision[]): ProposalSet {
  return foldDecisions(set, decisions).set;
}

export function foldDecisions(set: ProposalSet, decisions: Decision[]): FoldResult {
  const byId = new Map(decisions.map((d) => [d.proposalId, d]));
  const explicit = new Set(
    decisions.filter((d) => d.explicit !== false).map((d) => d.proposalId),
  );

  // Work out what each fan-out implies before touching anything.
  const carried = new Map<string, { approved: boolean; finalText?: string; reason?: string }>();
  for (const decision of decisions) {
    if (!decision.fanOut) continue;
    const lead = set.proposals.find((p) => p.id === decision.proposalId);
    for (const sibId of lead?.siblings ?? []) {
      if (explicit.has(sibId) || carried.has(sibId)) continue;
      carried.set(sibId, {
        approved: decision.approved,
        finalText: decision.finalText,
        reason: decision.reason,
      });
    }
  }

  const proposals = set.proposals.map((p) => {
    // Applied is terminal: re-collecting a stale review.md must not regress a
    // proposal whose text is already on disk. Only `revert` undoes an apply.
    if (p.status === 'applied') return p;
    const carry = carried.get(p.id);
    // A carried decision wins over the default reject that every untouched
    // block produces — but never over a box the human actually ticked.
    const decision = carry ? undefined : byId.get(p.id);
    const call = decision ?? (carry ? { ...carry, proposalId: p.id } : undefined);

    if (!call) return p;
    if (!call.approved) {
      return {
        ...p,
        status: 'rejected' as const,
        edited: undefined,
        ...(call.reason ? { rejectionReason: call.reason } : { rejectionReason: undefined }),
      };
    }

    const edited = call.finalText && call.finalText !== p.after ? call.finalText : undefined;
    return {
      ...p,
      status: 'approved' as const,
      rejectionReason: undefined,
      ...(edited ? { edited } : { edited: undefined }),
    };
  });

  return { set: { ...set, proposals }, fannedOut: carried.size };
}
