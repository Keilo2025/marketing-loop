import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/config.js';
import {
  extractCatalogueFile,
  inferKindFromKey,
  inferSurfaceFromKey,
} from '../dist/core/catalogue-extract.js';
import { resolveCatalogueScope } from '../dist/core/catalogue.js';
import { digestInventoryItems, scanRepo } from '../dist/core/scan.js';

test('catalogue extraction preserves canonical keys and exact JSON spans', () => {
  const content = '{\n  "hero": {\n    "headline": "Deploy with confidence",\n    "cta": "Start free"\n  }\n}\n';
  const scope = {
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    files: ['messages/en.json'],
    scopeDigest: 'scope',
  };
  const items = extractCatalogueFile('messages/en.json', content, scope);
  const headline = items.find((item) => item.catalogueKey === 'hero.headline');
  assert.ok(headline);
  assert.equal(headline.kind, 'headline');
  assert.equal(headline.surface, 'landing');
  assert.equal(headline.sourceLocale, 'en');
  assert.equal(content.slice(headline.source.start, headline.source.end), 'Deploy with confidence');
  assert.equal(headline.source.representation, 'json-string');
});

test('key classification is independent from file names', () => {
  assert.equal(inferKindFromKey('common.form.submitButton'), 'cta');
  assert.equal(inferKindFromKey('account.emptyState.noResults'), 'empty-state');
  assert.equal(inferSurfaceFromKey('privacy.terms.heading'), 'legal');
  assert.equal(inferSurfaceFromKey('newsletter.subject'), 'email');
});

test('arrays and non-string leaves never become marketing copy', () => {
  const content = JSON.stringify({
    steps: ['First', 'Second'],
    enabled: true,
    count: 3,
    hero: { headline: 'Visible headline' },
  });
  const scope = {
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    files: ['messages/en.json'],
    scopeDigest: 'scope',
  };
  const items = extractCatalogueFile('messages/en.json', content, scope);
  assert.deepEqual(items.map((item) => item.catalogueKey), ['hero.headline']);
  assert.deepEqual(extractCatalogueFile('messages/en.json', '"Top-level text"', scope), []);
  assert.throws(
    () => extractCatalogueFile('messages/en.json', '{"hero":', scope),
    /Invalid JSON/,
  );
});

test('scan reads only the source locale even when code and translations contain copy', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-scan-catalogue-'));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.writeFileSync(path.join(cwd, 'src/page.tsx'), '<h1>Powerful code headline</h1>\n');
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), '{"hero":{"headline":"Source headline"}}\n');
  fs.writeFileSync(path.join(cwd, 'messages/de.json'), '{"hero":{"headline":"Zielüberschrift"}}\n');
  const result = scanRepo(cwd, defaultConfig, 'catalogue-run');
  assert.deepEqual(result.items.map((item) => item.text), ['Source headline']);
  assert.deepEqual(result.files, ['messages/en.json']);
  assert.equal(digestInventoryItems(result.items), result.inventoryDigest);
  fs.rmSync(cwd, { recursive: true, force: true });
});
