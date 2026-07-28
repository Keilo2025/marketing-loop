import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/config.js';
import { buildMarketingContext } from '../dist/core/context.js';
import { renderBrief } from '../dist/core/brief.js';
import { resolveCatalogueScope } from '../dist/core/catalogue.js';
import { scanRepo } from '../dist/core/scan.js';

test('marketing context and brief contain no facts sourced from code or package metadata', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-text-only-'));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.writeFileSync(path.join(cwd, 'src/secret.ts'), 'export const customers = 12347;\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Product\nTrusted by 12,347 teams.\n');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'secret-product',
    dependencies: { stripe: '1.0.0' },
  }));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), JSON.stringify({
    hero: { tagline: 'Know when a deployment breaks', cta: 'Start now' },
  }));

  const scope = resolveCatalogueScope(cwd, defaultConfig);
  const scan = scanRepo(cwd, defaultConfig, 'text-only-run');
  const context = buildMarketingContext(scope, scan.items, defaultConfig);
  const brief = renderBrief({
    context,
    items: scan.items,
    findings: [],
    behavior: { signals: [], funnel: [], notes: [], problems: [], sourceFiles: [] },
    config: defaultConfig,
    proposed: { proposals: [], openItems: [] },
    outDir: '.marketing-loop',
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
  });

  assert.match(brief, /Know when a deployment breaks/);
  assert.doesNotMatch(brief, /12,347|stripe|secret-product|source code|in the code/i);
  fs.rmSync(cwd, { recursive: true, force: true });
});
