import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CopyItem, LoopConfig } from '../types.js';
import { hashText, read, walkDetailed } from '../util/fsx.js';
import { SCANNABLE, extractFromFile } from './extract.js';

export interface ScanResult {
  items: CopyItem[];
  filesScanned: number;
  filesWithCopy: number;
  truncated: boolean;
  runId: string;
  inventoryDigest: string;
}

export function scanRepo(cwd: string, config: LoopConfig, runId = randomUUID()): ScanResult {
  // The data directory holds evidence about the copy, not copy. Scanning it
  // would let the loop propose rewrites of your own analytics notes.
  const exclude = [...config.exclude, `${config.dataDir}/`, config.outDir];

  const roots = normalizedRoots(cwd, config.include);
  const walked = walkDetailed(cwd, { exclude, extensions: SCANNABLE, roots });
  const files = walked.files.filter(
    (f) => !config.protectedFiles.includes(f),
  );

  const items: CopyItem[] = [];
  const withCopy = new Set<string>();

  for (const rel of files) {
    const content = read(path.join(cwd, rel));
    if (!content) continue;
    const found = extractFromFile(rel, content);
    const fileHash = hashText(content);
    for (const item of found) item.fileHash = fileHash;
    if (found.length) {
      withCopy.add(rel);
      items.push(...found);
    }
  }

  const unique = dedupe(items);
  const inventoryDigest = hashText(JSON.stringify(unique.map((item) => ({
    id: item.id,
    file: item.file,
    fileHash: item.fileHash,
    start: item.source?.start,
    end: item.source?.end,
    raw: item.source?.raw,
  }))));

  return {
    items: unique,
    filesScanned: files.length,
    filesWithCopy: withCopy.size,
    truncated: walked.truncated,
    runId,
    inventoryDigest,
  };
}

function normalizedRoots(cwd: string, includes: string[]): string[] {
  const roots = includes.length ? includes : ['.'];
  const normalized = roots.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '') || '.');
  if (normalized.includes('.')) return ['.'];

  for (const entry of normalized) {
    if (path.isAbsolute(entry) || entry === '..' || entry.startsWith('../')) {
      throw new Error(`include path must stay inside the repository: ${entry}`);
    }
    if (!fs.existsSync(path.join(cwd, entry))) {
      throw new Error(`include path does not exist: ${entry}`);
    }
  }
  return [...new Set(normalized)];
}

/**
 * Within a file, the same string extracted twice (once as a text node, once
 * from an attribute) is one decision. Across files it is not — "Submit" on the
 * pricing page and "Submit" in the app are different buttons with different
 * jobs, and collapsing them would silently leave one of them unfixed.
 */
function dedupe(items: CopyItem[]): CopyItem[] {
  const byText = new Map<string, CopyItem>();
  const out: CopyItem[] = [];

  for (const item of items) {
    const key = `${item.file}::${item.source?.start ?? item.line}::${item.text}::${item.kind}`;
    const first = byText.get(key);
    if (!first) {
      byText.set(key, item);
      out.push(item);
      continue;
    }
    if (first.file !== item.file || first.line !== item.line) {
      first.context.push(`also:${item.file}:${item.line}`);
    }
  }

  return out;
}

export function summarise(items: CopyItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}
