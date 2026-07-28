/**
 * Writing approved copy back into the code.
 *
 * Rules of the road:
 *   - Mutable proposal status never authorizes a write.
 *   - Decisions must be bound to the active run and proposal digest.
 *   - Every exact source span is preflighted before the first write.
 *   - Every touched file is backed up and written by atomic replacement.
 *
 * A copy tool that silently corrupts a component is worse than no copy tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ApplyResult,
  CopyItem,
  DecisionSet,
  Inventory,
  LoopConfig,
  Proposal,
  ProposalSet,
} from '../types.js';
import { ACTIVE_STATE_SCHEMA_ERROR, STATE_SCHEMA_VERSION } from '../types.js';
import { hashText, writeText } from '../util/fsx.js';
import { checkProposal } from './guardrails.js';
import { digestInventoryItems } from './scan.js';
import { validateDecisionSet } from './state.js';
import { resolveCatalogueScope } from './catalogue.js';

export interface ApplyOptions {
  cwd: string;
  config: LoopConfig;
  backupDir: string;
  dryRun?: boolean;
  inventory?: Inventory;
  decisions?: DecisionSet;
}

export function applyProposals(set: ProposalSet, opts: ApplyOptions): ApplyResult[] {
  if (set.schemaVersion === STATE_SCHEMA_VERSION) return applySecure(set, opts);
  return set.proposals
    .filter((proposal) => proposal.status === 'approved')
    .map((proposal) => ({
      proposalId: proposal.id,
      file: proposal.file,
      ok: false,
      reason: ACTIVE_STATE_SCHEMA_ERROR,
    }));
}

interface PreparedChange {
  proposal: Proposal;
  item: CopyItem;
  finalText: string;
  replacement: string;
  abs: string;
  content: string;
}

function applySecure(set: ProposalSet, opts: ApplyOptions): ApplyResult[] {
  const { inventory, decisions } = opts;
  const authorized = decisions?.decisions.filter((decision) => decision.decision === 'approved') ?? [];
  const failAll = (reason: string): ApplyResult[] => {
    const ids = authorized.length
      ? authorized.map((decision) => decision.proposalId)
      : set.proposals.map((proposal) => proposal.id);
    return ids.map((proposalId) => ({
      proposalId,
      file: set.proposals.find((proposal) => proposal.id === proposalId)?.file ?? '',
      ok: false,
      reason,
    }));
  };

  if (!inventory || !decisions) {
    return failAll(ACTIVE_STATE_SCHEMA_ERROR);
  }
  if (
    inventory.schemaVersion !== STATE_SCHEMA_VERSION ||
    inventory.scopeDigest !== set.scopeDigest ||
    inventory.sourceLocale !== set.sourceLocale ||
    inventory.runId !== set.runId ||
    inventory.inventoryDigest !== set.inventoryDigest
  ) {
    return failAll('inventory does not match the active proposal run');
  }
  let scope;
  try {
    scope = resolveCatalogueScope(opts.cwd, opts.config);
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
  }
  if (
    inventory.scopeDigest !== scope.scopeDigest ||
    inventory.sourceLocale !== scope.sourceLocale
  ) {
    return failAll('active state does not match the configured source catalogue');
  }
  if (digestInventoryItems(inventory.items, inventory.scopeDigest, inventory.sourceLocale) !== inventory.inventoryDigest) {
    return failAll('inventory digest does not match its contents');
  }
  const decisionErrors = validateDecisionSet(set, decisions);
  if (decisionErrors.length) return failAll(decisionErrors.join('; '));
  if (!authorized.length) return [];

  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const proposalById = new Map(set.proposals.map((proposal) => [proposal.id, proposal]));
  const prepared: PreparedChange[] = [];
  const results: ApplyResult[] = [];

  for (const decision of authorized) {
    const proposal = proposalById.get(decision.proposalId);
    if (!proposal) {
      results.push({ proposalId: decision.proposalId, file: '', ok: false, reason: 'proposal no longer exists' });
      continue;
    }
    const result: ApplyResult = { proposalId: proposal.id, file: proposal.file, ok: false };
    try {
      const item = itemById.get(proposal.copyId);
      if (!item) throw new Error('copyId is not present in the active inventory');
      if (
        proposal.file !== item.file ||
        proposal.catalogueKey !== item.catalogueKey ||
        proposal.sourceLocale !== item.sourceLocale ||
        proposal.scopeDigest !== (item.scopeDigest ?? inventory.scopeDigest) ||
        proposal.line !== item.line ||
        proposal.before !== item.text ||
        proposal.kind !== item.kind
      ) {
        throw new Error('proposal source fields do not match the active inventory');
      }
      if (!item.fileHash || !item.source || !item.source.applicable) {
        throw new Error('inventory item has no applicable exact source span');
      }

      const finalText = decision.finalText;
      const guardrailHits = checkProposal(
        { ...proposal, edited: finalText, alternatives: [] },
        opts.config,
      ).filter((hit) => hit.severity === 'block');
      if (guardrailHits.length) {
        throw new Error(`final text blocked by guardrails: ${guardrailHits.map((hit) => hit.rule).join(', ')}`);
      }

      const abs = confinedTarget(opts.cwd, item.file, opts.config);
      const content = fs.readFileSync(abs, 'utf8');
      if (hashText(content) !== item.fileHash) {
        throw new Error('file changed since the scan; run scan and review again');
      }
      const { start, end, raw } = item.source;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end > content.length ||
        content.slice(start, end) !== raw
      ) {
        throw new Error('exact source span no longer matches the file');
      }
      prepared.push({
        proposal,
        item,
        finalText,
        replacement: encodeReplacement(item, finalText),
        abs,
        content,
      });
      results.push(result);
    } catch (error) {
      result.reason = error instanceof Error ? error.message : String(error);
      results.push(result);
    }
  }

  if (results.some((result) => !prepared.some((change) => change.proposal.id === result.proposalId))) {
    for (const result of results) {
      if (!result.reason) result.reason = 'batch aborted because another change failed preflight';
    }
    return results;
  }

  const updates = new Map<string, { original: string; updated: string; changes: PreparedChange[] }>();
  for (const change of prepared) {
    const entry = updates.get(change.abs) ?? {
      original: change.content,
      updated: change.content,
      changes: [],
    };
    entry.changes.push(change);
    updates.set(change.abs, entry);
  }

  try {
    for (const [abs, entry] of updates) {
      const ordered = [...entry.changes].sort(
        (a, b) => (b.item.source?.start ?? 0) - (a.item.source?.start ?? 0),
      );
      let updated = entry.original;
      let previousStart = Number.POSITIVE_INFINITY;
      for (const change of ordered) {
        const source = change.item.source as NonNullable<CopyItem['source']>;
        if (source.end > previousStart) throw new Error(`overlapping source spans in ${change.item.file}`);
        updated = updated.slice(0, source.start) + change.replacement + updated.slice(source.end);
        previousStart = source.start;
      }
      if (path.extname(abs).toLowerCase() === '.json') {
        try {
          JSON.parse(updated);
        } catch {
          throw new Error(`replacement would make ${entry.changes[0]?.item.file ?? abs} invalid JSON`);
        }
      }
      entry.updated = updated;
    }
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
  }

  if (opts.dryRun) return results.map((result) => ({ ...result, ok: true }));

  const runDir = path.join(
    opts.backupDir,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${set.runId as string}`,
  );
  const realRoot = fs.realpathSync(opts.cwd);
  const written: string[] = [];
  try {
    for (const [abs, entry] of updates) {
      const rel = path.relative(realRoot, abs);
      writeText(path.join(runDir, rel), entry.original);
    }
    for (const [abs, entry] of updates) {
      writeText(abs, entry.updated);
      written.push(abs);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const abs of written.reverse()) {
      const original = updates.get(abs)?.original;
      if (original !== undefined) {
        try {
          writeText(abs, original);
        } catch (rollbackError) {
          rollbackFailures.push(
            `${path.relative(realRoot, abs)}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    return failAll(
      rollbackFailures.length
        ? `atomic write failed (${reason}); rollback was incomplete: ${rollbackFailures.join('; ')}`
        : `atomic write failed and was rolled back: ${reason}`,
    );
  }

  for (const change of prepared) {
    change.proposal.status = 'applied';
    if (change.finalText !== change.proposal.after) change.proposal.edited = change.finalText;
  }
  return results.map((result) => ({
    ...result,
    ok: true,
    backup: path.relative(opts.cwd, path.join(runDir, result.file)),
  }));
}

function confinedTarget(cwd: string, file: string, config: LoopConfig): string {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const clean = path.posix.normalize(normalized);
  if (
    !normalized ||
    path.isAbsolute(file) ||
    clean === '..' ||
    clean.startsWith('../') ||
    clean !== normalized
  ) {
    throw new Error('target path must stay inside the repository');
  }
  const protectedFiles = new Set(
    config.protectedFiles.map((candidate) =>
      path.posix.normalize(candidate.replace(/\\/g, '/').replace(/^\.\//, '')),
    ),
  );
  if (protectedFiles.has(clean)) throw new Error('file is listed in protectedFiles');

  const root = fs.realpathSync(cwd);
  const abs = path.resolve(root, ...clean.split('/'));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('target path must stay inside the repository');
  }

  let cursor = root;
  for (const segment of clean.split('/')) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('target path contains a symbolic link');
  }
  const real = fs.realpathSync(abs);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('target resolves outside the repository');
  }
  return abs;
}

function encodeReplacement(item: CopyItem, text: string): string {
  if (text.includes('\0')) throw new Error('replacement contains a NUL byte');
  switch (item.source?.representation) {
    case 'json-string':
    case 'js-string-double':
    case 'yaml-double':
      return JSON.stringify(text).slice(1, -1);
    case 'js-string-single':
      return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    case 'js-template':
      return text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    case 'html-text':
      return escapeHtml(text);
    case 'html-attribute-double':
      return escapeHtml(text).replace(/"/g, '&quot;');
    case 'html-attribute-single':
      return escapeHtml(text).replace(/'/g, '&#39;');
    case 'yaml-single':
      if (/[\r\n]/.test(text)) throw new Error('multiline text cannot replace a single-quoted YAML scalar');
      return text.replace(/'/g, "''");
    case 'yaml-plain':
      return /[:#\r\n]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
    case 'plain':
      return text;
    default:
      throw new Error('unsupported source representation');
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
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
