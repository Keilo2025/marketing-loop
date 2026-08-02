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
  BackupManifest,
  CopyItem,
  DecisionSet,
  Inventory,
  LoopConfig,
  Proposal,
  ProposalSet,
} from '../types.js';
import {
  ACTIVE_STATE_SCHEMA_ERROR,
  DEFAULT_SURFACES,
  STATE_SCHEMA_VERSION,
} from '../types.js';
import { hashText, readJsonStrict, writeJson, writeText } from '../util/fsx.js';
import { checkProposal } from './guardrails.js';
import { digestInventoryItems } from './scan.js';
import { isSafeRunId, validateDecisionSet } from './state.js';
import { isCatalogueTarget, resolveCatalogueScope } from './catalogue.js';
import { inferSurfaceFromKey } from './catalogue-extract.js';
import { resolveContentSelection } from './filter.js';

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
  const markAuthorizedFailed = (): void => {
    if (opts.dryRun) return;
    const authorizedIds = new Set(authorized.map((decision) => decision.proposalId));
    for (const proposal of set.proposals) {
      // Applied means the bytes are on disk; a later failure elsewhere in the
      // batch must not rewrite that fact.
      if (authorizedIds.has(proposal.id) && proposal.status !== 'applied') proposal.status = 'failed';
    }
  };
  const failAll = (reason: string): ApplyResult[] => {
    const ids = authorized.length
      ? authorized.map((decision) => decision.proposalId)
      : set.proposals.map((proposal) => proposal.id);
    const failures = ids.map((proposalId) => ({
      proposalId,
      file: set.proposals.find((proposal) => proposal.id === proposalId)?.file ?? '',
      ok: false,
      reason,
    }));
    markAuthorizedFailed();
    return failures;
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
    scope.scopeDigest !== set.scopeDigest ||
    scope.scopeDigest !== inventory.scopeDigest
  ) {
    return failAll('catalogue scope changed since review; run marketing-loop propose again');
  }
  if (digestInventoryItems(inventory.items, inventory.scopeDigest, inventory.sourceLocale) !== inventory.inventoryDigest) {
    return failAll('inventory digest does not match its contents');
  }
  let selectedKeys: Set<string> | undefined;
  if (set.selection) {
    try {
      const selection = resolveContentSelection(
        inventory.items,
        set.selection.filter,
        set.selection.targetLocales,
      );
      if (JSON.stringify(selection.resolvedKeys) !== JSON.stringify(set.selection.resolvedKeys)) {
        return failAll('Content Loop selection does not match the active inventory');
      }
      selectedKeys = new Set(selection.resolvedKeys);
    } catch (error) {
      return failAll(error instanceof Error ? error.message : String(error));
    }
  }
  const decisionErrors = validateDecisionSet(set, decisions);
  if (decisionErrors.length) return failAll(decisionErrors.join('; '));
  if (!isSafeRunId(set.runId)) {
    return failAll('active proposal run has an unsafe runId');
  }
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
    // Idempotent re-run: a proposal already written to the catalogue is not
    // written again. Its scan hash no longer matches by design, so attempting
    // it would fail preflight and poison the batch.
    if (proposal.status === 'applied') continue;
    const result: ApplyResult = { proposalId: proposal.id, file: proposal.file, ok: false };
    try {
      const item = itemById.get(proposal.copyId);
      if (!item) throw new Error('copyId is not present in the active inventory');
      if (selectedKeys && !selectedKeys.has(item.catalogueKey)) {
        throw new Error(`proposal ${proposal.id} is outside the active Content Loop selection`);
      }
      if (
        item.sourceLocale !== scope.sourceLocale ||
        !isCatalogueTarget(scope, item.file)
      ) {
        throw new Error('approved target is outside the source catalogue');
      }
      const canonicalSurface = inferSurfaceFromKey(item.catalogueKey);
      if (!(opts.config.surfaces ?? DEFAULT_SURFACES).includes(canonicalSurface)) {
        throw new Error(`surface ${canonicalSurface} is not configured for marketing apply`);
      }
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
      if (item.source.representation !== 'json-string') {
        throw new Error('unsupported source representation');
      }

      const finalText = decision.finalText;
      const guardrailHits = checkProposal(
        { ...proposal, edited: finalText, alternatives: [] },
        opts.config,
      ).filter((hit) => hit.severity === 'block');
      if (guardrailHits.length) {
        throw new Error(`final text blocked by guardrails: ${guardrailHits.map((hit) => hit.rule).join(', ')}`);
      }

      const abs = confinedTarget(opts.cwd, item.file);
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
    markAuthorizedFailed();
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

  let runDir: string;
  try {
    runDir = createBackupRunDir(opts.cwd, opts.backupDir, set.runId);
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
  }
  const realRoot = fs.realpathSync(opts.cwd);
  const written: string[] = [];
  try {
    const files = [...updates.keys()]
      .map((abs) => path.relative(realRoot, abs).split(path.sep).join('/'))
      .sort();
    for (const [abs, entry] of updates) {
      const rel = path.relative(realRoot, abs);
      writeText(path.join(runDir, rel), entry.original);
    }
    const manifest: BackupManifest = {
      schemaVersion: STATE_SCHEMA_VERSION,
      runId: set.runId,
      scopeDigest: set.scopeDigest,
      files,
    };
    writeJson(path.join(runDir, 'backup-manifest.json'), manifest);
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

function confinedTarget(cwd: string, file: string): string {
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
  if (item.source?.representation !== 'json-string') {
    throw new Error('unsupported source representation');
  }
  return JSON.stringify(text).slice(1, -1);
}

function ensureDirectoryWithoutSymlinks(
  cwd: string,
  directory: string,
  createMissing: boolean,
): string {
  const configuredRoot = path.resolve(cwd);
  const configuredTarget = path.resolve(configuredRoot, directory);
  const relative = path.relative(configuredRoot, configuredTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('backup directory must stay inside the repository');
  }

  const realRoot = fs.realpathSync(cwd);
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error('backup directory path contains a symbolic link');
      }
      if (!stat.isDirectory()) {
        throw new Error('backup directory path contains a non-directory');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!createMissing) throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  const real = fs.realpathSync(current);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error('backup directory resolves outside the repository');
  }
  return real;
}

