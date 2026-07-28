import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { defaultConfig } from '../dist/config.js';
import { applyProposals, revert } from '../dist/core/apply.js';
import { digestInventoryItems, scanRepo } from '../dist/core/scan.js';
import { proposalDigest } from '../dist/core/state.js';

function approvedCatalogueState() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-catalogue-apply-'));
  const sourceFile = path.join(cwd, 'messages', 'en.json');
  const germanFile = path.join(cwd, 'messages', 'de.json');
  const codeFile = path.join(cwd, 'src', 'page.tsx');
  const originalSource = '{"cta":"Start my audit"}\n';
  const originalGerman = '{"cta":"Mein Audit starten"}\n';
  const originalCode = 'export const cta = "Start my audit";\n';
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.dirname(codeFile), { recursive: true });
  fs.writeFileSync(sourceFile, originalSource);
  fs.writeFileSync(germanFile, originalGerman);
  fs.writeFileSync(codeFile, originalCode);

  const config = {
    ...defaultConfig,
    include: ['.'],
    exclude: [],
    protectedFiles: [],
    catalogue: {
      messagesDir: 'messages',
      sourceLocale: 'en',
      layout: 'single-file',
    },
  };
  const scan = scanRepo(cwd, config, 'catalogue-apply-run');
  const item = scan.items[0];
  assert.ok(item, 'the real source-catalogue scan must find the fixture copy');
  const inventory = {
    schemaVersion: 5,
    scopeDigest: scan.scopeDigest,
    sourceLocale: scan.sourceLocale,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    repositoryRoot: cwd,
    filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy,
    truncated: scan.truncated,
    items: scan.items,
  };
  const proposal = {
    id: 'catalogue-proposal',
    copyId: item.id,
    catalogueKey: item.catalogueKey,
    sourceLocale: item.sourceLocale,
    scopeDigest: item.scopeDigest,
    file: item.file,
    line: item.line,
    kind: item.kind,
    before: item.text,
    after: 'Run my audit',
    alternatives: [],
    rationale: 'Names the action.',
    problemSolved: 'The original was vague.',
    principles: [],
    evidence: [],
    confidence: 0.8,
    status: 'pending',
    author: 'engine',
  };
  const set = {
    schemaVersion: 5,
    scopeDigest: scan.scopeDigest,
    sourceLocale: scan.sourceLocale,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    product: 'test',
    proposals: [proposal],
  };
  const decisions = {
    schemaVersion: 5,
    scopeDigest: scan.scopeDigest,
    sourceLocale: scan.sourceLocale,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    decisions: [{
      proposalId: proposal.id,
      proposalDigest: proposalDigest(proposal, proposal.after),
      decision: 'approved',
      finalText: proposal.after,
      source: 'markdown',
      decidedAt: new Date().toISOString(),
    }],
  };

  return {
    cwd,
    sourceFile,
    germanFile,
    codeFile,
    originalSource,
    originalGerman,
    originalCode,
    config,
    inventory,
    set,
    decisions,
    options() {
      return {
        cwd,
        config,
        backupDir: path.join(cwd, '.marketing-loop', 'backups'),
        inventory,
        decisions,
      };
    },
  };
}

