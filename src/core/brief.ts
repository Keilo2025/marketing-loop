/**
 * The agent brief.
 *
 * This is the file that makes the loop work inside Cursor, Codex, Claude Code
 * and everything else without an API key: the CLI does the deterministic work
 * (finding copy, diagnosing it, ranking it against behavioural data) and then
 * hands the host agent a brief containing everything it needs and a schema to
 * write back to. The agent is the model. The CLI is the harness.
 */

import type {
  BehaviorReport,
  CopyFinding,
  CopyItem,
  LoopConfig,
  MarketingContext,
} from '../types.js';
import { STATE_SCHEMA_VERSION } from '../types.js';
import type { ProposeOutput } from './propose.js';
import { principleCheatSheet } from './psychology.js';

export interface BriefInput {
  context: MarketingContext;
  items: CopyItem[];
  findings: CopyFinding[];
  behavior: BehaviorReport;
  config: LoopConfig;
  proposed: ProposeOutput;
  outDir: string;
  runId: string;
  inventoryDigest: string;
}

export function renderBrief(input: BriefInput): string {
  const { context, findings, behavior, config, proposed, items } = input;
  const s: string[] = [];

  s.push('# Marketing loop brief');
  s.push('');
  s.push(
    `Generated ${new Date().toISOString()} by \`marketing-loop\`. Everything below comes from the configured source catalogue, marketing-loop.config.json, and marketing-data/. Application code was not read.`,
  );
  s.push('');
  s.push('---');
  s.push('');

  /* ------------------------------------------------------------ the task */
  s.push('## Your task');
  s.push('');
  s.push(
    'Rewrite the copy listed under **Open items** so it sells the outcome rather than the feature, then write your proposals to `' +
      relOut(input.outDir, 'agent-output.json') +
      '` using the schema at the bottom of this file.',
  );
  s.push('');
  s.push('Rules that are not negotiable:');
  s.push('');
  s.push('1. **You may not invent a fact.** No user counts, no percentages, no customer names, no guarantees, no timings — unless they appear in this brief or in `allowedClaims`. If a line needs a fact you do not have, write the rewrite with the fact missing and put the question in `evidence` as `NEEDS-FACT: ...`.');
  s.push('2. **No dark patterns.** Fake urgency, fake scarcity, confirmshaming, hidden billing and invented social proof are rejected automatically by the guardrails and will not reach the human.');
  s.push('3. **One idea per string.** If a headline is carrying two ideas, propose the split.');
  s.push('4. **Do not touch behaviour.** Copy only. No component restructuring, no new props, no logic changes.');
  s.push('5. **Every proposal needs a rationale a human will agree with**, naming the principle and the reason it applies *here*.');
  s.push('');

  /* ------------------------------------------------------ source context */
  s.push('## Source catalogue context');
  s.push('');
  s.push(`- **Source locale:** ${context.sourceLocale}`);
  s.push(`- **Catalogue directory:** ${context.messagesDir}`);
  s.push(`- **Catalogue layout:** ${context.layout}`);
  s.push(`- **Namespaces:** ${context.namespaces.length ? context.namespaces.join(', ') : '—'}`);
  s.push(`- **Audience:** ${context.audience || '—'}`);
  if (context.currentTagline) s.push(`- **Current tagline:** ${context.currentTagline}`);
  if (context.currentDescription) s.push(`- **Current description:** ${context.currentDescription}`);
  s.push(`- **Voice:** ${config.voice.tone}`);
  s.push(`- **Allowed claims:** ${context.allowedClaims.length ? context.allowedClaims.join('; ') : '—'}`);
  s.push('');

  /* -------------------------------------------------------- the evidence */
  s.push('## What the behavioural data says');
  s.push('');
  if (!behavior.sourceFiles.length) {
    s.push(
      `No data found in \`${config.dataDir}/\`. Drop a CSV or JSON export there (GA4, PostHog, Amplitude, Hotjar, Mixpanel, Plausible or your own spreadsheet) and re-run — proposals aimed at a measured drop-off are worth far more than proposals aimed at a hunch. Until then, treat every priority below as a hypothesis.`,
    );
  } else {
    s.push(`Sources: ${behavior.sourceFiles.map((f) => `\`${f}\``).join(', ')}`);
    s.push('');
    if (behavior.funnel.length) {
      s.push('| funnel step | users | drop-off |');
      s.push('| --- | ---: | ---: |');
      for (const step of behavior.funnel) s.push(`| ${step.name} | ${step.users} | ${step.dropoff}% |`);
      s.push('');
    }
    if (behavior.problems.length) {
      s.push('**Ranked problems:**');
      s.push('');
      for (const problem of behavior.problems.slice(0, 12)) {
        s.push(`- \`${problem.severity}\` **${problem.subject}** — ${problem.evidence}${problem.relatedCopyIds.length ? ` _(copy: ${problem.relatedCopyIds.join(', ')})_` : ''}`);
      }
      s.push('');
    }
  }
  s.push('');

  /* -------------------------------------------------------------- voice */
  s.push('## Voice constraints');
  s.push('');
  s.push(`- Tone: ${config.voice.tone}`);
  s.push(`- Person: ${config.voice.person}`);
  s.push(`- Reading level: ${config.voice.readingLevel}`);
  if (config.voice.banned.length) s.push(`- Never use: ${config.voice.banned.join(', ')}`);
  if (config.voice.required.length) s.push(`- Always include: ${config.voice.required.join(', ')}`);
  s.push(
    config.allowedClaims.length
      ? `- Claims you are cleared to make:\n${config.allowedClaims.map((c) => `  - ${c}`).join('\n')}`
      : '- **No cleared claims on file.** You cannot state any external fact. Use `NEEDS-FACT:` markers where one would help.',
  );
  if (config.disabledPrinciples.length) {
    s.push(`- Principles switched off for this project: ${config.disabledPrinciples.join(', ')}`);
  }
  s.push('');

  /* --------------------------------------------------------- psychology */
  s.push('## Persuasion library');
  s.push('');
  s.push('Use the `id` in the `principles` field of each proposal. The last column is the version that turns the principle into a dark pattern — the guardrails reject it, and so should you.');
  s.push('');
  s.push(principleCheatSheet(config.disabledPrinciples));
  s.push('');

  /* -------------------------------------------------------- open items */
  s.push('## Open items');
  s.push('');
  s.push(
    `${proposed.openItems.length} strings need a rewrite the deterministic engine would not attempt, because doing it well requires judgement about the audience and catalogue context. These are yours.`,
  );
  s.push('');

  for (const [i, open] of proposed.openItems.entries()) {
    const item = open.item;
    s.push(`### ${i + 1}. \`${item.id}\` — ${item.kind} in \`${item.file}:${item.line}\``);
    s.push('');
    s.push('```text');
    s.push(item.text);
    s.push('```');
    s.push('');
    s.push(`**Diagnosis:** ${open.findings.map((f) => `${f.rule} (${f.severity})`).join(', ')}`);
    s.push('');
    for (const finding of open.findings) s.push(`- ${finding.message}`);
    s.push('');
    s.push(`**Ask:** ${open.ask}`);
    const suggested = [...new Set(open.findings.flatMap((f) => f.suggests))].filter(
      (p) => !config.disabledPrinciples.includes(p),
    );
    if (suggested.length) s.push(`**Try:** ${suggested.map((p) => `\`${p}\``).join(', ')}`);
    if (item.context.length) s.push(`**Context:** ${item.context.slice(0, 4).join(' · ')}`);
    s.push('');
  }

  /* ----------------------------------------------------- already handled */
  if (proposed.proposals.length) {
    s.push('## Already proposed by the engine');
    s.push('');
    s.push('These are already in the canonical proposal set. Leave them alone unless you can clearly do better — if you can, reuse the same `copyId` and your imported rewrite will replace the engine version for review.');
    s.push('');
    s.push('| copyId | before | after | principles |');
    s.push('| --- | --- | --- | --- |');
    for (const p of proposed.proposals.slice(0, 25)) {
      s.push(`| \`${p.copyId}\` | ${escapePipes(p.before)} | ${escapePipes(p.after)} | ${p.principles.join(', ')} |`);
    }
    s.push('');
  }

  /* -------------------------------------------------------------- stats */
  s.push('## Inventory summary');
  s.push('');
  const byKind = new Map<string, number>();
  for (const item of items) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  s.push(
    [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${n} ${kind}`)
      .join(' · '),
  );
  s.push('');
  s.push(`${findings.length} findings across ${new Set(findings.map((f) => f.copyId)).size} strings.`);
  s.push('');

  /* ------------------------------------------------------------- schema */
  s.push('## Output schema');
  s.push('');
  s.push('Write only to `' + relOut(input.outDir, 'agent-output.json') + '`. Do not edit `inventory.json`, `proposals.json`, `decisions.json`, or source files.');
  s.push('');
  s.push('```json');
  s.push(
    JSON.stringify(
      {
        schemaVersion: STATE_SCHEMA_VERSION,
        runId: input.runId,
        inventoryDigest: input.inventoryDigest,
        proposals: [
          {
            copyId: '<the id from Open items>',
            after: '<your rewrite>',
            alternatives: ['<a second option the human can pick>'],
            rationale: '<why this wins, for a human, naming the mechanism>',
            problemSolved: '<the reader problem this now solves>',
            principles: ['outcome-framing', 'specificity'],
            evidence: ['<source-catalogue text, allowed claim, marketing-data point, or NEEDS-FACT question>'],
            confidence: 0.8,
          },
        ],
      },
      null,
      2,
    ),
  );
  s.push('```');
  s.push('');
  s.push('Only `copyId` identifies the target. File paths, source text, status, ids, and authors are ignored and reconstructed from the active inventory during import.');
  s.push('');
  s.push('## Then');
  s.push('');
  s.push('```bash');
  s.push('npx marketing-loop import        # validates agent-output.json into proposals.json');
  s.push('npx marketing-loop review        # writes review.md for a human to tick');
  s.push('npx marketing-loop review --ui   # or open the approval canvas in a browser');
  s.push('npx marketing-loop apply         # applies only what a human approved');
  s.push('```');
  s.push('');
  s.push('Do not run `apply` on the human\'s behalf unless they have told you to in this session. The approval gate is the point of the tool.');
  s.push('');

  return s.join('\n');
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|').slice(0, 90);
}

function relOut(outDir: string, file: string): string {
  return `${outDir.replace(/^.*\/(?=\.)/, '')}/${file}`.replace(/^\/+/, '');
}
