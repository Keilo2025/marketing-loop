import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deriveHandoff, writeHandoff } from '../dist/core/handoff.js';
import { defaultConfig, paths } from '../dist/config.js';
import { digestInventoryItems } from '../dist/core/scan.js';
import { rotateActiveRun } from '../dist/core/state.js';
import { hashText } from '../dist/util/fsx.js';

function handoffState(proposals) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-handoff-'));
  const scopeDigest = 'scope-digest';
  const sourceLocale = 'en';
  const items = proposals.map((proposal, index) => ({
    id: `copy-${proposal.id}`,
    catalogueKey: proposal.key,
    sourceLocale,
    scopeDigest,
    file: `messages/en-${index}.json`,
    line: 1,
    text: `Source ${proposal.id}`,
    kind: 'headline',
    surface: 'landing',
    context: [],
    length: 8,
  }));
  const inventoryDigest = digestInventoryItems(items, scopeDigest, sourceLocale);
  const inventory = {
    schemaVersion: 5,
    scopeDigest,
    sourceLocale,
    runId: 'run-1',
    inventoryDigest,
    generatedAt: '',
    repositoryRoot: directory,
    filesScanned: items.length,
    filesWithCopy: items.length,
    truncated: false,
    items,
  };
  const set = {
    schemaVersion: 5,
    scopeDigest,
    sourceLocale,
    runId: 'run-1',
    inventoryDigest,
    generatedAt: '',
    product: 'test',
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      copyId: `copy-${proposal.id}`,
      catalogueKey: proposal.key,
      sourceLocale,
      scopeDigest,
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
    sourceLocale,
    layout: 'single-file',
    files: items.map((item) => item.file),
    scopeDigest,
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

test('handoff entries preserve exact catalogue identity and sort by key then file', () => {
  const state = handoffState([
    { id: 'z', key: 'hero.title', status: 'pending' },
    { id: 'a', key: 'hero.cta', status: 'approved' },
    { id: 'b', key: 'hero.cta', status: 'pending' },
  ]);
  try {
    const handoff = deriveHandoff(state.set, state.inventory, state.scope);
    assert.deepEqual(handoff.unresolved, [
      {
        key: 'hero.cta',
        file: 'messages/en-1.json',
        sourceHash: hashText('Source a'),
        status: 'approved',
      },
      {
        key: 'hero.cta',
        file: 'messages/en-2.json',
        sourceHash: hashText('Source b'),
        status: 'pending',
      },
      {
        key: 'hero.title',
        file: 'messages/en-0.json',
        sourceHash: hashText('Source z'),
        status: 'pending',
      },
    ]);
  } finally {
    fs.rmSync(state.directory, { recursive: true, force: true });
  }
});

test('handoff rejects a proposal whose copyId cannot resolve to the inventory', () => {
  const state = handoffState([{ id: 'a', key: 'hero.title', status: 'pending' }]);
  try {
    state.set.proposals[0].copyId = 'missing-copy';
    assert.throws(
      () => deriveHandoff(state.set, state.inventory, state.scope),
      /cannot resolve to an active catalogue item/,
    );
  } finally {
    fs.rmSync(state.directory, { recursive: true, force: true });
  }
});

const handoffIdentityMismatches = [
  {
    name: 'proposal-set schema',
    mutate: (state) => { state.set.schemaVersion = 4; },
  },
  {
    name: 'inventory schema',
    mutate: (state) => { state.inventory.schemaVersion = 4; },
  },
  {
    name: 'runId',
    mutate: (state) => { state.set.runId = 'other-run'; },
  },
  {
    name: 'inventory digest',
    mutate: (state) => { state.set.inventoryDigest = 'other-digest'; },
  },
  {
    name: 'proposal-set scope digest',
    mutate: (state) => { state.set.scopeDigest = 'other-scope'; },
  },
  {
    name: 'inventory scope digest',
    mutate: (state) => { state.inventory.scopeDigest = 'other-scope'; },
  },
  {
    name: 'proposal-set source locale',
    mutate: (state) => { state.set.sourceLocale = 'fr'; },
  },
  {
    name: 'inventory source locale',
    mutate: (state) => { state.inventory.sourceLocale = 'fr'; },
  },
  {
    name: 'proposal catalogue key',
    mutate: (state) => { state.set.proposals[0].catalogueKey = 'other.key'; },
  },
  {
    name: 'proposal catalogue file',
    mutate: (state) => { state.set.proposals[0].file = 'messages/other.json'; },
  },
  {
    name: 'proposal source locale',
    mutate: (state) => { state.set.proposals[0].sourceLocale = 'fr'; },
  },
  {
    name: 'proposal scope digest',
    mutate: (state) => { state.set.proposals[0].scopeDigest = 'other-scope'; },
  },
  {
    name: 'proposal source text',
    mutate: (state) => { state.set.proposals[0].before = 'Other source'; },
  },
  {
    name: 'proposal source line',
    mutate: (state) => { state.set.proposals[0].line = 99; },
  },
  {
    name: 'proposal copy kind',
    mutate: (state) => { state.set.proposals[0].kind = 'cta'; },
  },
  {
    name: 'rejected proposal target',
    mutate: (state) => {
      state.set.proposals[0].status = 'rejected';
      state.set.proposals[0].file = 'messages/other.json';
    },
  },
  {
    name: 'inventory target outside the resolved scope',
    mutate: (state) => { state.scope.files = []; },
  },
];

for (const mismatch of handoffIdentityMismatches) {
  test(`handoff rejects ${mismatch.name} mismatches`, () => {
    const state = handoffState([{ id: 'a', key: 'hero.title', status: 'pending' }]);
    try {
      mismatch.mutate(state);
      assert.throws(
        () => deriveHandoff(state.set, state.inventory, state.scope),
        /schema v5|does not match|outside the resolved source catalogue/i,
      );
    } finally {
      fs.rmSync(state.directory, { recursive: true, force: true });
    }
  });
}

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
