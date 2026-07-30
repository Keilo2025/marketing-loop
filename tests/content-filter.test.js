import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_CONTENT_FILTER,
  matchesContentFilter,
  normalizeContentFilter,
  resolveContentSelection,
} from '../dist/core/filter.js';
import { deriveHandoff } from '../dist/core/handoff.js';
import { digestInventoryItems } from '../dist/core/scan.js';

const items = [
  copy('cta', 'hero.primaryCta', 'cta'),
  copy('button', 'hero.cancelButton', 'label'),
  copy('headline', 'hero.headline', 'headline'),
  copy('nav', 'nav.account', 'nav'),
  copy('label', 'form.emailLabel', 'label'),
  copy('pricing', 'pricing.buyAction', 'cta'),
];

test('content filters normalize and combine type, group, and exact key selectors', () => {
  assert.deepEqual(normalizeContentFilter(), EMPTY_CONTENT_FILTER);
  assert.deepEqual(normalizeContentFilter({
    types: [' headline ', 'cta', 'cta'],
    groups: ['hero', 'hero'],
    keys: [],
  }), {
    schemaVersion: 1,
    types: ['cta', 'headline'],
    groups: ['hero'],
    keys: [],
  });

  const selection = resolveContentSelection(items, normalizeContentFilter({
    types: ['cta', 'headline'],
    groups: ['hero'],
  }), ['fr', 'de', 'fr']);

  assert.deepEqual(selection.resolvedKeys, ['hero.headline', 'hero.primaryCta']);
  assert.deepEqual(selection.targetLocales, ['de', 'fr']);
  assert.equal(matchesContentFilter(items[0], selection.filter), true);
  assert.equal(matchesContentFilter(items[5], selection.filter), false);

  const exact = resolveContentSelection(items, normalizeContentFilter({
    types: ['label'],
    keys: ['form.emailLabel'],
  }), ['de']);
  assert.deepEqual(exact.resolvedKeys, ['form.emailLabel']);
});

test('content type aliases match canonical catalogue identity and unknown types fail closed', () => {
  assert.equal(matchesContentFilter(items[1], normalizeContentFilter({ types: ['button'] })), true);
  assert.equal(matchesContentFilter(items[3], normalizeContentFilter({ types: ['navigation'] })), true);
  assert.equal(matchesContentFilter(items[4], normalizeContentFilter({ types: ['label'] })), true);
  assert.throws(
    () => normalizeContentFilter({ types: ['pricing-card'] }),
    /unsupported content type.*pricing-card/i,
  );
  assert.throws(
    () => resolveContentSelection(items, normalizeContentFilter({ groups: ['missing'] }), ['de']),
    /does not match any source-catalogue keys/i,
  );
  assert.throws(
    () => resolveContentSelection(items, EMPTY_CONTENT_FILTER, ['en']),
    /source locale/i,
  );
});

test('schema-v1 handoff persists selection and exposes only selected unresolved proposals', () => {
  const scopeDigest = 'scope-content';
  const sourceLocale = 'en';
  const selected = resolveContentSelection(items, normalizeContentFilter({
    types: ['cta'],
    groups: ['hero'],
  }), ['de', 'fr']);
  const inventoryItems = items.map((item) => ({
    ...item,
    sourceLocale,
    scopeDigest,
    file: 'messages/en.json',
  }));
  const inventoryDigest = digestInventoryItems(inventoryItems, scopeDigest, sourceLocale);
  const inventory = {
    schemaVersion: 5,
    scopeDigest,
    sourceLocale,
    runId: 'content-run',
    inventoryDigest,
    generatedAt: '',
    repositoryRoot: '/tmp/content-filter',
    filesScanned: 1,
    filesWithCopy: 1,
    truncated: false,
    items: inventoryItems,
  };
  const proposal = {
    id: 'proposal-cta',
    copyId: 'cta',
    catalogueKey: 'hero.primaryCta',
    sourceLocale,
    scopeDigest,
    file: 'messages/en.json',
    line: 1,
    kind: 'cta',
    before: 'Start',
    after: 'Get started',
    alternatives: [],
    rationale: '',
    problemSolved: '',
    principles: [],
    evidence: [],
    confidence: 0.8,
    status: 'pending',
    author: 'engine',
  };
  const set = {
    schemaVersion: 5,
    scopeDigest,
    sourceLocale,
    runId: 'content-run',
    inventoryDigest,
    generatedAt: '',
    product: 'test',
    selection: selected,
    proposals: [proposal],
  };
  const scope = {
    messagesDir: 'messages',
    sourceLocale,
    layout: 'single-file',
    files: ['messages/en.json'],
    scopeDigest,
  };

  const handoff = deriveHandoff(set, inventory, scope);
  assert.deepEqual(handoff.selection, {
    filter: {
      categories: [],
      groups: [],
      keys: selected.resolvedKeys,
    },
    requestedFilter: {
      categories: ['cta'],
      groups: ['hero'],
      keys: [],
    },
    resolvedKeys: selected.resolvedKeys,
    targetLocales: selected.targetLocales,
  });
  assert.deepEqual(handoff.unresolved.map((entry) => entry.key), ['hero.primaryCta']);

  assert.throws(
    () => deriveHandoff({
      ...set,
      proposals: [{
        ...proposal,
        id: 'proposal-pricing',
        copyId: 'pricing',
        catalogueKey: 'pricing.buyAction',
        before: 'Buy',
      }],
    }, inventory, scope),
    /outside the Content Loop selection/i,
  );
});

function copy(id, catalogueKey, kind) {
  return {
    id,
    catalogueKey,
    sourceLocale: 'en',
    scopeDigest: 'scope-content',
    file: 'messages/en.json',
    line: 1,
    text: id === 'pricing' ? 'Buy' : id === 'cta' ? 'Start' : `Text ${id}`,
    kind,
    surface: catalogueKey.startsWith('nav.') ? 'app' : 'landing',
    context: catalogueKey.split('.'),
    length: 10,
  };
}
