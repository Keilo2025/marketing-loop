# Marketing-loop Catalogue-only Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `marketing-loop` schema v5 read and write only the configured source-language JSON catalogue and publish an atomic key-based handoff for `language-loop`.

**Architecture:** A catalogue-scope resolver becomes the mandatory boundary for scan, import, review, apply, and revert. A purpose-built JSON catalogue extractor records canonical keys and exact value spans; all product context comes from catalogue text, configuration, and marketing evidence. A schema-v1 handoff manifest exposes only unresolved canonical keys.

**Tech Stack:** Node.js 18.17+, TypeScript 5.7, ESM, `node:test`, filesystem-backed JSON state, SHA-256 digests, no new runtime dependencies.

## Global Constraints

- Work only in `/Users/christianbuchholz/GitStuff/marketing-loop`.
- Do not read application code, README files, package metadata, or target-language catalogues as marketing evidence.
- Do not add runtime dependencies.
- The only mutable product files are source-locale `.json` catalogue files resolved from `language-loop.config.json` or standalone catalogue configuration.
- `language-loop.config.json` is authoritative when present.
- Standalone default is `messages/en.json` with layout `single-file`.
- Old `include` and `protectedFiles` settings may warn but cannot widen scope.
- Active schema-v4 state must never be reviewed or applied.
- Use test-driven development: every production change follows a failing focused test.
- Keep the existing human decision ledger, atomic writes, guardrails, and complete-batch preflight.
- Run `npm run build` before direct `node --test` commands because tests import `dist/`.

---

## File map

### New files

- `src/core/catalogue.ts` — resolve and validate the authoritative source-catalogue scope.
- `src/core/catalogue-extract.ts` — parse JSON string leaves with canonical keys and exact value spans.
- `src/core/context.ts` — build text-only marketing context from catalogue items and config.
- `src/core/handoff.ts` — derive and atomically write `.marketing-loop/handoff.json`.
- `tests/catalogue-scope.test.js` — scope resolution and path-safety contract.
- `tests/catalogue-extract.test.js` — canonical key, span, kind, and surface tests.
- `tests/text-only-context.test.js` — proves code and package facts never enter briefs.
- `tests/catalogue-apply.test.js` — catalogue allowlist, schema-v4 refusal, and safe revert tests.
- `tests/handoff.test.js` — manifest lifecycle tests.

### Files with focused changes

- `src/types.ts` — catalogue, schema-v5, context, and handoff types.
- `src/config.ts` — catalogue defaults, language-loop config compatibility, migration warnings, handoff path.
- `src/core/scan.ts` — scan only `CatalogueScope.files`.
- `src/core/analyse.ts` — consume text-only context.
- `src/core/propose.ts` — use catalogue context for safe deliverable fallback.
- `src/core/brief.ts` — remove code-derived facts and code-reading instructions.
- `src/core/ingest.ts` — require schema v5 and revalidate catalogue identity.
- `src/core/state.ts` — schema-v5 validation and handoff rotation.
- `src/core/apply.ts` — JSON-only apply and scope-validated revert.
- `src/core/canvas.ts` — update handoff after decisions and apply.
- `src/core/install.ts` — catalogue-first agent instructions.
- `src/cli.ts` — use the new context, state, scope, and handoff APIs.
- `src/index.ts` — export catalogue APIs and remove code-scanning product APIs.
- `tests/unit.test.js` — retain general analysis/guardrail/review tests and remove obsolete code-scanning expectations.
- `tests/fixture/messages/en.json` — source catalogue fixture.
- `tests/fixture/messages/de.json` — target catalogue that marketing must ignore.
- `tests/fixture/language-loop.config.json` — authoritative fixture scope.
- `README.md`, `skills/marketing-loop/SKILL.md`, `commands/*.md`, `agents/copy-strategist.md` — corrected ownership and lifecycle.
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `src/cli.ts` — version `0.5.0`.

### Files removed after consumers migrate

- `src/core/product.ts` — code-derived product model.
- The generic code/markup branches in `src/core/extract.ts`; remove the file completely if no public compatibility wrapper remains after `src/index.ts` is updated.

---

### Task 1: Authoritative catalogue scope

**Files:**
- Create: `src/core/catalogue.ts`
- Create: `tests/catalogue-scope.test.js`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `tests/catalogue-scope.test.js`

