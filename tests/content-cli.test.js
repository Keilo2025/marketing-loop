import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'dist/cli.js');

test('content command carries one filter through proposal, approval, handoff, and all-language translation', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cli-'));
  try {
    writeFixture(cwd);
    const modulePath = path.join(cwd, 'fake-language-loop.mjs');

    const plan = run(cwd, 'content', 'plan', '--types', 'cta', '--groups', 'hero', '--json');
    const planned = JSON.parse(plan.stdout);
    assert.deepEqual(planned.resolvedKeys, ['hero.primaryCta']);
    assert.deepEqual(planned.targetLocales, ['de', 'fr']);

    run(cwd, 'content', '--types', 'cta', '--groups', 'hero', '--language-module', modulePath);
    let state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'waiting-review');
    assert.deepEqual(state.selection.resolvedKeys, ['hero.primaryCta']);

    let proposals = readJson(cwd, '.marketing-loop/proposals.json');
    assert.ok(proposals.proposals.length > 0);
    assert.ok(proposals.proposals.every((proposal) => proposal.catalogueKey === 'hero.primaryCta'));
    assert.deepEqual(proposals.selection, state.selection);

    const reviewFile = path.join(cwd, '.marketing-loop/review.md');
    const review = fs.readFileSync(reviewFile, 'utf8');
    fs.writeFileSync(reviewFile, review.replace('- [ ] APPROVE', '- [x] APPROVE'));

    run(cwd, 'content', '--language-module', modulePath);
    state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'language-ready');
    assert.deepEqual(state.language.progress.map((row) => row.locale), ['de', 'fr']);
    assert.deepEqual(state.language.progress.map((row) => row.pending), [1, 1]);

    const handoff = readJson(cwd, '.marketing-loop/handoff.json');
    assert.deepEqual(handoff.selection.resolvedKeys, ['hero.primaryCta']);
    assert.deepEqual(handoff.unresolved, []);

    const beforeGerman = readJson(cwd, 'messages/de.json');
    const beforeFrench = readJson(cwd, 'messages/fr.json');
    run(cwd, 'content', '--llm', '--language-module', modulePath);
    state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'complete');
    assert.deepEqual(
      state.language.progress.map(({ locale, accepted, total }) => ({ locale, accepted, total })),
      [
        { locale: 'de', accepted: 1, total: 1 },
        { locale: 'fr', accepted: 1, total: 1 },
      ],
    );

    const calls = readJson(cwd, '.language-loop/content-calls.json');
    assert.deepEqual(calls.at(-1), {
      keys: ['hero.primaryCta'],
      locales: ['de', 'fr'],
    });
    const afterGerman = readJson(cwd, 'messages/de.json');
    const afterFrench = readJson(cwd, 'messages/fr.json');
    assert.notEqual(afterGerman.hero.primaryCta, beforeGerman.hero.primaryCta);
    assert.notEqual(afterFrench.hero.primaryCta, beforeFrench.hero.primaryCta);
    assert.equal(afterGerman.hero.headline, beforeGerman.hero.headline);
    assert.equal(afterFrench.hero.headline, beforeFrench.hero.headline);
    assert.deepEqual(afterGerman.footer, beforeGerman.footer);
    assert.deepEqual(afterFrench.footer, beforeFrench.footer);

    proposals = readJson(cwd, '.marketing-loop/proposals.json');
    assert.ok(proposals.proposals.every((proposal) => proposal.catalogueKey === 'hero.primaryCta'));
    const status = run(cwd, 'content', 'status');
    assert.match(status.stdout, /cta/);
    assert.match(status.stdout, /hero/);
    assert.match(status.stdout, /de, fr/);
    assert.match(status.stdout, /1\/1 accepted/g);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('content loop ignores a review collection in which nothing was ticked', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cli-gate-'));
  try {
    writeFixture(cwd);
    const modulePath = path.join(cwd, 'fake-language-loop.mjs');

    run(cwd, 'content', '--types', 'cta', '--groups', 'hero', '--language-module', modulePath);
    let state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'waiting-review');

    // Collecting the untouched review file records an implicit reject for
    // every proposal. That is not a human decision and must not open the gate.
    run(cwd, 'review', '--collect');
    run(cwd, 'content', '--types', 'cta', '--groups', 'hero', '--language-module', modulePath);
    state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'waiting-review', 'implicit rejects are not a review');
    assert.equal(state.marketing.explicitDecisions, 0);

    // A real tick is.
    const reviewFile = path.join(cwd, '.marketing-loop/review.md');
    const review = fs.readFileSync(reviewFile, 'utf8');
    fs.writeFileSync(reviewFile, review.replace('- [ ] APPROVE', '- [x] APPROVE'));
    run(cwd, 'review', '--collect');
    run(cwd, 'content', '--types', 'cta', '--groups', 'hero', '--language-module', modulePath);
    state = readJson(cwd, '.marketing-loop/content-loop.json');
    assert.equal(state.phase, 'language-ready');
    assert.equal(state.marketing.explicitDecisions, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--cwd', cwd], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function readJson(cwd, file) {
  return JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
}