test('apply refuses an inventory item forged to target code', () => {
  const state = approvedCatalogueState();
  try {
    state.inventory.items[0].file = 'src/page.tsx';
    state.inventory.inventoryDigest = digestInventoryItems(state.inventory.items);
    state.set.inventoryDigest = state.inventory.inventoryDigest;
    state.decisions.inventoryDigest = state.inventory.inventoryDigest;
    const results = applyProposals(state.set, state.options());
    assert.match(results[0].reason, /outside the source catalogue/);
    assert.equal(fs.readFileSync(state.codeFile, 'utf8'), state.originalCode);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
});

test('apply changes only the source catalogue', () => {
  const state = approvedCatalogueState();
  try {
    const beforeGerman = fs.readFileSync(state.germanFile, 'utf8');
    const results = applyProposals(state.set, state.options());
    assert.equal(results[0].ok, true);
    assert.equal(fs.readFileSync(state.germanFile, 'utf8'), beforeGerman);
    assert.equal(fs.readFileSync(state.codeFile, 'utf8'), state.originalCode);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
});

test('apply rejects a forged runId before creating a backup outside backupDir', () => {
  const state = approvedCatalogueState();
  try {
    const forgedRunId = '../../../../escaped-run';
    state.set.runId = forgedRunId;
    state.inventory.runId = forgedRunId;
    state.decisions.runId = forgedRunId;
    const escaped = path.join(state.cwd, 'escaped-run');

    const results = applyProposals(state.set, state.options());

    assert.equal(results[0].ok, false);
    assert.match(results[0].reason, /unsafe runId/i);
    assert.equal(fs.existsSync(escaped), false);
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), state.originalSource);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
});

test('apply rejects a backup directory with an existing symlink component', () => {
  const state = approvedCatalogueState();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-external-backup-'));
  try {
    const externalBackups = path.join(external, 'backups');
    fs.mkdirSync(externalBackups);
    fs.symlinkSync(external, path.join(state.cwd, 'backup-link'));

    const results = applyProposals(state.set, {
      ...state.options(),
      backupDir: path.join(state.cwd, 'backup-link', 'backups'),
    });

    assert.equal(results[0].ok, false);
    assert.match(results[0].reason, /backup directory.*symbolic link/i);
    assert.deepEqual(fs.readdirSync(externalBackups), []);
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), state.originalSource);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('revert refuses a backup outside the current source catalogue', () => {
  const state = approvedCatalogueState();
  try {
    const backupDir = path.join(state.cwd, '.marketing-loop', 'backups');
    const results = applyProposals(state.set, {
      ...state.options(),
      backupDir,
    });
    assert.equal(results[0].ok, true, results[0].reason);
    const appliedSource = fs.readFileSync(state.sourceFile, 'utf8');

    const currentSource = path.join(state.cwd, 'current-messages', 'en.json');
    fs.mkdirSync(path.dirname(currentSource), { recursive: true });
    fs.writeFileSync(currentSource, '{"cta":"Current catalogue"}\n');
    const changedConfig = {
      ...state.config,
      catalogue: {
        ...state.config.catalogue,
        messagesDir: 'current-messages',
      },
    };

    assert.throws(
      () => revert(state.cwd, changedConfig, backupDir),
      /scope|outside the current source catalogue/i,
    );
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), appliedSource);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
});

test('revert restores the manifest-listed source catalogue file', () => {
  const state = approvedCatalogueState();
  try {
    const backupDir = path.join(state.cwd, '.marketing-loop', 'backups');
    const results = applyProposals(state.set, {
      ...state.options(),
      backupDir,
    });
    assert.equal(results[0].ok, true, results[0].reason);

    const runs = fs.readdirSync(backupDir).sort();
    assert.equal(runs.length, 1);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backupDir, runs[0], 'backup-manifest.json'), 'utf8'),
    );
    assert.deepEqual(manifest, {
      schemaVersion: 5,
      runId: state.set.runId,
      scopeDigest: state.set.scopeDigest,
      files: ['messages/en.json'],
    });

    const restored = revert(state.cwd, state.config, backupDir);
    assert.deepEqual(restored, ['messages/en.json']);
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), state.originalSource);
    assert.equal(fs.readFileSync(state.germanFile, 'utf8'), state.originalGerman);
    assert.equal(fs.readFileSync(state.codeFile, 'utf8'), state.originalCode);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
});

function appliedBackupState() {
  const state = approvedCatalogueState();
  const backupDir = path.join(state.cwd, '.marketing-loop', 'backups');
  const results = applyProposals(state.set, {
    ...state.options(),
    backupDir,
  });
  assert.equal(results[0].ok, true, results[0].reason);
  const runs = fs.readdirSync(backupDir).sort();
  assert.equal(runs.length, 1);
  const runDir = path.join(backupDir, runs[0]);
  const manifestPath = path.join(runDir, 'backup-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    ...state,
    backupDir,
    runDir,
    manifestPath,
    manifest,
    appliedSource: fs.readFileSync(state.sourceFile, 'utf8'),
  };
}

function assertManifestRejected(mutate, expected) {
  const state = appliedBackupState();
  try {
    mutate(state);
    fs.writeFileSync(state.manifestPath, JSON.stringify(state.manifest));
    assert.throws(
      () => revert(state.cwd, state.config, state.backupDir),
      expected,
    );
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), state.appliedSource);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
  }
}

test('revert rejects a backup directory replaced by a symbolic link', () => {
  const state = appliedBackupState();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-external-revert-'));
  try {
    const externalBackups = path.join(external, 'backups');
    fs.renameSync(state.backupDir, externalBackups);
    fs.symlinkSync(externalBackups, state.backupDir);

    assert.throws(
      () => revert(state.cwd, state.config, state.backupDir),
      /backup directory.*symbolic link/i,
    );
    assert.equal(fs.readFileSync(state.sourceFile, 'utf8'), state.appliedSource);
  } finally {
    fs.rmSync(state.cwd, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('revert rejects backup manifests with unknown fields', () => {
  assertManifestRejected(
    (state) => { state.manifest.extra = true; },
    /exactly schemaVersion, runId, scopeDigest, and files/i,
  );
});

test('revert rejects backup manifests with unsafe runIds', () => {
  assertManifestRejected(
    (state) => { state.manifest.runId = '../unsafe'; },
    /unsafe runId/i,
  );
});

test('revert binds the manifest runId to the selected backup directory', () => {
  assertManifestRejected(
    (state) => { state.manifest.runId = 'another-run'; },
    /runId does not match.*backup directory/i,
  );
});

test('revert rejects backup manifests with invalid scope digests', () => {
  assertManifestRejected(
    (state) => { state.manifest.scopeDigest = 'not-a-digest'; },
    /scopeDigest must be a SHA-256 digest/i,
  );
});

test('revert rejects backup manifests with an empty file list', () => {
  assertManifestRejected(
    (state) => { state.manifest.files = []; },
    /files must be a non-empty/i,
  );
});

test('revert rejects backup manifests with duplicate file paths', () => {
  assertManifestRejected(
    (state) => { state.manifest.files.push(state.manifest.files[0]); },
    /files must contain unique/i,
  );
});

test('revert rejects backup manifests with noncanonical file paths', () => {
  assertManifestRejected(
    (state) => { state.manifest.files = ['./messages/en.json']; },
    /canonical forward-slash/i,
  );
});