**Interfaces:**
- Produces:

```ts
export type CatalogueLayout = 'single-file' | 'namespaced' | 'custom';

export interface CatalogueConfig {
  messagesDir: string;
  sourceLocale: string;
  layout: CatalogueLayout;
}

export interface CatalogueScope extends CatalogueConfig {
  files: string[];
  scopeDigest: string;
}

export function resolveCatalogueScope(cwd: string, config: LoopConfig): CatalogueScope;
export function isCatalogueTarget(scope: CatalogueScope, file: string): boolean;
export function catalogueKeyForFile(scope: CatalogueScope, file: string, jsonPath: string[]): string;
```

- Consumes: `hashText`, `readJsonStrict`, and `LoopConfig`.
- Later tasks rely on `CatalogueScope.files` being normalized repository-relative paths.

- [ ] **Step 1: Write the failing standalone and language-loop scope tests**

Create `tests/catalogue-scope.test.js` with real temporary directories:

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node --test tests/catalogue-scope.test.js
```

Expected: build fails because `src/core/catalogue.ts` and its exports do not exist.

- [ ] **Step 3: Add catalogue types and safe defaults**

In `src/types.ts`, add `CatalogueLayout`, `CatalogueConfig`, and
`CatalogueScope`. Add this optional field to `LoopConfig`:

```ts
catalogue?: CatalogueConfig;
```

Do not inject `catalogue` into `defaultConfig`: its absence distinguishes a
standalone fallback from an explicit marketing configuration. `validateConfig`
parses and preserves the field only when the user supplied it.

Keep `include` and `protectedFiles` temporarily in the type for config-file
compatibility, but add comments that they do not participate in catalogue
scope.

- [ ] **Step 4: Implement path normalization and authoritative resolution**

In `src/core/catalogue.ts`, implement:

```ts
function cleanRelative(field: string, value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`${field} must be a repository-relative path without traversal`);
  }
  return normalized;
}

function scopeIdentity(scope: Omit<CatalogueScope, 'scopeDigest'>): string {
  return JSON.stringify({
    messagesDir: scope.messagesDir,
    sourceLocale: scope.sourceLocale,
    layout: scope.layout,
    files: [...scope.files].sort(),
  });
}
```

Resolution order:

1. Read `language-loop.config.json` when it exists.
2. Validate its three authoritative fields.
3. If an explicitly present `config.catalogue` differs, throw
   `marketing-loop and language-loop disagree on <field>`.
4. Without language-loop, use explicit `config.catalogue` or the internal
   fallback `{ messagesDir: 'messages', sourceLocale: 'en', layout:
   'single-file' }`.
5. Treat `custom` like `single-file`.
6. For `namespaced`, include only direct, sorted `.json` children.
7. Validate every path segment with `lstatSync` and reject symlinks.
8. Compute `scopeDigest = hashText(scopeIdentity(scope))`.

- [ ] **Step 5: Add failing safety and mismatch cases**

Append:

```js
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
```

- [ ] **Step 6: Run scope tests and the existing config tests**

Run:

```bash
npm run build && node --test --test-name-pattern="scope|config" tests/catalogue-scope.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit the scope boundary**

```bash
git add src/types.ts src/config.ts src/core/catalogue.ts tests/catalogue-scope.test.js
git commit -m "feat: enforce source catalogue scope"
```

---

### Task 2: JSON catalogue extraction and scanning

**Files:**
- Create: `src/core/catalogue-extract.ts`
- Create: `tests/catalogue-extract.test.js`
- Modify: `src/core/scan.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `tests/catalogue-extract.test.js`

**Interfaces:**
- Consumes: `CatalogueScope`, `catalogueKeyForFile`, `CopyItem`, `hashText`.
- Produces:

```ts
export function extractCatalogueFile(
  file: string,
  content: string,
  scope: CatalogueScope,
): CopyItem[];

export function inferKindFromKey(key: string): CopyKind;
export function inferSurfaceFromKey(key: string): Surface;