function writeFixture(cwd) {
  fs.mkdirSync(path.join(cwd, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.language-loop'), { recursive: true });
  const source = {
    hero: {
      headline: 'Your deployment dashboard',
      primaryCta: 'Get Started',
    },
    footer: {
      legal: 'Terms of Service',
    },
  };
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), JSON.stringify(source, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'messages/de.json'), JSON.stringify({
    hero: {
      headline: 'Ihr Deployment-Dashboard',
      primaryCta: 'Loslegen',
    },
    footer: {
      legal: 'Nutzungsbedingungen',
    },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'messages/fr.json'), JSON.stringify({
    hero: {
      headline: 'Votre tableau de déploiement',
      primaryCta: 'Commencer',
    },
    footer: {
      legal: "Conditions d'utilisation",
    },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'marketing-loop.config.json'), JSON.stringify({
    catalogue: {
      messagesDir: 'messages',
      sourceLocale: 'en',
      layout: 'single-file',
    },
    outDir: '.marketing-loop',
    dataDir: 'marketing-data',
    audience: 'engineering teams',
    allowedClaims: [],
    maxProposals: 10,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'language-loop.config.json'), JSON.stringify({
    sourceLocale: 'en',
    locales: ['en', 'de', 'fr'],
    messagesDir: 'messages',
    layout: 'single-file',
    ai: {
      translator: 'fake-translator',
      judge: 'fake-judge',
    },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, '.language-loop/memory.json'), JSON.stringify({
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: {
      'hero.headline': memoryEntry(source.hero.headline, 'headline'),
      'hero.primaryCta': memoryEntry(source.hero.primaryCta, 'cta'),
      'footer.legal': memoryEntry(source.footer.legal, 'label'),
    },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'fake-language-loop.mjs'), FAKE_LANGUAGE_MODULE);
}

function memoryEntry(source, kind) {
  return {
    source,
    sourceHash: `hash:${source}`,
    namespace: 'common',
    kind,
    file: 'messages/en.json',
    placeholders: [],
    firstSeen: '',
    lastSeen: '',
    translations: {},
  };
}

const FAKE_LANGUAGE_MODULE = `
import fs from 'node:fs';
import path from 'node:path';

export const CONTENT_LOOP_API_VERSION = 1;

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n');

export function requireConfig(cwd) {
  return read(path.join(cwd, 'language-loop.config.json'));
}

export function loadMemory(cwd) {
  return read(path.join(cwd, '.language-loop/memory.json'));
}

export function saveMemory(cwd, memory) {
  write(path.join(cwd, '.language-loop/memory.json'), memory);
}

export function adoptCatalogEdits() {
  return 0;
}

export function adoptSourceEdits(cwd, memory) {
  const source = read(path.join(cwd, 'messages/en.json'));
  const value = source.hero.primaryCta;
  const entry = memory.entries['hero.primaryCta'];
  if (entry.source === value) return [];
  entry.source = value;
  entry.sourceHash = 'hash:' + value;
  for (const translation of Object.values(entry.translations)) translation.status = 'stale';
  return ['hero.primaryCta'];
}

export function inspectMarketingHandoff() {
  return { compatible: true, unresolvedKeys: new Set() };
}

export class ProviderRegistry {
  registerTranslator() { return this; }
  registerJudge() { return this; }
  translator() { return { translate: async () => [] }; }
  judge() { return { judge: async () => [] }; }
}
export class GoogleTllmProvider {}
export class OpenAiJudgeProvider {}

export async function runTranslationLoop(input) {
  const callsFile = path.join(input.cwd, '.language-loop/content-calls.json');
  const calls = fs.existsSync(callsFile) ? read(callsFile) : [];
  calls.push({ keys: input.keys, locales: input.locales });
  write(callsFile, calls);
  for (const locale of input.locales) {
    const catalogueFile = path.join(input.cwd, 'messages', locale + '.json');
    const catalogue = read(catalogueFile);
    for (const key of input.keys) {
      if (key !== 'hero.primaryCta') throw new Error('out-of-scope key reached translation');
      catalogue.hero.primaryCta = locale + ':' + input.memory.entries[key].source;
      input.memory.entries[key].translations[locale] = {
        value: catalogue.hero.primaryCta,
        sourceHash: input.memory.entries[key].sourceHash,
        status: 'approved',
        updatedAt: '',
        by: 'fake:judge-accepted',
      };
    }
    write(catalogueFile, catalogue);
  }
  saveMemory(input.cwd, input.memory);
  return {
    status: 'complete',
    batches: input.locales.length,
    translated: input.keys.length * input.locales.length,
    applied: input.keys.length * input.locales.length,
    rework: 0,
    needsHuman: 0,
    marketingBlocked: 0,
  };
}
`;
