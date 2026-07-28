import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deriveHandoff, writeHandoff } from '../dist/core/handoff.js';
import { defaultConfig, paths } from '../dist/config.js';
import { rotateActiveRun } from '../dist/core/state.js';

function handoffState(proposals) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-handoff-'));
  const items = proposals.map((proposal, index) => ({
    id: `copy-${proposal.id}`,
    catalogueKey: proposal.key,
    sourceLocale: 'en',
    file: `messages/en-${index}.json`,
    line: 1,
    text: `Source ${proposal.id}`,
    kind: 'headline',
    surface: 'landing',
    context: [],
    length: 8,
  }));
  const inventory = {
    schemaVersion: 5,
    scopeDigest: 'scope-digest',
    sourceLocale: 'en',
    runId: 'run-1',
    inventoryDigest: 'inventory-digest',
    generatedAt: '',
    repositoryRoot: directory,
    filesScanned: items.length,
    filesWithCopy: items.length,
    truncated: false,
    items,
  };
  const set = {
    schemaVersion: 5,
    scopeDigest: 'scope-digest',
    sourceLocale: 'en',
    runId: 'run-1',
    inventoryDigest: 'inventory-digest',
    generatedAt: '',
    product: 'test',
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      copyId: `copy-${proposal.id}`,
      catalogueKey: proposal.key,
      sourceLocale: 'en',
      scopeDigest: 'scope-digest',
      file: items.find((item) => item.id === `copy-${proposal.id}`).file,
      line: 1,
      kind: 'headline',
      before: `Source ${proposal.id}`,
      after: `After ${proposal.id}`,
      alternatives: [],
      rationale: '',
      problemSolved: '',
      principles: [],
      evidence: [],
      confidence: 0.8,
      status: proposal.status,
      author: 'engine',
    })),
  };
  const scope = {
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    files: items.map((item) => item.file),
    scopeDigest: 'scope-digest',
  };
  return { directory, file: path.join(directory, 'handoff.json'), set, inventory, scope };
}

test('handoff contains only pending and approved catalogue keys', () => {
  const state = handoffState([
    { id: 'a', key: 'hero.title', status: 'pending' },
    { id: 'b', key: 'hero.cta', status: 'approved' },
    { id: 'c', key: 'hero.body', status: 'rejected' },
    { id: 'd', key: 'hero.note', status: 'failed' },
    { id: 'e', key: 'hero.done', status: 'applied' },
  ]);
  try {
    const handoff = deriveHandoff(state.set, state.inventory, state.scope);
    assert.deepEqual(
      handoff.unresolved.map(({ key, status }) => ({ key, status })),
      [
        { key: 'hero.cta', status: 'approved' },
        { key: 'hero.title', status: 'pending' },
      ],
    );
  } finally {
    fs.rmSync(state.directory, { recursive: true, force: true });
  }
});

test('writeHandoff replaces the manifest atomically after rejection', () => {
  const state = handoffState([{ id: 'a', key: 'hero.title', status: 'pending' }]);
  try {
    writeHandoff(state.file, state.set, state.inventory, state.scope);
    state.set.proposals[0].status = 'rejected';
    const written = writeHandoff(state.file, state.set, state.inventory, state.scope);
    assert.deepEqual(written.unresolved, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(state.file, 'utf8')), written);
    assert.equal(fs.readdirSync(state.directory).some((name) => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(state.directory, { recursive: true, force: true });
  }
});

test('handoff path rotates with the active run', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-handoff-rotate-'));
  try {
    const p = paths(directory, defaultConfig);
    assert.equal(p.handoff, path.join(directory, '.marketing-loop', 'handoff.json'));
    fs.mkdirSync(p.out, { recursive: true });
    fs.writeFileSync(p.inventory, JSON.stringify({ schemaVersion: 5, runId: 'run-1' }));
    fs.writeFileSync(p.handoff, JSON.stringify({ schemaVersion: 1, marketingRunId: 'run-1' }));

    rotateActiveRun(p.out);

    assert.equal(fs.existsSync(p.handoff), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(p.history, 'run-1', 'handoff.json'), 'utf8')),
      { schemaVersion: 1, marketingRunId: 'run-1' },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