export function scanRepo(
  cwd: string,
  config: LoopConfig,
  runId?: string,
): ScanResult;
```

- `CopyItem` gains required `catalogueKey` and `sourceLocale`.

- [ ] **Step 1: Write failing canonical-key and source-locale tests**

Create `tests/catalogue-extract.test.js`:

```js
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
import { scanRepo } from '../dist/core/scan.js';

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
  fs.rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/catalogue-extract.test.js
```

Expected: build fails because catalogue extraction exports and required
`CopyItem` fields do not exist.

- [ ] **Step 3: Implement a dependency-free JSON value parser**

In `src/core/catalogue-extract.ts`, validate with `JSON.parse(content)` first,
then use a cursor parser to retain exact string-value offsets:

```ts
interface ParsedString {
  path: string[];
  value: string;
  raw: string;
  start: number;
  end: number;
}

function readString(content: string, quoteStart: number): {
  value: string;
  raw: string;
  start: number;
  end: number;
  next: number;
} {
  let i = quoteStart + 1;
  let escaped = false;
  while (i < content.length) {
    const char = content[i]!;
    if (!escaped && char === '"') {
      const raw = content.slice(quoteStart + 1, i);
      return {
        value: JSON.parse(`"${raw}"`),
        raw,
        start: quoteStart + 1,
        end: i,
        next: i + 1,
      };
    }
    escaped = !escaped && char === '\\';
    if (char !== '\\') escaped = false;
    i++;
  }
  throw new Error('unterminated JSON string');
}
```

Add recursive `parseObject(path)`, `parseArray(path)`, and `skipPrimitive()`
functions. Record a `ParsedString` only when a string is an object value. Parse
arrays to advance the cursor but never emit array elements.

- [ ] **Step 4: Build `CopyItem` records and key classification**

Use tokenized lowercase key segments:

```ts
const tokens = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[._\s-]+/);
```

Apply classification in this order:

1. error and empty-state
2. CTA
3. headline and subhead
4. pricing
5. label
6. body/unknown

Apply legal surface before landing/email/store/app classification. Set:

```ts
catalogueKey,
sourceLocale: scope.sourceLocale,
file,
fileHash: hashText(content),
source: {
  raw: parsed.raw,
  start: parsed.start,
  end: parsed.end,
  representation: 'json-string',
  applicable: true,
},
```

- [ ] **Step 5: Replace repository walking in `scanRepo`**

Change `ScanResult` to include:

```ts
files: string[];
```

Resolve the scope once, loop only over `scope.files`, and call
`extractCatalogueFile`. Remove `walkDetailed`, `SCANNABLE`, `config.include`,
and `config.protectedFiles` from the scan path. Include `catalogueKey`,
`sourceLocale`, and `scope.scopeDigest` in the inventory digest.

- [ ] **Step 6: Run extraction tests**

Run:

```bash
npm run build && node --test tests/catalogue-extract.test.js tests/catalogue-scope.test.js
```

Expected: all tests pass and `src/page.tsx` is not read as copy.

- [ ] **Step 7: Commit catalogue scanning**

```bash
git add src/types.ts src/core/catalogue-extract.ts src/core/scan.ts src/index.ts tests/catalogue-extract.test.js
git commit -m "feat: scan source messages by catalogue key"
```

---

### Task 3: Text-only context, analysis, proposals, and brief

**Files:**
- Create: `src/core/context.ts`
- Create: `tests/text-only-context.test.js`
- Modify: `src/types.ts`
- Modify: `src/core/analyse.ts`
- Modify: `src/core/propose.ts`
- Modify: `src/core/brief.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/text-only-context.test.js`

**Interfaces:**
- Consumes: `CatalogueScope`, `CopyItem[]`, `LoopConfig`, `BehaviorReport`.
- Produces:

```ts
export interface MarketingContext {
  sourceLocale: string;
  messagesDir: string;
  layout: CatalogueLayout;
  namespaces: string[];
  currentTagline?: string;
  currentDescription?: string;
  audience: string;
  allowedClaims: string[];
  generatedAt: string;
}

