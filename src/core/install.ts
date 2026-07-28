/**
 * Agent installation.
 *
 * Every coding agent reads a different file. AGENTS.md is now the closest
 * thing to a shared standard — it moved to the Agentic AI Foundation and is
 * read natively by Codex, Cursor, Copilot, Gemini CLI, Aider, Windsurf, Zed
 * and Amp — so that is the primary target. The rest get their own native file
 * because a rule the agent actually loads beats a standard it ignores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exists, read, writeText } from '../util/fsx.js';

export interface AgentTarget {
  id: string;
  name: string;
  /** Repo-relative file this agent reads. */
  file: string;
  /** Paths that prove the agent is in use here. */
  detect: string[];
  format: 'markdown' | 'mdc' | 'section';
  /**
   * Directory this agent scans for invokable slash commands, if it has one.
   *
   * Rules and commands are not the same thing and installing only the first is
   * the reason someone types "marketing-loop" into Cursor and sees nothing: a
   * rule is passive context the agent may or may not decide to pull in, while a
   * command is a file the user can actually find and run.
   */
  commandDir?: string;
  /** Frontmatter style the command files need. */
  commandFormat?: 'plain' | 'described';
  note?: string;
}

/** The three things a person actually wants to invoke. */
interface AgentCommand {
  name: string;
  description: string;
  body: string;
}

const COMMANDS: AgentCommand[] = [
  {
    name: 'marketing-loop',
    description: 'Rewrite this project\'s copy to sell the problem it solves, then open the approval canvas',
    body: `Run the marketing copy loop on this repository.

## 1. Set up if needed

If \`marketing-loop.config.json\` does not exist:

\`\`\`bash
npx marketing-loop@latest init
\`\`\`

Marketing-loop reads **only the configured source catalogue**. **Do not open application code or target locales.**

Then fill in two fields with product-owner-approved marketing context:

- \`audience\` — who this is actually for, in plain words
- \`allowedClaims\` — facts the copy is cleared to state. **Ask me for these.** Anything not listed, the copy may not claim.

If \`marketing-data/\` is empty, tell me that one funnel export from GA4, PostHog or Amplitude dropped in there will change which strings get worked on — and that without it the priority order is an informed guess.

## 2. Scan and propose

\`\`\`bash
npx marketing-loop@latest propose
\`\`\`

## 3. Read the brief

Read \`.marketing-loop/brief.md\` in full: the source-catalogue context, behavioural evidence, voice constraints, persuasion library, and open items.

## 4. Verify, then write

For each open item:

1. Use only the configured source catalogue, marketing config, behavioural data, approved claims, and the brief.
2. Do not open application code or target locales. If the source catalogue lacks a necessary fact, add a \`NEEDS-FACT\` question instead.
3. Give at least one genuine alternative, so I get a real choice rather than a rubber stamp.

Write only \`.marketing-loop/agent-output.json\` using the exact schema, \`runId\`, \`inventoryDigest\`, and open-item \`copyId\` values from the brief. Do not provide paths, source text, ids, authors, or statuses; import reconstructs them from the active inventory.

**Never invent a fact.** No user counts, testimonials, percentages, guarantees or timings unless they are in approved \`allowedClaims\`, marketing data, or the brief. Where a rewrite wants a number you do not have, write it without and add \`NEEDS-FACT: <question>\` to that proposal's evidence array.

**No dark patterns.** Fabricated urgency or scarcity, confirmshaming, hidden billing, fake social proof, decline options framed as mistakes. The guardrails reject these anyway.

**Copy only.** Do not edit application code or target locales.

## 5. Validate and hand back

Run \`npx marketing-loop@latest import\` and resolve every refused entry.

Summarise: how many proposals, the three that matter most with before → after, every \`NEEDS-FACT\` question gathered into one list, and anything the data pointed at that copy alone cannot fix.

Then tell me to run \`npx marketing-loop review --ui\`. Do not run \`apply\` unless I ask.`,
  },
  {
    name: 'copy-audit',
    description: 'Report what this project\'s copy is costing in conversions — no files changed',
    body: `Audit the user-facing copy in this repository. Change nothing.

\`\`\`bash
npx marketing-loop@latest scan
\`\`\`

Marketing-loop reads **only the configured source catalogue**. **Do not open application code or target locales.** Read \`.marketing-loop/findings.json\`, \`.marketing-loop/inventory.json\`, \`.marketing-loop/brief.md\`, and \`.marketing-loop/behavior.json\`, then write the report.

## What the source catalogue says

One paragraph grounded only in source-catalogue text, approved claims, behavioural data, and the brief. State unanswered questions instead of inferring product behavior from application code.

## The five strings costing the most

In priority order, each with: the string and \`file:line\`, what is wrong in one sentence a founder would agree with, the direction it should go (not finished copy), and the evidence — the diagnostic rule plus any behavioural data pointing at it.

## Patterns

Rules that fired repeatedly matter more than any single string. "Every CTA on the site is generic" is a fixable habit; one bad button is a typo.

## What copy cannot fix

Be straight about this. If the funnel drops 60% at a form with four required fields, that is not a headline problem.

## Next

If \`marketing-data/\` was empty, name the single export that would sharpen the priority order most and where to get it. Then offer to run the full loop.`,
  },
  {
    name: 'copy-review',
    description: 'Open the human approval canvas for pending copy changes',
    body: `Marketing-loop reads **only the configured source catalogue**. **Do not open application code or target locales.** If \`.marketing-loop/agent-output.json\` exists, run \`npx marketing-loop@latest import\` first. Then check that \`.marketing-loop/proposals.json\` has pending proposals. If not, run the marketing-loop command first.

\`\`\`bash
npx marketing-loop@latest review --ui
\`\`\`

Tell me:

- the URL it is serving on
- that each proposal shows the current copy, the rewrite, alternatives, the reasoning and the evidence — and that the rewrite box is editable, so whatever I type wins
- shortcuts: \`j\`/\`k\` to move, \`a\` to approve, \`r\` to reject
- that nothing is written until I press **Apply**, and \`npx marketing-loop revert\` undoes the last run

If I would rather not open a browser:

\`\`\`bash
npx marketing-loop@latest review           # writes review.md with tick boxes
npx marketing-loop@latest review --collect # reads my ticks back
npx marketing-loop@latest apply
\`\`\`

Do not approve anything on my behalf.`,
  },
];

