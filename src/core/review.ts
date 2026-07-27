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
};

export function renderReview(set: ProposalSet): string {
  const s: string[] = [];

  s.push('# Copy review');
  s.push('');
  s.push(`${set.proposals.length} proposals for **${set.product}**, generated ${set.generatedAt}.`);
  s.push('');
  s.push('**How to use this file**');
  s.push('');
  s.push('1. For each block, tick `APPROVE` or `REJECT` by putting an `x` in the box.');
  s.push('2. To change the wording, edit the text inside the `FINAL` block. Whatever is in there wins.');
  s.push('3. Save, then run `npx marketing-loop apply`.');
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

  s.push(`<!-- marketing-loop:${p.id} -->`);
  s.push(MARK.approve);
  s.push(MARK.reject);
  s.push('');
  s.push('```FINAL');
  s.push(p.after);
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
    if (!approved || rejected) {
      decisions.push({ proposalId: id, approved: false });
      continue;
    }

    const final = /```FINAL\n([\s\S]*?)\n```/.exec(block);
    decisions.push({
      proposalId: id,
      approved: true,
      finalText: final?.[1]?.trim(),
    });
  }

  return decisions;
}

/** Folds decisions back into the proposal set. */
export function applyDecisions(set: ProposalSet, decisions: Decision[]): ProposalSet {
  const byId = new Map(decisions.map((d) => [d.proposalId, d]));

  return {
    ...set,
    proposals: set.proposals.map((p) => {
      const decision = byId.get(p.id);
      if (!decision) return p;
      if (!decision.approved) return { ...p, status: 'rejected' as const };
      const edited =
        decision.finalText && decision.finalText !== p.after ? decision.finalText : undefined;
      return { ...p, status: 'approved' as const, ...(edited ? { edited } : {}) };
    }),
  };
}