export function buildMarketingContext(
  scope: CatalogueScope,
  items: CopyItem[],
  config: LoopConfig,
): MarketingContext;
```

- `analyse`, `propose`, and `renderBrief` consume `MarketingContext`, not
  `ProductModel`.

- [ ] **Step 1: Write the failing no-code-evidence test**

Create `tests/text-only-context.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/text-only-context.test.js
```

Expected: build fails because `buildMarketingContext` does not exist and
`renderBrief` still requires `product`.

- [ ] **Step 3: Implement catalogue-derived context**

Derive namespaces from the first key segment. Choose `currentTagline` from the
first item whose key includes `tagline`, then `hero.headline`, then any
headline. Choose `currentDescription` from `description`, `subhead`, or
`subtitle`. Copy audience and allowed claims only from `LoopConfig`.

- [ ] **Step 4: Replace `ProductModel` across analysis and proposal APIs**

Change:

```ts
analyse(items, context, config)
propose({ items, findings, context, behavior, config, ranked })
```

In the generic CTA rewrite, use `context.currentTagline` only after checking
headlines and subheads in the same catalogue namespace. Remove route,
dependency, feature, integration, and pricing-code fallbacks.

- [ ] **Step 5: Rewrite the brief’s context section**

The brief must state:

```md
Everything below comes from the configured source catalogue,
marketing-loop.config.json, and marketing-data/. Application code was not read.
```

Include source locale, catalogue directory, audience, voice, allowed claims,
current tagline/description, and namespaces. Remove stack, routes, code pricing
tiers, dependency integrations, capability evidence, and the instruction that a
fact may come from code.

Change agent evidence wording to:

```text
<source-catalogue text, allowed claim, marketing-data point, or NEEDS-FACT question>
```

- [ ] **Step 6: Update CLI scan artefacts**

Rename local `product` variables to `context`. Continue writing
`.marketing-loop/product.json` for one release if external consumers expect the
filename, but write `MarketingContext` data and label it deprecated in comments.
Remove capability and route rows from scan output. Show source locale,
catalogue files, namespaces, findings, and behavior sources.

- [ ] **Step 7: Run focused and existing proposal tests**

Run:

```bash
npm run build && node --test --test-name-pattern="brief|cta|diagnos|proposal|guardrail" tests/text-only-context.test.js tests/unit.test.js
```

Expected: selected tests pass after fixture-based product expectations are
rewritten to catalogue context.

- [ ] **Step 8: Commit text-only context**

```bash
git add src/types.ts src/core/context.ts src/core/analyse.ts src/core/propose.ts src/core/brief.ts src/cli.ts src/index.ts tests/text-only-context.test.js tests/unit.test.js
git commit -m "refactor: derive marketing context from messages"
```

---

### Task 4: Schema-v5 state and legacy refusal

**Files:**
- Modify: `src/types.ts`
- Modify: `src/core/state.ts`
- Modify: `src/core/ingest.ts`
- Modify: `src/core/review.ts`
- Modify: `src/core/canvas.ts`
- Modify: `src/cli.ts`
- Modify: `tests/unit.test.js`
- Create: `tests/schema-v5.test.js`
- Test: `tests/schema-v5.test.js`

**Interfaces:**
- Produces:

```ts
export const STATE_SCHEMA_VERSION = 5 as const;

export interface Inventory {
  schemaVersion: 5;
  scopeDigest: string;
  sourceLocale: string;
  // existing digest-bound fields
}

export interface ProposalSet {
  schemaVersion: 5;
  scopeDigest: string;
  // existing run and proposal fields
}
```

- `parseAgentOutput` accepts only schema 5.
- `readActiveState` rejects every non-v5 state before review or apply.

- [ ] **Step 1: Write failing schema-v4 refusal and v5 import tests**

Create:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentOutput } from '../dist/core/ingest.js';

test('schema-v4 agent output is rejected with a code-target warning', () => {
  assert.throws(
    () => parseAgentOutput(JSON.stringify({
      schemaVersion: 4,
      runId: 'old',
      inventoryDigest: 'old',
      proposals: [],
    })),
    /schema v4.*may target code|schemaVersion must be 5/i,
  );
});

test('schema-v5 agent output preserves only untrusted proposal content', () => {
  const parsed = parseAgentOutput(JSON.stringify({
    schemaVersion: 5,
    runId: 'run',
    inventoryDigest: 'inventory',
    proposals: [{
      copyId: 'copy',
      after: 'Start my audit',
      alternatives: [],
      rationale: 'Names the result.',
      problemSolved: 'The action was vague.',
      principles: [],
      evidence: ['messages/en.json'],
      confidence: 0.8,
      file: 'src/page.tsx',
    }],
  }));
  assert.equal(parsed.schemaVersion, 5);
  assert.equal('file' in parsed.proposals[0], false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/schema-v5.test.js
```

