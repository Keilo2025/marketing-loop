/**
 * Writing approved copy back into the code.
 *
 * Rules of the road:
 *   - Only proposals with status `approved` are touched.
 *   - `before` must still be present in the file. If someone edited the file
 *     since the scan, we refuse rather than guess.
 *   - Ambiguity is refused too: if `before` appears more than once and the
 *     recorded line does not disambiguate it, we stop.
 *   - Every touched file is copied into `.marketing-loop/backups/<run>/` first.
 *
 * A copy tool that silently corrupts a component is worse than no copy tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ApplyResult, LoopConfig, ProposalSet } from '../types.js';
import { read } from '../util/fsx.js';

export interface ApplyOptions {
  cwd: string;
  config: LoopConfig;
  backupDir: string;
  dryRun?: boolean;
}

export function applyProposals(set: ProposalSet, opts: ApplyOptions): ApplyResult[] {
  const { cwd, config, backupDir, dryRun = false } = opts;
  const runDir = path.join(backupDir, new Date().toISOString().replace(/[:.]/g, '-'));
  const results: ApplyResult[] = [];
  const backedUp = new Set<string>();

  const approved = set.proposals.filter((p) => p.status === 'approved');

  for (const proposal of approved) {
    const result: ApplyResult = { proposalId: proposal.id, file: proposal.file, ok: false };

    if (config.protectedFiles.includes(proposal.file)) {
      result.reason = 'file is listed in protectedFiles';
      results.push(result);
      continue;
    }

    const abs = path.join(cwd, proposal.file);
    if (!fs.existsSync(abs)) {
      result.reason = 'file no longer exists';
      results.push(result);
      continue;
    }

    const content = read(abs);
    const target = proposal.edited ?? proposal.after;
    const replacement = locate(content, proposal.before, proposal.line);

    if ('error' in replacement) {
      result.reason = replacement.error;
      results.push(result);
      continue;
    }

    const updated =
      content.slice(0, replacement.index) +
      escapeLike(proposal.before, target, content, replacement.index) +
      content.slice(replacement.index + proposal.before.length);

    if (!dryRun) {
      if (!backedUp.has(proposal.file)) {
        const backupPath = path.join(runDir, proposal.file);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(abs, backupPath);
        backedUp.add(proposal.file);
        result.backup = path.relative(cwd, backupPath);
      }
      fs.writeFileSync(abs, updated, 'utf8');
      proposal.status = 'applied';
    }

    result.ok = true;
    results.push(result);
  }

  return results;
}

type Located = { index: number } | { error: string };

/**
 * Find the exact occurrence, preferring the one on the recorded line.
 * Refuses when the match is ambiguous.
 */
function locate(content: string, before: string, line: number): Located {
  const occurrences: number[] = [];
  let idx = content.indexOf(before);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = content.indexOf(before, idx + 1);
    if (occurrences.length > 50) break;
  }

  if (!occurrences.length) {
    return {
      error:
        'source text not found — the file changed since the scan. Re-run `marketing-loop scan` and regenerate proposals.',
    };
  }
  if (occurrences.length === 1) return { index: occurrences[0] as number };

  const onLine = occurrences.filter((i) => lineOf(content, i) === line);
  if (onLine.length === 1) return { index: onLine[0] as number };

  return {
    error: `text appears ${occurrences.length} times and line ${line} does not disambiguate it. Edit this one by hand.`,
  };
}

/**
 * Preserve the surrounding quoting. If the original sat inside single quotes
 * and the replacement contains an apostrophe, escape it rather than break the
 * file.
 */
function escapeLike(before: string, after: string, content: string, index: number): string {
  const charBefore = content[index - 1];
  const charAfter = content[index + before.length];

  if (charBefore === "'" && charAfter === "'") return after.replace(/'/g, "\\'");
  if (charBefore === '"' && charAfter === '"') return after.replace(/"/g, '\\"');
  if (charBefore === '`' && charAfter === '`') return after.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  // JSX text node or markdown — braces would be read as an expression.
  return after.replace(/([{}])/g, (m) => (charBefore === '>' ? `{'${m}'}` : m));
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** Restore the most recent backup run. */
export function revert(cwd: string, backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  const runs = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const latest = runs.at(-1);
  if (!latest) return [];

  const runPath = path.join(backupDir, latest);
  const restored: string[] = [];

  const walkBack = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkBack(full); continue; }
      const rel = path.relative(runPath, full);
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.copyFileSync(full, path.join(cwd, rel));
      restored.push(rel);
    }
  };

  walkBack(runPath);
  return restored;
}
