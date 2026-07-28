import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/config.js';
import {
  catalogueKeyForFile,
  isCatalogueTarget,
  resolveCatalogueScope,
} from '../dist/core/catalogue.js';

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-catalogue-'));
}

test('standalone scope defaults to messages/en.json', () => {
  const cwd = sandbox();
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), '{"hero":{"title":"Welcome"}}\n');
  const scope = resolveCatalogueScope(cwd, defaultConfig);
  assert.equal(scope.messagesDir, 'messages');
  assert.equal(scope.sourceLocale, 'en');
  assert.equal(scope.layout, 'single-file');
  assert.deepEqual(scope.files, ['messages/en.json']);
  assert.equal(isCatalogueTarget(scope, 'messages/en.json'), true);
  assert.equal(isCatalogueTarget(scope, 'src/page.tsx'), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('language-loop config is authoritative for namespaced catalogues', () => {
  const cwd = sandbox();
  fs.mkdirSync(path.join(cwd, 'locales/en-US'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'locales/en-US/common.json'), '{"cta":"Start"}\n');
  fs.writeFileSync(path.join(cwd, 'locales/en-US/hero.json'), '{"title":"Welcome"}\n');
  fs.writeFileSync(path.join(cwd, 'language-loop.config.json'), JSON.stringify({
    messagesDir: 'locales',
    sourceLocale: 'en-US',
    layout: 'namespaced',
  }));
  const scope = resolveCatalogueScope(cwd, defaultConfig);
  assert.deepEqual(scope.files, [
    'locales/en-US/common.json',
    'locales/en-US/hero.json',
  ]);
  assert.equal(catalogueKeyForFile(scope, 'locales/en-US/hero.json', ['cta', 'start']), 'hero.cta.start');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('scope rejects traversal, symlinks, and configuration disagreement', () => {
  const cwd = sandbox();
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), '{}\n');
  assert.throws(
    () => resolveCatalogueScope(cwd, {
      ...defaultConfig,
      catalogue: { messagesDir: '../outside', sourceLocale: 'en', layout: 'single-file' },
    }),
    /repository-relative|traversal/,
  );

  fs.writeFileSync(path.join(cwd, 'language-loop.config.json'), JSON.stringify({
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
  }));
  assert.throws(
    () => resolveCatalogueScope(cwd, {
      ...defaultConfig,
      catalogue: { messagesDir: 'locales', sourceLocale: 'en', layout: 'single-file' },
    }),
    /disagree on messagesDir/,
  );

  fs.renameSync(path.join(cwd, 'messages/en.json'), path.join(cwd, 'real.json'));
  fs.symlinkSync('../real.json', path.join(cwd, 'messages/en.json'));
  assert.throws(() => resolveCatalogueScope(cwd, defaultConfig), /symbolic link/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('scope fails closed when the source catalogue is missing or namespaced scope is empty', () => {
  const missing = sandbox();
  assert.throws(
    () => resolveCatalogueScope(missing, defaultConfig),
    /messages\/en\.json does not exist/,
  );
  fs.rmSync(missing, { recursive: true, force: true });

  const empty = sandbox();
  fs.mkdirSync(path.join(empty, 'messages/en'), { recursive: true });
  fs.writeFileSync(path.join(empty, 'language-loop.config.json'), JSON.stringify({
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'namespaced',
  }));
  assert.throws(
    () => resolveCatalogueScope(empty, defaultConfig),
    /namespaced source catalogue.*empty/i,
  );
  fs.rmSync(empty, { recursive: true, force: true });
});