Expected: the v4 case is accepted and the v5 case is rejected.

- [ ] **Step 3: Introduce one schema constant**

Replace production literals `4` with `STATE_SCHEMA_VERSION`. Update inventory,
proposal, decision, and agent-output types to literal `5`. Add `scopeDigest` and
`sourceLocale` to state digests and validation.

- [ ] **Step 4: Fail closed in every state reader**

Use this message for old state:

```text
Active marketing state is schema v4 and may target code. Run `marketing-loop propose` to regenerate it.
```

Apply it in CLI active-state reads, markdown review collection, canvas startup,
and apply preflight. Do not mutate or upgrade the old files.

- [ ] **Step 5: Update generated agent schema and decision digests**

Render `schemaVersion: 5` in the brief. Include `scopeDigest`, source locale,
catalogue key, and catalogue file in inventory/proposal digest inputs. Continue
to ignore model-provided path, source text, status, ID, and author.

- [ ] **Step 6: Run schema, state, review, and import tests**

Run:

```bash
npm run build && node --test --test-name-pattern="schema|state|agent output|approval|review file" tests/schema-v5.test.js tests/unit.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit schema v5**

```bash
git add src/types.ts src/core/state.ts src/core/ingest.ts src/core/review.ts src/core/canvas.ts src/cli.ts tests/schema-v5.test.js tests/unit.test.js
git commit -m "feat: bind marketing state to schema v5 catalogues"
```

---

### Task 5: Catalogue-only apply and safe revert

**Files:**
- Create: `tests/catalogue-apply.test.js`
- Modify: `src/core/apply.ts`
- Modify: `src/core/catalogue.ts`
- Modify: `src/cli.ts`
- Modify: `src/types.ts`
- Test: `tests/catalogue-apply.test.js`

**Interfaces:**
- Consumes: `resolveCatalogueScope`, `isCatalogueTarget`, schema-v5 inventory and decisions.
- Produces:

```ts
export function applyProposals(set: ProposalSet, opts: ApplyOptions): ApplyResult[];

export interface BackupManifest {
  schemaVersion: 5;
  runId: string;
  scopeDigest: string;
  files: string[];
}

export function revert(
  cwd: string,
  config: LoopConfig,
  backupDir: string,
): string[];
```

- [ ] **Step 1: Write failing forged-target and target-locale tests**

Create a helper that writes `messages/en.json`, `messages/de.json`, performs a
real `scanRepo`, and constructs digest-bound approved state. Add:

```js
test('apply refuses an inventory item forged to target code', () => {
  const state = approvedCatalogueState();
  state.inventory.items[0].file = 'src/page.tsx';
  state.inventory.inventoryDigest = digestInventoryItems(state.inventory.items);
  state.set.inventoryDigest = state.inventory.inventoryDigest;
  state.decisions.inventoryDigest = state.inventory.inventoryDigest;
  const results = applyProposals(state.set, state.options());
  assert.match(results[0].reason, /outside the source catalogue/);
  assert.equal(fs.readFileSync(state.codeFile, 'utf8'), state.originalCode);
});