export const AGENT_TARGETS: AgentTarget[] = [
  {
    id: 'agents-md',
    name: 'AGENTS.md (Codex, Cursor, Copilot, Gemini CLI, Aider, Amp, OpenCode, Zed, Windsurf, Jules)',
    file: 'AGENTS.md',
    detect: ['AGENTS.md'],
    format: 'section',
    note: 'The cross-tool standard. Install this one even if you install nothing else.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    file: 'CLAUDE.md',
    detect: ['CLAUDE.md', '.claude'],
    format: 'section',
    note: 'For the full experience install the plugin instead: /plugin marketplace add keilo2000/marketing-loop',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    file: '.cursor/rules/marketing-loop.mdc',
    detect: ['.cursor', '.cursorrules'],
    format: 'mdc',
    commandDir: '.cursor/commands',
    commandFormat: 'plain',
    note: 'Type / in the Agent input to run them.',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    file: '.windsurf/rules/marketing-loop.md',
    detect: ['.windsurf', '.windsurfrules'],
    format: 'markdown',
    commandDir: '.windsurf/workflows',
    commandFormat: 'described',
    note: 'Workflows are invoked in Cascade with /marketing-loop.',
  },
  {
    id: 'cline',
    name: 'Cline',
    file: '.clinerules/marketing-loop.md',
    detect: ['.clinerules'],
    format: 'markdown',
    commandDir: '.clinerules/workflows',
    commandFormat: 'plain',
    note: 'Cline does not read AGENTS.md, so it needs its own copy.',
  },
  {
    id: 'roo',
    name: 'Roo Code',
    file: '.roo/rules/marketing-loop.md',
    detect: ['.roo', '.roomodes'],
    format: 'markdown',
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    file: '.kilocode/rules/marketing-loop.md',
    detect: ['.kilocode'],
    format: 'markdown',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    file: '.github/instructions/marketing-loop.instructions.md',
    detect: ['.github/copilot-instructions.md', '.github'],
    format: 'markdown',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    file: 'GEMINI.md',
    detect: ['GEMINI.md', '.gemini'],
    format: 'section',
  },
  {
    id: 'continue',
    name: 'Continue',
    file: '.continue/rules/marketing-loop.md',
    detect: ['.continue'],
    format: 'markdown',
  },
  {
    id: 'junie',
    name: 'Junie (JetBrains)',
    file: '.junie/guidelines.md',
    detect: ['.junie'],
    format: 'section',
  },
  {
    id: 'trae',
    name: 'Trae',
    file: '.trae/rules/project_rules.md',
    detect: ['.trae'],
    format: 'section',
  },
  {
    id: 'zed',
    name: 'Zed',
    file: '.rules',
    detect: ['.zed', '.rules'],
    format: 'section',
  },
  {
    id: 'aider',
    name: 'Aider',
    file: 'CONVENTIONS.md',
    detect: ['.aider.conf.yml', '.aider.chat.history.md'],
    format: 'section',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    file: '.opencode/marketing-loop.md',
    detect: ['.opencode', 'opencode.json'],
    format: 'markdown',
  },
];