function createBackupRunDir(cwd: string, backupDir: string, runId: string): string {
  if (!isSafeRunId(runId)) throw new Error('active proposal run has an unsafe runId');
  const root = ensureDirectoryWithoutSymlinks(cwd, backupDir, true);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${runId}`;
  const candidate = path.join(root, name);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('backup run directory must stay inside backupDir');
  }
  fs.mkdirSync(candidate, { mode: 0o700 });
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('backup run directory must be a real directory');
  }
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(root + path.sep)) {
    throw new Error('backup run directory resolves outside backupDir');
  }
  return real;
}

function isCanonicalCataloguePath(file: string): boolean {
  return (
    file.length > 0 &&
    !file.includes('\\') &&
    !file.includes('\0') &&
    !path.posix.isAbsolute(file) &&
    !/^[A-Za-z]:\//.test(file) &&
    !file.startsWith('./') &&
    !file.endsWith('/') &&
    path.posix.normalize(file) === file &&
    file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function runIdFromBackupDirectory(directory: string): string {
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(.+)$/.exec(directory);
  const runId = match?.[1];
  if (!isSafeRunId(runId)) {
    throw new Error('Invalid backup manifest: backup directory has an unsafe runId');
  }
  return runId;
}

function readBackupManifest(file: string, backupDirectory: string): BackupManifest {
  const value = readJsonStrict<unknown>(file);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid backup manifest: expected an object');
  }
  const manifest = value as Record<string, unknown>;
  const keys = Object.keys(manifest).sort();
  const expectedKeys = ['files', 'runId', 'schemaVersion', 'scopeDigest'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      'Invalid backup manifest: expected exactly schemaVersion, runId, scopeDigest, and files',
    );
  }
  if (manifest.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error('Invalid backup manifest: schemaVersion must be 5');
  }
  if (!isSafeRunId(manifest.runId)) {
    throw new Error('Invalid backup manifest: unsafe runId');
  }
  if (manifest.runId !== runIdFromBackupDirectory(backupDirectory)) {
    throw new Error('Invalid backup manifest: runId does not match the selected backup directory');
  }
  if (
    typeof manifest.scopeDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.scopeDigest)
  ) {
    throw new Error('Invalid backup manifest: scopeDigest must be a SHA-256 digest');
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.some((file) => typeof file !== 'string')
  ) {
    throw new Error('Invalid backup manifest: files must be an array of strings');
  }
  const files = manifest.files as string[];
  if (files.length === 0) {
    throw new Error('Invalid backup manifest: files must be a non-empty array');
  }
  if (new Set(files).size !== files.length) {
    throw new Error('Invalid backup manifest: files must contain unique paths');
  }
  if (files.some((entry) => !isCanonicalCataloguePath(entry))) {
    throw new Error('Invalid backup manifest: files must be canonical forward-slash catalogue paths');
  }
  return manifest as unknown as BackupManifest;
}

function confinedBackup(runPath: string, file: string): string {
  const root = fs.realpathSync(runPath);
  const abs = path.resolve(root, ...file.split('/'));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('backup path must stay inside the backup run');
  }
  let cursor = root;
  for (const segment of file.split('/')) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('backup path contains a symbolic link');
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`backup file is not a regular file: ${file}`);
  const real = fs.realpathSync(abs);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('backup file resolves outside the backup run');
  }
  return abs;
}

/** Restore the most recent backup run. */
export function revert(cwd: string, config: LoopConfig, backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  const backupRoot = ensureDirectoryWithoutSymlinks(cwd, backupDir, false);
  const runs = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const latest = runs.at(-1);
  if (!latest) return [];

  const runPath = path.join(backupRoot, latest);
  const manifestPath = path.join(runPath, 'backup-manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('Invalid backup manifest: backup-manifest.json must be a regular file');
  }
  const manifest = readBackupManifest(manifestPath, latest);
  const scope = resolveCatalogueScope(cwd, config);
  if (manifest.scopeDigest !== scope.scopeDigest) {
    throw new Error('backup catalogue scope does not match the current catalogue scope');
  }

  const prepared = manifest.files.map((file) => {
    if (!isCatalogueTarget(scope, file)) {
      throw new Error(`backup target is outside the current source catalogue: ${file}`);
    }
    const target = confinedTarget(cwd, file);
    const backup = confinedBackup(runPath, file);
    return {
      file,
      target,
      original: fs.readFileSync(target, 'utf8'),
      backup: fs.readFileSync(backup, 'utf8'),
    };
  });

  const written: typeof prepared = [];
  try {
    for (const entry of prepared) {
      writeText(entry.target, entry.backup);
      written.push(entry);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const entry of written.reverse()) {
      try {
        writeText(entry.target, entry.original);
      } catch (rollbackError) {
        rollbackFailures.push(
          `${entry.file}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      rollbackFailures.length
        ? `atomic revert failed (${reason}); rollback was incomplete: ${rollbackFailures.join('; ')}`
        : `atomic revert failed and was rolled back: ${reason}`,
    );
  }

  return prepared.map((entry) => entry.file);
}