test('apply changes only the source catalogue', () => {
  const state = approvedCatalogueState();
  const beforeGerman = fs.readFileSync(state.germanFile, 'utf8');
  const results = applyProposals(state.set, state.options());
  assert.equal(results[0].ok, true);
  assert.equal(fs.readFileSync(state.germanFile, 'utf8'), beforeGerman);
  assert.equal(fs.readFileSync(state.codeFile, 'utf8'), state.originalCode);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/catalogue-apply.test.js
```

Expected: forged repository-relative code remains eligible under the current
repository-only confinement.

- [ ] **Step 3: Re-resolve scope inside apply**

At the start of secure apply:

```ts
const scope = resolveCatalogueScope(opts.cwd, opts.config);
if (scope.scopeDigest !== set.scopeDigest || scope.scopeDigest !== inventory.scopeDigest) {
  return failAll('catalogue scope changed since review; run marketing-loop propose again');
}
```

For every item:

```ts
if (
  item.sourceLocale !== scope.sourceLocale ||
  !isCatalogueTarget(scope, item.file)
) {
  throw new Error('approved target is outside the source catalogue');
}
```

Remove `protectedFiles` from authorization. Keep repository realpath and symlink
checks as defense in depth.

- [ ] **Step 4: Reduce replacement encoding to JSON strings**

Require `item.source.representation === 'json-string'`. Encode with:

```ts
const replacement = JSON.stringify(finalText).slice(1, -1);
```

Delete JavaScript, template, HTML, Markdown, YAML, and plain replacement
branches after the focused test passes.

- [ ] **Step 5: Add backup manifests and scope-validated revert**

Write `backup-manifest.json` inside each run backup before source writes. On
revert:

1. read the newest manifest strictly
2. require schema 5
3. resolve current scope
4. require every manifest file to satisfy `isCatalogueTarget`
5. restore atomically

Add a test that changes the config to a different messages directory and
asserts revert refuses the old backup rather than writing outside current
scope.

- [ ] **Step 6: Run apply, stale-batch, rollback, and revert tests**

Run:

```bash
npm run build && node --test --test-name-pattern="apply|stale|atomic|revert|traversal|symlink" tests/catalogue-apply.test.js tests/unit.test.js
```

Expected: all selected tests pass and no test expects code-file mutation.

- [ ] **Step 7: Commit the write boundary**

```bash
git add src/core/apply.ts src/core/catalogue.ts src/cli.ts src/types.ts tests/catalogue-apply.test.js tests/unit.test.js
git commit -m "feat: confine apply and revert to source messages"
```

---

### Task 6: Atomic key-based handoff lifecycle

**Files:**
- Create: `src/core/handoff.ts`
- Create: `tests/handoff.test.js`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/core/state.ts`
- Modify: `src/core/canvas.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/handoff.test.js`

**Interfaces:**
- Consumes: schema-v5 `ProposalSet`, `Inventory`, `DecisionSet`, `CatalogueScope`.
- Produces:

```ts
export interface HandoffEntry {
  key: string;
  file: string;
  sourceHash: string;
  status: 'pending' | 'approved';
}

export interface MarketingHandoff {
  schemaVersion: 1;
  marketingRunId: string;
  scopeDigest: string;
  messagesDir: string;
  sourceLocale: string;
  layout: CatalogueLayout;
  unresolved: HandoffEntry[];
}

export function deriveHandoff(
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): MarketingHandoff;

export function writeHandoff(
  file: string,
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): MarketingHandoff;
```

- [ ] **Step 1: Write failing handoff transition tests**

Create:

```js
test('handoff contains only pending and approved catalogue keys', () => {
  const state = handoffState([
    { id: 'a', key: 'hero.title', status: 'pending' },
    { id: 'b', key: 'hero.cta', status: 'approved' },
    { id: 'c', key: 'hero.body', status: 'rejected' },
    { id: 'd', key: 'hero.note', status: 'failed' },
    { id: 'e', key: 'hero.done', status: 'applied' },
  ]);
  const handoff = deriveHandoff(state.set, state.inventory, state.scope);
  assert.deepEqual(
    handoff.unresolved.map(({ key, status }) => ({ key, status })),
    [
      { key: 'hero.cta', status: 'approved' },
      { key: 'hero.title', status: 'pending' },
    ],
  );
});

test('writeHandoff replaces the manifest atomically after rejection', () => {
  const state = handoffState([{ id: 'a', key: 'hero.title', status: 'pending' }]);
  writeHandoff(state.file, state.set, state.inventory, state.scope);
  state.set.proposals[0].status = 'rejected';
  const written = writeHandoff(state.file, state.set, state.inventory, state.scope);
  assert.deepEqual(written.unresolved, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(state.file, 'utf8')), written);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/handoff.test.js
```

Expected: module import fails because `src/core/handoff.ts` does not exist.

- [ ] **Step 3: Implement deterministic handoff derivation**

Build an inventory map by copy ID. Include only proposal statuses `pending` and
`approved`. For each entry:

```ts
{
  key: item.catalogueKey,
  file: item.file,
  sourceHash: hashText(item.text),
  status: proposal.status,
}
```

Sort by key, then file, before writing. Throw if a proposal cannot resolve to a
schema-v5 catalogue item.

- [ ] **Step 4: Add handoff to paths and run rotation**

Add `handoff` to `paths()`. Include `handoff.json` in `rotateActiveRun`'s
archived active files. A new propose run writes its handoff only after inventory
and proposals are both written.

- [ ] **Step 5: Centralize CLI state writes**

Add:

```ts
function persistProposalState(
  cwd: string,
  config: LoopConfig,
  set: ProposalSet,
  inventory: Inventory,
): void {
  const p = paths(cwd, config);
  writeJson(p.proposals, set);
  writeHandoff(p.handoff, set, inventory, resolveCatalogueScope(cwd, config));
}
```

Use it after propose, brief, import, markdown collection, CLI apply, and status
mutations.

- [ ] **Step 6: Add a canvas state-change callback**

Extend `CanvasOptions`:

```ts
onStateChanged?: (set: ProposalSet, inventory: Inventory) => void;
```

Call it after `/api/decide`, `/api/decide-group`, and `/api/apply` has persisted
proposal/decision state. In `cmdReview`, pass a callback that writes the
handoff. Keep `onApplied` for report generation.

- [ ] **Step 7: Run handoff and review tests**

Run:

```bash
npm run build && node --test --test-name-pattern="handoff|review|canvas|decision|apply" tests/handoff.test.js tests/unit.test.js
```

For the canvas test, run outside the restricted sandbox if loopback binding is
denied. Expected: all selected assertions pass.

- [ ] **Step 8: Commit the handoff producer**

```bash
git add src/core/handoff.ts src/types.ts src/config.ts src/core/state.ts src/core/canvas.ts src/cli.ts src/index.ts tests/handoff.test.js tests/unit.test.js
git commit -m "feat: publish unresolved marketing keys"
```

---

### Task 7: Remove code-reading paths and update fixtures

**Files:**
- Delete: `src/core/product.ts`
- Delete: `src/core/extract.ts`
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/install.ts`
- Modify: `tests/unit.test.js`
- Create: `tests/fixture/messages/en.json`
- Create: `tests/fixture/messages/de.json`
- Create: `tests/fixture/language-loop.config.json`
- Test: `tests/unit.test.js`

**Interfaces:**
- Public supported scan API is `scanRepo` over catalogue scope.
- Public supported extraction API is `extractCatalogueFile`.
- `looksLikeCopy` remains available from `catalogue-extract.ts` for callers that
  want the catalogue string filter without file parsing.
- `buildProductModel`, `looksLikeProject`, generic `SCANNABLE`, and code
  `extractFromFile` are removed from package exports.

- [ ] **Step 1: Write a failing public-export test**

Add to `tests/catalogue-extract.test.js`:

```js
test('public API exposes catalogue extraction without code extractors', async () => {
  const api = await import('../dist/index.js');
  assert.equal(typeof api.extractCatalogueFile, 'function');
  assert.equal('buildProductModel' in api, false);
  assert.equal('SCANNABLE' in api, false);
  assert.equal('extractFromFile' in api, false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="public API" tests/catalogue-extract.test.js
```

Expected: old code-scanning exports are still present.

- [ ] **Step 3: Remove obsolete code readers**

Remove `buildProductModel` imports and exports. Delete `src/core/product.ts`.
Move the pure `looksLikeCopy` filter and its text-only constants into
`src/core/catalogue-extract.ts`, update its consumers, and delete
`src/core/extract.ts`. Do not retain a compatibility wrapper that accepts code
paths.

- [ ] **Step 4: Replace the repository fixture with catalogues**

Add `tests/fixture/messages/en.json` containing representative headline, CTA,
body, empty state, error, and pricing keys. Add a German file with distinct
translations. Add:

```json
{
  "messagesDir": "messages",
  "sourceLocale": "en",
  "layout": "single-file"
}
```

to `tests/fixture/language-loop.config.json`.

- [ ] **Step 5: Remove obsolete unit expectations**

Delete or rewrite tests named:

- `extracts headline, cta and meta from html`
- `extracts named copy constants from jsx`
- `infers stack, routes and integrations from the repo`
- `inventory preserves normalized text and exact multiline source`
- `JavaScript string inventory keeps escapes in the span but decodes review text`
- code/HTML apply encoding cases

Keep and retarget diagnostics, behavior, proposal, guardrail, review, state,
install, sibling, and version tests to source-catalogue items.

- [ ] **Step 6: Run the full unit suite**

Run:

```bash
npm test
```

Expected: all non-network tests pass. If the canvas test alone reports
`listen EPERM`, rerun the full command with loopback permission before claiming
success.

- [ ] **Step 7: Commit dead-code removal**

```bash
git add -A src tests
git commit -m "refactor: remove marketing code scanners"
```

---

### Task 8: CLI, docs, version, and package verification

**Files:**
- Modify: `README.md`
- Modify: `skills/marketing-loop/SKILL.md`
- Modify: `skills/marketing-loop/references/diagnostics.md`
- Modify: `commands/marketing-loop.md`
- Modify: `commands/copy-audit.md`
- Modify: `commands/copy-review.md`
- Modify: `agents/copy-strategist.md`
- Modify: `src/core/install.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `tests/unit.test.js`

**Interfaces:**
- CLI version and all package/plugin versions become `0.5.0`.
- Correct lifecycle:

```text
language-loop scan
language-loop extract
marketing-loop propose
marketing-loop review
marketing-loop apply
language-loop translate
language-loop judge
language-loop apply
```

- [ ] **Step 1: Write failing CLI-copy tests**

Add assertions that CLI help and installed rule content:

```js
assert.match(help, /source messages|source catalogue/i);
assert.doesNotMatch(help, /reads your code|write approved changes to your code/i);
assert.match(installedRule, /language-loop extract[\s\S]*marketing-loop propose/);
```

Use the existing CLI spawn and install helpers in `tests/unit.test.js`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="CLI copy|installs|version" tests/unit.test.js
```

Expected: current help and installed rules still say the loop reads code.

- [ ] **Step 3: Rewrite user-facing workflow documentation**

Every entry point must state:

- marketing-loop reads only the source catalogue
- language-loop extracts hardcoded text first
- marketing-loop never modifies code or target locales
- approved source edits make translations stale
- language-loop translates only after marketing decisions settle

Remove examples that apply sibling decisions across locale bundles. Sibling
groups may remain for identical keys in separate source namespaces, but no
marketing UI should offer to rewrite target locales.

- [ ] **Step 4: Update init and status behavior**

`init` detects and displays the authoritative language-loop scope without
building a code product model. `scan` prints every inspected source file.
`status` prints source locale, catalogue directory, layout, and unresolved
handoff count.

Emit deprecation warnings when loaded config explicitly contains `include` or
`protectedFiles`:

```text
marketing-loop 0.5 ignores "include" and "protectedFiles"; source catalogue scope is enforced.
```

- [ ] **Step 5: Bump and synchronize version numbers**

Set `0.5.0` in package, lockfile, CLI constant, plugin manifest, and marketplace
metadata. Keep the existing version-consistency test.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm test
npm pack --dry-run
```

Expected:

- build exits 0
- all tests pass
- tarball contains `dist`, skills, commands, agents, plugin metadata, README,
  and license
- tarball does not contain tests, state directories, or source fixtures

- [ ] **Step 7: Inspect for forbidden code-reading language and imports**

Run:

```bash
rg -n "reads? (your )?code|write.*to.*code|buildProductModel|extractFromFile|SCANNABLE" src README.md skills commands agents
```

Expected: no product behavior or documentation claims that marketing reads or
writes application code. Mentions in migration notes may explicitly say the
old behavior was removed.

- [ ] **Step 8: Commit the producer release**

```bash
git add README.md skills commands agents src package.json package-lock.json .claude-plugin tests/unit.test.js
git commit -m "chore: prepare catalogue-only marketing release"
```

---

## Marketing-loop completion gate

Before moving to the language-loop consumer plan:

- [ ] `git status --short` is clean.
- [ ] `npm test` passes with the canvas test executed in a loopback-capable environment.
- [ ] `npm pack --dry-run` exits 0.
- [ ] A forged schema-v5 code target is rejected.
- [ ] A target-language catalogue remains byte-for-byte unchanged.
- [ ] `src/core/product.ts` and generic code-scanner exports are absent.
- [ ] `.marketing-loop/handoff.json` contains only pending and approved source keys.
