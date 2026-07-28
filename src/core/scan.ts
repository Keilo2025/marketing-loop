import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CopyItem, LoopConfig } from '../types.js';
import { hashText, read } from '../util/fsx.js';
import { resolveCatalogueScope } from './catalogue.js';
import { extractCatalogueFile } from './catalogue-extract.js';

export interface ScanResult {
  items: CopyItem[];
  files: string[];
  filesScanned: number;
  filesWithCopy: number;
  truncated: boolean;
  runId: string;
  inventoryDigest: string;
  scopeDigest: string;
  sourceLocale: string;
}

export function scanRepo(cwd: string, config: LoopConfig, runId = randomUUID()): ScanResult {
  const scope = resolveCatalogueScope(cwd, config);
  const files = scope.files;

  const items: CopyItem[] = [];
  const withCopy = new Set<string>();

  for (const rel of files) {
    const content = read(path.join(cwd, rel));
    const found = extractCatalogueFile(rel, content, scope);
    if (found.length) {
      withCopy.add(rel);
      items.push(...found);
    }
  }

  const unique = dedupe(items);
  const inventoryDigest = digestInventoryItems(unique, scope.scopeDigest, scope.sourceLocale);

  return {
    items: unique,
    files,
    filesScanned: files.length,
    filesWithCopy: withCopy.size,
    truncated: false,
    runId,
    inventoryDigest,
    scopeDigest: scope.scopeDigest,
    sourceLocale: scope.sourceLocale,
  };
}

export function digestInventoryItems(items: CopyItem[], scopeDigest = items[0]?.scopeDigest ?? '', sourceLocale = items[0]?.sourceLocale ?? ''): string {
  return hashText(JSON.stringify({ scopeDigest, sourceLocale, items: items.map((item) => ({
    id: item.id,
    catalogueKey: item.catalogueKey,
    sourceLocale: item.sourceLocale,
    scopeDigest: item.scopeDigest,
    file: item.file,
    line: item.line,
    text: item.text,
    kind: item.kind,
    fileHash: item.fileHash,
    start: item.source?.start,
    end: item.source?.end,
    raw: item.source?.raw,
    representation: item.source?.representation,
    applicable: item.source?.applicable,
  })) }));
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
