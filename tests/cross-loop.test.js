import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const languageRepo = process.env.LANGUAGE_LOOP_REPO;
const marketingRoot = fileURLToPath(new URL('..', import.meta.url));

function run(cli, cwd, ...args) {
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

test('catalogue marketing hands one changed key back to language-loop', {
  skip: !languageRepo && 'set LANGUAGE_LOOP_REPO to the language-loop checkout',
}, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-loop-'));
  try {
    const marketingCli = path.join(marketingRoot, 'dist/cli.js');
    const languageDist = path.join(languageRepo, 'dist/core');
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, 'messages'));
    fs.mkdirSync(path.join(cwd, '.language-loop'));

    const app = [
      'export function Page() {',
      "  const t = useTranslations('hero');",
      "  return <h1>{t('headline')}</h1>;",
      '}',
      '',
    ].join('\n');
    const english = JSON.stringify({
      hero: {
        headline: 'A powerful deployment dashboard',
        body: 'See every deployment in one place',
      },
    }, null, 2) + '\n';
    const german = JSON.stringify({
      hero: {
        headline: 'Ein leistungsstarkes Deployment-Dashboard',
        body: 'Alle Deployments an einem Ort sehen',
      },
    }, null, 2) + '\n';
    fs.writeFileSync(path.join(cwd, 'src/page.tsx'), app);
    fs.writeFileSync(path.join(cwd, 'messages/en.json'), english);
    fs.writeFileSync(path.join(cwd, 'messages/de.json'), german);
    fs.writeFileSync(path.join(cwd, 'language-loop.config.json'), JSON.stringify({
      sourceLocale: 'en',
      locales: ['en', 'de'],
      runtime: 'next-intl',
      framework: 'next-app',
      messagesDir: 'messages',
      layout: 'single-file',
      include: ['**/*.tsx'],
      exclude: [],
      protectedFiles: [],
      ignoreStrings: [],
      keyStyle: 'nested',
      maxLengthRatio: 2,
      voice: {
        tone: 'plain and direct',
        formality: 'auto',
        doNotTranslate: [],
        glossary: {},
      },
      agents: [],
      marketingLoop: { enabled: true, respectPendingCopy: true },
      maxBatch: 200,
    }, null, 2));
    fs.writeFileSync(path.join(cwd, 'marketing-loop.config.json'), JSON.stringify({
      catalogue: {
        messagesDir: 'messages',
        sourceLocale: 'en',
        layout: 'single-file',
      },
      dataDir: 'marketing-data',
      outDir: '.marketing-loop',
      audience: 'engineering teams',
      allowedClaims: [],
      maxProposals: 10,
    }, null, 2));

    const languageUtil = await import(pathToFileURL(path.join(languageDist, 'util.js')));
    const sourceHash = languageUtil.sha('A powerful deployment dashboard');
    fs.writeFileSync(path.join(cwd, '.language-loop/memory.json'), JSON.stringify({
      version: 1,
      sourceLocale: 'en',
      updatedAt: '',
      entries: {
        'hero.headline': {
          source: 'A powerful deployment dashboard',
          sourceHash,
          namespace: 'hero',
          kind: 'heading',
          file: 'src/page.tsx',
          line: 3,
          component: 'Page',
          placeholders: [],
          firstSeen: '',
          lastSeen: '',
          translations: {
            de: {
              value: 'Ein leistungsstarkes Deployment-Dashboard',
              sourceHash,
              status: 'approved',
              updatedAt: '',
              by: 'fixture',
            },
          },
        },
        'hero.body': {
          source: 'See every deployment in one place',
          sourceHash: languageUtil.sha('See every deployment in one place'),
          namespace: 'hero',
          kind: 'body',
          file: 'src/page.tsx',
          line: 3,
          component: 'Page',
          placeholders: [],
          firstSeen: '',
          lastSeen: '',
          translations: {},
        },
      },
    }, null, 2));

    run(marketingCli, cwd, 'propose');
    run(marketingCli, cwd, 'review');
    const reviewFile = path.join(cwd, '.marketing-loop/review.md');
    const review = fs.readFileSync(reviewFile, 'utf8');
    fs.writeFileSync(reviewFile, review.replace('- [ ] APPROVE', '- [x] APPROVE'));
    run(marketingCli, cwd, 'review', '--collect');
    run(marketingCli, cwd, 'apply');

    assert.equal(fs.readFileSync(path.join(cwd, 'src/page.tsx'), 'utf8'), app);
    assert.equal(fs.readFileSync(path.join(cwd, 'messages/de.json'), 'utf8'), german);
    assert.match(
      fs.readFileSync(path.join(cwd, 'messages/en.json'), 'utf8'),
      /A deployment dashboard/,
    );

    const languageConfig = await import(pathToFileURL(path.join(languageDist, 'config.js')));
    const languageMemory = await import(pathToFileURL(path.join(languageDist, 'memory.js')));
    const languageApi = await import(pathToFileURL(path.join(languageRepo, 'dist/index.js')));
    const marketingApi = await import(pathToFileURL(path.join(marketingRoot, 'dist/index.js')));
    const config = languageConfig.loadConfig(cwd);
    assert.ok(config, 'language-loop fixture config must load');
    const memory = languageMemory.loadMemory(cwd, 'en');
    const changed = languageMemory.adoptSourceEdits(cwd, memory, config);
    assert.deepEqual(changed, ['hero.headline']);
    assert.equal(memory.entries['hero.headline'].translations.de.status, 'stale');
    assert.equal(memory.entries['hero.body'].translations.de, undefined);

    const handoff = JSON.parse(fs.readFileSync(
      path.join(cwd, '.marketing-loop/handoff.json'),
      'utf8',
    ));
    assert.deepEqual(handoff.unresolved, []);

    const adapter = marketingApi.createLanguageLoopAdapter({
      cwd,
      module: languageApi,
      translator: async (batch) => batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: `${unit.locale}: ${unit.source}`,
      })),
      judge: async (_batch, _translations, units) => units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        ok: true,
      })),
    });
    const filtered = await adapter.run({
      execute: true,
      keys: ['hero.headline'],
      locales: ['de'],
    });
    if (languageApi.CONTENT_LOOP_API_VERSION === 1) {
      assert.equal(filtered.status, 'complete');
      const translated = JSON.parse(fs.readFileSync(path.join(cwd, 'messages/de.json'), 'utf8'));
      assert.match(translated.hero.headline, /^de:/);
      assert.equal(translated.hero.body, 'Alle Deployments an einem Ort sehen');
      assert.equal(fs.readFileSync(path.join(cwd, 'src/page.tsx'), 'utf8'), app);
    } else {
      assert.equal(filtered.status, 'blocked');
      assert.match(filtered.error, /CONTENT_LOOP_API_VERSION.*1/i);
      assert.equal(fs.readFileSync(path.join(cwd, 'messages/de.json'), 'utf8'), german);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
