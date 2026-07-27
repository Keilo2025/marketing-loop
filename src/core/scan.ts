import path from 'node:path';
import type { CopyItem, LoopConfig } from '../types.js';
import { read, walk } from '../util/fsx.js';
import { SCANNABLE, extractFromFile } from './extract.js';

export interface ScanResult {
  items: CopyItem[];
  filesScanned: number;
  filesWithCopy: number;
}

export function scanRepo(cwd: string, config: LoopConfig): ScanResult {
  // The data directory holds evidence about the copy, not copy. Scanning it
  // would let the loop propose rewrites of your own analytics notes.
  const exclude = [...config.exclude, `${config.dataDir}/`, config.outDir];

  const files = walk(cwd, { exclude, extensions: SCANNABLE }).filter(
    (f) => !config.protectedFiles.includes(f),
  );

  const items: CopyItem[] = [];
  const withCopy = new Set<string>();

  for (const rel of files) {
    const content = read(path.join(cwd, rel));
    if (!content) continue;
    const found = extractFromFile(rel, content);
    if (found.length) {
      withCopy.add(rel);
      items.push(...found);
    }
  }

  return {
    items: dedupe(items),
    filesScanned: files.length,
    filesWithCopy: withCopy.size,
  };
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
    const key = `${item.file}::${item.text}::${item.kind}`;
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
