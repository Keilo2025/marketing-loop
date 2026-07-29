import assert from 'node:assert/strict';
import test from 'node:test';

import { createLanguageLoopAdapter } from '../dist/core/content-language.js';

const selectedKeys = ['hero.primaryCta'];
const targetLocales = ['de', 'fr'];

test('filtered Content Loop fails closed when Language Loop does not advertise key-filter API v1', async () => {
  let runnerCalls = 0;
  const module = languageModule({
    apiVersion: null,
    runTranslationLoop: async () => {
      runnerCalls++;
      return summary('complete');
    },
  });
  const adapter = createLanguageLoopAdapter({ cwd: '/project', module });

  const result = await adapter.run({
    execute: true,
    keys: selectedKeys,
    locales: targetLocales,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.retryable, false);
  assert.match(result.error, /CONTENT_LOOP_API_VERSION.*1/i);
  assert.equal(runnerCalls, 0);
});

test('adapter passes exact selected keys and every selected locale to the Language Loop runner', async () => {
  let received;
  const memory = makeMemory();
  const progress = [];
  const module = languageModule({
    memory,
    runTranslationLoop: async (input) => {
      received = input;
      approve(memory, 'hero.primaryCta', 'de');
      approve(memory, 'hero.primaryCta', 'fr');
      return summary('complete', { applied: 2 });
    },
  });
  const adapter = createLanguageLoopAdapter({ cwd: '/project', module });

  const result = await adapter.run({
    execute: true,
    keys: selectedKeys,
    locales: targetLocales,
    onProgress: (rows) => progress.push(rows),
  });

  assert.deepEqual(received.keys, selectedKeys);
  assert.deepEqual(received.locales, targetLocales);
  assert.equal(result.status, 'complete');
  assert.deepEqual(
    result.progress.map(({ locale, accepted, total }) => ({ locale, accepted, total })),
    [
      { locale: 'de', accepted: 1, total: 1 },
      { locale: 'fr', accepted: 1, total: 1 },
    ],
  );
  assert.ok(progress.length >= 1);
  assert.deepEqual(progress.at(-1).map((row) => row.locale), targetLocales);
});

test('adapter never accepts a partial all-language result as complete', async () => {
  const memory = makeMemory();
  const module = languageModule({
    memory,
    runTranslationLoop: async () => {
      approve(memory, 'hero.primaryCta', 'de');
      return summary('complete', { applied: 1 });
    },
  });
  const adapter = createLanguageLoopAdapter({ cwd: '/project', module });

  const result = await adapter.run({
    execute: true,
    keys: selectedKeys,
    locales: targetLocales,
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.error, /outstanding.*fr/i);
  assert.equal(result.progress[0].accepted, 1);
  assert.equal(result.progress[1].pending, 1);
});

test('adapter reports a provider availability pause as retryable without losing language progress', async () => {
  const module = languageModule({
    runTranslationLoop: async () => {
      throw new Error('provider unavailable: rate limit exceeded');
    },
  });
  const adapter = createLanguageLoopAdapter({ cwd: '/project', module });

  const result = await adapter.run({
    execute: true,
    keys: selectedKeys,
    locales: targetLocales,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.retryable, true);
  assert.match(result.error, /rate limit/i);
  assert.deepEqual(result.progress.map((row) => row.pending), [1, 1]);
});

test('unfiltered catalogue remains compatible with the current Language Loop API', async () => {
  let calls = 0;
  const memory = makeMemory();
  const module = languageModule({
    apiVersion: null,
    memory,
    runTranslationLoop: async () => {
      calls++;
      for (const key of Object.keys(memory.entries)) {
        for (const locale of targetLocales) approve(memory, key, locale);
      }
      return summary('complete', { applied: 4 });
    },
  });
  const adapter = createLanguageLoopAdapter({ cwd: '/project', module });

  const result = await adapter.run({
    execute: true,
    keys: Object.keys(memory.entries),
    locales: targetLocales,
  });

  assert.equal(result.status, 'complete');
  assert.equal(calls, 1);
});

function languageModule({
  apiVersion = 1,
  memory = makeMemory(),
  runTranslationLoop,
} = {}) {
  const config = {
    sourceLocale: 'en',
    locales: ['en', ...targetLocales],
    ai: {
      translator: 'translator',
      judge: 'judge',
    },
  };
  return {
    ...(apiVersion === null ? {} : { CONTENT_LOOP_API_VERSION: apiVersion }),
    requireConfig: () => config,
    loadMemory: () => memory,
    saveMemory: () => {},
    adoptCatalogEdits: () => 0,
    adoptSourceEdits: () => [],
    inspectMarketingHandoff: () => ({
      compatible: true,
      unresolvedKeys: new Set(),
    }),
    runTranslationLoop,
    ProviderRegistry: class {
      registerTranslator() { return this; }
      registerJudge() { return this; }
      translator() {
        return { translate: async () => [] };
      }
      judge() {
        return { judge: async () => [] };
      }
    },
    GoogleTllmProvider: class {},
    OpenAiJudgeProvider: class {},
  };
}

function makeMemory() {
  return {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '2026-07-29T00:00:00.000Z',
    entries: {
      'hero.primaryCta': entry('Start now', 'hash-primary'),
      'footer.legal': entry('Terms', 'hash-legal'),
    },
  };
}

function entry(source, sourceHash) {
  return {
    source,
    sourceHash,
    namespace: 'common',
    kind: 'cta',
    file: 'messages/en.json',
    placeholders: [],
    firstSeen: '2026-07-29T00:00:00.000Z',
    lastSeen: '2026-07-29T00:00:00.000Z',
    translations: {},
  };
}

function approve(memory, key, locale) {
  const sourceHash = memory.entries[key].sourceHash;
  memory.entries[key].translations[locale] = {
    value: `${key}:${locale}`,
    sourceHash,
    status: 'approved',
    updatedAt: '2026-07-29T00:00:00.000Z',
    by: 'test',
  };
}

function summary(status, overrides = {}) {
  return {
    status,
    batches: 1,
    translated: 0,
    applied: 0,
    rework: 0,
    needsHuman: 0,
    marketingBlocked: 0,
    ...overrides,
  };
}