const START = '<!-- marketing-loop:start -->';
const END = '<!-- marketing-loop:end -->';

export interface InstallResult {
  target: AgentTarget;
  file: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
  /** True when this file is an invokable slash command rather than a rule. */
  command?: boolean;
}

export function detectAgents(cwd: string): AgentTarget[] {
  return AGENT_TARGETS.filter((t) => t.detect.some((d) => exists(path.join(cwd, d))));
}

export function install(
  cwd: string,
  targets: AgentTarget[],
  opts: { force?: boolean } = {},
): InstallResult[] {
  const results: InstallResult[] = [];

  for (const target of targets) {
    const abs = path.join(cwd, target.file);
    const block = renderBlock(target);

    // Commands first — these are the ones a person can actually find.
    if (target.commandDir) {
      for (const command of COMMANDS) {
        const rel = path.join(target.commandDir, `${command.name}.md`);
        const commandAbs = path.join(cwd, rel);
        const content = renderCommand(command, target.commandFormat ?? 'plain');
        const existed = exists(commandAbs);
        if (existed && read(commandAbs) === content && !opts.force) {
          results.push({ target, file: rel, action: 'unchanged', command: true });
          continue;
        }
        writeText(commandAbs, content);
        results.push({ target, file: rel, action: existed ? 'updated' : 'created', command: true });
      }
    }

    if (!exists(abs)) {
      writeText(abs, target.format === 'section' ? `${block}\n` : block);
      results.push({ target, file: target.file, action: 'created' });
      continue;
    }

    const current = read(abs);

    if (target.format !== 'section') {
      if (current.trim() === block.trim() && !opts.force) {
        results.push({ target, file: target.file, action: 'unchanged' });
        continue;
      }
      writeText(abs, block);
      results.push({ target, file: target.file, action: 'updated' });
      continue;
    }

    // Section format: replace our marked block, leave everything else alone.
    if (current.includes(START) && current.includes(END)) {
      const updated = current.replace(
        new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`),
        block,
      );
      if (updated === current) {
        results.push({ target, file: target.file, action: 'unchanged' });
        continue;
      }
      fs.writeFileSync(abs, updated, 'utf8');
      results.push({ target, file: target.file, action: 'updated' });
      continue;
    }

    fs.writeFileSync(abs, `${current.replace(/\s*$/, '')}\n\n${block}\n`, 'utf8');
    results.push({ target, file: target.file, action: 'updated' });
  }

  return results;
}

export function uninstall(cwd: string, targets: AgentTarget[]): string[] {
  const removed: string[] = [];

  for (const target of targets) {
    if (target.commandDir) {
      for (const command of COMMANDS) {
        const rel = path.join(target.commandDir, `${command.name}.md`);
        const commandAbs = path.join(cwd, rel);
        if (!exists(commandAbs)) continue;
        if (!read(commandAbs).includes('marketing-loop')) continue;
        fs.rmSync(commandAbs);
        removed.push(rel);
      }
    }

    const abs = path.join(cwd, target.file);
    if (!exists(abs)) continue;

    if (target.format === 'section') {
      const current = read(abs);
      if (!current.includes(START)) continue;
      const stripped = current
        .replace(new RegExp(`\\n*${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}\\n*`), '\n')
        .replace(/\n{3,}/g, '\n\n');
      fs.writeFileSync(abs, stripped, 'utf8');
      removed.push(target.file);
      continue;
    }

    if (read(abs).includes('marketing-loop')) {
      fs.rmSync(abs);
      removed.push(target.file);
    }
  }

  return removed;
}

/* ------------------------------------------------------------ the content */

/**
 * Command files. The filename is the command name in every agent that supports
 * them, so `marketing-loop.md` becomes `/marketing-loop`.
 */
function renderCommand(command: AgentCommand, format: 'plain' | 'described'): string {
  const body = `${command.body.trim()}\n`;

  if (format === 'described') {
    return ['---', `description: ${command.description}`, '---', '', body].join('\n');
  }

  return `# ${command.description}\n\n${body}`;
}

function renderBlock(target: AgentTarget): string {
  const body = INSTRUCTIONS.trim();

  if (target.format === 'mdc') {
    return [
      '---',
      'description: Marketing copy loop — how to write and ship product copy in this repo',
      'globs: ["marketing-loop.config.json","marketing-data/**","**/messages/*.json","**/messages/**/*.json"]',
      'alwaysApply: false',
      '---',
      '',
      body,
      '',
    ].join('\n');
  }

  if (target.format === 'markdown') {
    return `${body}\n`;
  }

  return [START, '', body, '', END].join('\n');
}

const INSTRUCTIONS = `
## Marketing copy — use the marketing loop

This repository uses [\`marketing-loop\`](https://www.npmjs.com/package/marketing-loop). Any time you are asked to write, improve, or review user-facing copy — headlines, buttons, empty states, error messages, landing pages, pricing, app store text, meta descriptions — run the loop instead of writing copy freehand.

Marketing-loop reads **only the configured source catalogue**. **Do not open application code or target locales.** Use only source-catalogue text, \`marketing-loop.config.json\`, \`marketing-data/\`, approved claims, and the generated brief.

### The loop

\`\`\`bash
npx marketing-loop scan      # read the configured source catalogue and diagnose it
npx marketing-loop propose   # engine writes what it can prove; leaves the rest to you
npx marketing-loop import    # validates your agent-output.json
npx marketing-loop review    # human approves — markdown, or --ui for the canvas
npx marketing-loop apply     # writes only what a human approved
\`\`\`

\`scan\` and \`propose\` write \`.marketing-loop/brief.md\`. **Read that file.** It contains source-catalogue context, behavioural data from \`marketing-data/\`, voice constraints, and a list of open items with the exact JSON schema for your response.

### Your part

1. Run \`npx marketing-loop propose\`, then read \`.marketing-loop/brief.md\`.
2. Write the **Open items** only to \`.marketing-loop/agent-output.json\`, using the exact run identity and \`copyId\` values in the brief. Never write paths, source text, statuses, or canonical state.
3. Run \`npx marketing-loop import\` and resolve every refusal.
4. Tell the human to run \`npx marketing-loop review --ui\` and approve.
5. Only run \`apply\` if they ask you to in this session.

### How to write the copy

Sell the problem you remove, not the feature that removes it. The reader does not want the dashboard; they want to stop being surprised on a Monday morning. Every rewrite should name a situation the reader recognises and the situation they end up in.

- **One idea per string.** If a headline carries two, split it and put the second in the subhead.
- **Lead with them, not us.** "We help teams ship faster" is a sentence about you. "Ship on Friday without the Sunday rollback" is a sentence about them.
- **Specific beats strong.** One checkable number outperforms a paragraph of adjectives. Round numbers read as marketing; precise ones read as evidence.
- **CTAs name the deliverable.** "Submit" describes the mechanics of the click. "Get my audit" describes what they walk away with.
- **Errors and empty states are conversion surfaces.** They are the two places users are most likely to leave and the two places copy is most often ignored.

### Hard rules

- **Never invent a fact.** No user counts, testimonials, percentages, guarantees, timings or customer names unless they exist in approved \`allowedClaims\`, marketing data, or the brief. If a line needs a fact you do not have, write it without and add \`NEEDS-FACT: <question>\` to the evidence array.
- **Never produce a dark pattern.** Fabricated urgency or scarcity, confirmshaming, hidden billing, fake live-activity, invented social proof, decline buttons framed as mistakes. The guardrails reject these automatically; do not waste a turn on them.
- **Copy only.** Do not open or edit application code, and do not open or edit target locales.
- **Never edit the source catalogue or canonical loop state directly.** Your only write target is \`agent-output.json\`; \`import\` validates it before human approval. That gate is the entire point of the tool.
`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
