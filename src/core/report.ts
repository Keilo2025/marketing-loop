import type { ApplyResult, ProposalSet } from '../types.js';

export function renderReport(set: ProposalSet, results: ApplyResult[]): string {
  const applied = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  const byId = new Map(set.proposals.map((p) => [p.id, p]));

  const s: string[] = [];
  s.push('# Copy change report');
  s.push('');
  s.push(`${applied.length} change${applied.length === 1 ? '' : 's'} applied to **${set.product}** on ${new Date().toISOString().slice(0, 10)}.`);
  s.push('');

  if (applied.length) {
    s.push('| file:line | before | after | principles |');
    s.push('| --- | --- | --- | --- |');
    for (const result of applied) {
      const p = byId.get(result.proposalId);
      if (!p) continue;
      s.push(
        `| \`${p.file}:${p.line}\` | ${cell(p.before)} | ${cell(p.edited ?? p.after)} | ${p.principles.join(', ')} |`,
      );
    }
    s.push('');
  }

  if (refused.length) {
    s.push('## Refused');
    s.push('');
    s.push('These were approved but not written, because writing them was not safe:');
    s.push('');
    for (const result of refused) s.push(`- \`${result.file}\` — ${result.reason}`);
    s.push('');
  }

  const edited = set.proposals.filter((p) => p.edited);
  if (edited.length) {
    s.push('## Human edits');
    s.push('');
    s.push('The loop proposed one thing and a human shipped another. This is the most useful signal in the file — it is where the model\'s instinct and the product\'s reality disagree.');
    s.push('');
    for (const p of edited) {
      s.push(`- \`${p.file}:${p.line}\``);
      s.push(`  - proposed: ${p.after}`);
      s.push(`  - shipped: ${p.edited}`);
    }
    s.push('');
  }

  const rejected = set.proposals.filter((p) => p.status === 'rejected');
  if (rejected.length) {
    s.push(`## Rejected (${rejected.length})`);
    s.push('');
    for (const p of rejected) {
      s.push(
        `- \`${p.file}:${p.line}\` — ${cell(p.after)}` +
        `${p.rejectionReason ? ` — reason: ${cell(p.rejectionReason)}` : ''}`,
      );
    }
    s.push('');
  }

  s.push('---');
  s.push('');
  s.push('Roll back the last run with `npx marketing-loop revert`.');
  s.push('');

  return s.join('\n');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 100);
}
