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
  note?: string;
}

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
    note: 'For the full experience install the plugin instead: /plugin marketplace add marketing-loop',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    file: '.cursor/rules/marketing-loop.mdc',
    detect: ['.cursor', '.cursorrules'],
    format: 'mdc',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    file: '.windsurf/rules/marketing-loop.md',
    detect: ['.windsurf', '.windsurfrules'],
    format: 'markdown',
  },
  {
    id: 'cline',
    name: 'Cline',
    file: '.clinerules/marketing-loop.md',
    detect: ['.clinerules'],
    format: 'markdown',
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

function renderBlock(target: AgentTarget): string {
  const body = INSTRUCTIONS.trim();

  if (target.format === 'mdc') {
    return [
      '---',
      'description: Marketing copy loop — how to write and ship product copy in this repo',
      'globs: ["**/*.tsx","**/*.jsx","**/*.html","**/*.vue","**/*.svelte","**/*.astro","**/*.md","**/*.mdx"]',
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

### The loop

\`\`\`bash
npx marketing-loop scan      # find every user-facing string and diagnose it
npx marketing-loop propose   # engine writes what it can prove; leaves the rest to you
npx marketing-loop review    # human approves — markdown, or --ui for the canvas
npx marketing-loop apply     # writes only what a human approved
\`\`\`

\`scan\` and \`propose\` write \`.marketing-loop/brief.md\`. **Read that file.** It contains the product model inferred from this codebase, the behavioural data from \`marketing-data/\`, the persuasion library, the voice constraints, and a list of open items with the exact JSON schema for your response.

### Your part

1. Run \`npx marketing-loop propose\`, then read \`.marketing-loop/brief.md\`.
2. Write rewrites for the **Open items** into \`.marketing-loop/proposals.json\`, merging with what is already there.
3. Tell the human to run \`npx marketing-loop review --ui\` and approve.
4. Only run \`apply\` if they ask you to in this session.

### How to write the copy

Sell the problem you remove, not the feature that removes it. The reader does not want the dashboard; they want to stop being surprised on a Monday morning. Every rewrite should name a situation the reader recognises and the situation they end up in.

- **One idea per string.** If a headline carries two, split it and put the second in the subhead.
- **Lead with them, not us.** "We help teams ship faster" is a sentence about you. "Ship on Friday without the Sunday rollback" is a sentence about them.
- **Specific beats strong.** One checkable number outperforms a paragraph of adjectives. Round numbers read as marketing; precise ones read as evidence.
- **CTAs name the deliverable.** "Submit" describes the mechanics of the click. "Get my audit" describes what they walk away with.
- **Errors and empty states are conversion surfaces.** They are the two places users are most likely to leave and the two places copy is most often ignored.

### Hard rules

- **Never invent a fact.** No user counts, testimonials, percentages, guarantees, timings or customer names unless they exist in the code, in \`allowedClaims\` in \`marketing-loop.config.json\`, or in the brief. If a line needs a fact you do not have, write it without and add \`NEEDS-FACT: <question>\` to the evidence array.
- **Never produce a dark pattern.** Fabricated urgency or scarcity, confirmshaming, hidden billing, fake live-activity, invented social proof, decline buttons framed as mistakes. The guardrails reject these automatically; do not waste a turn on them.
- **Copy only.** No component restructuring, no new props, no logic changes, no styling.
- **Never edit source files with copy changes directly.** Everything goes through \`proposals.json\` and the human's approval. That gate is the entire point of the tool.
`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
