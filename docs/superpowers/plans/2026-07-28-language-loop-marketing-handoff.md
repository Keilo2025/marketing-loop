# Language-loop Marketing Handoff Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `language-loop` validate marketing-loop handoff schema 1, freeze translations by canonical key, and enforce the corrected extract → market → translate lifecycle.

**Architecture:** Installation detection remains separate from operational handoff validation. Operational commands validate handoff scope, key-to-file mapping, and source hashes against localization memory, then filter `WorkItem.key` rather than raw source text. Extract no longer consults marketing state because marketing begins only after source catalogues exist.

**Tech Stack:** Node.js 18.17+, TypeScript 5.7, ESM, `node:test`, existing JSON catalogue and memory helpers, no new runtime dependencies.

## Global Constraints

- Work in `/Users/christianbuchholz/GitStuff/language-loop`; obtain write access before execution.
- Do not modify the marketing-loop repository while executing this plan.
- Consume `.marketing-loop/handoff.json` schema 1 exactly as defined by the approved specification.
- Never fall back from key identity to raw text identity.
- `language-loop.config.json` remains authoritative for `messagesDir`, `sourceLocale`, and `layout`.
- Schema-v4 marketing state with pending proposals is incompatible and must stop translation with a regeneration command.
- Missing marketing installation or an installation that has never run must not block localization.
- Extract continues to scan and modify code because code extraction belongs to `language-loop`.
- Marketing filtering applies only after code has become keyed catalogue work.
- Use test-driven development and focused commits.
- Run `npm run build` before direct `node --test` commands.

---

## File map

### New files

- `tests/marketing-handoff.test.js` — handoff parsing, scope validation, key identity, and legacy-state behavior.

### Files with focused changes

- `src/types.ts` — marketing handoff and runner waiting status types.
- `src/core/marketing.ts` — split installation metadata from operational handoff validation.
- `src/core/catalog.ts` — expose canonical key-to-file mapping and source scope identity.
- `src/core/runner.ts` — skip exact unresolved keys in autonomous runs.
- `src/core/brief.ts` — report exact frozen keys, not raw texts.
- `src/core/completeness.ts` — include pending/incompatible marketing findings.
- `src/core/report.ts` — render corrected status and next command.
- `src/cli.ts` — remove extract freeze; validate handoff in translate, run, status, audit, and sync.
- `src/core/install.ts` — corrected lifecycle and agent rules.
- `src/index.ts` — export handoff inspection APIs needed by integrations.
- `tests/extract.test.js` — prove extract ignores marketing handoff.
- `tests/runner.test.js` — prove autonomous run skips exact keys.
- `tests/brief.test.js` — use unresolved keys in brief metadata.
- `tests/completeness.test.js` — pending and incompatible handoff findings.
- `tests/regressions.test.js` — CLI integration behavior.
- `README.md`, `skills/language-loop/SKILL.md`, `commands/*.md`, `agents/*.md` — corrected lifecycle.
- `package.json`, `.claude-plugin/plugin.json`, `src/cli.ts` — release version `0.4.0`.

---

### Task 1: Parse and validate handoff schema 1

**Files:**
- Create: `tests/marketing-handoff.test.js`
- Modify: `src/types.ts`
- Modify: `src/core/catalog.ts`
- Modify: `src/core/marketing.ts`
- Modify: `src/index.ts`
- Test: `tests/marketing-handoff.test.js`

**Interfaces:**
- Existing installation/config metadata remains:

```ts
export interface MarketingLoopInstallation {
  installed: boolean;
  hasRun: boolean;
  voice?: { tone?: string; person?: string; banned?: string[] };
  audience?: string;
  allowedClaims?: string[];
}

export function detectMarketingLoop(cwd: string): MarketingLoopInstallation;
```

- New operational contract:

```ts
export interface MarketingHandoffEntry {
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
  layout: CatalogLayout;
  unresolved: MarketingHandoffEntry[];
}

export interface MarketingHandoffState {
  installed: boolean;
  hasRun: boolean;
  compatible: boolean;
  unresolvedKeys: Set<string>;
  error?: string;
}

export function inspectMarketingHandoff(
  cwd: string,
  config: Config,
  memory: Memory,
): MarketingHandoffState;

export function requireMarketingKeys(
  cwd: string,
  config: Config,
  memory: Memory,
): Set<string>;
```

- `catalogFileForKey(config, locale, key)` maps a canonical key to its source file.
- `sourceCatalogueFiles(cwd, config)` returns the same sorted file list used by
  `readCatalog`.
- `catalogueScopeDigest(cwd, config)` hashes the canonical scope identity.

- [ ] **Step 1: Write failing exact-key and rejected-state tests**

Create `tests/marketing-handoff.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../dist/core/config.js';
import {
  inspectMarketingHandoff,
  requireMarketingKeys,
} from '../dist/core/marketing.js';
import { sha } from '../dist/core/util.js';

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lloop-marketing-'));
  fs.mkdirSync(path.join(cwd, 'messages'));
  fs.mkdirSync(path.join(cwd, '.marketing-loop'));
  fs.writeFileSync(path.join(cwd, 'messages/en.json'), JSON.stringify({
    first: { submit: 'Submit' },
    second: { submit: 'Submit' },
  }));
  const config = {
    ...defaultConfig({
      framework: 'react',
      runtime: 'react-i18next',
      messagesDir: 'messages',
      layout: 'single-file',
      srcDir: 'src',
      runtimeInstalled: true,
      evidence: [],
    }),
    sourceLocale: 'en',
    locales: ['en', 'de'],
  };
  const memory = {
    version: 1,
    sourceLocale: 'en',
    updatedAt: '',
    entries: Object.fromEntries(['first.submit', 'second.submit'].map((key) => [key, {
      source: 'Submit',
      sourceHash: sha('Submit'),
      namespace: key.split('.')[0],
      kind: 'cta',
      file: 'src/App.tsx',
      placeholders: [],
      firstSeen: '',
      lastSeen: '',
      translations: {},
    }])),
  };
  return { cwd, config, memory };
}

test('handoff freezes one canonical key without freezing identical text', () => {
  const { cwd, config, memory } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [{
      key: 'first.submit',
      file: 'messages/en.json',
      sourceHash: sha('Submit'),
      status: 'pending',
    }],
  }));
  const keys = requireMarketingKeys(cwd, config, memory);
  assert.deepEqual([...keys], ['first.submit']);
  assert.equal(keys.has('second.submit'), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test tests/marketing-handoff.test.js
```

Expected: imports fail because operational handoff APIs do not exist.

- [ ] **Step 3: Expose canonical catalogue file mapping**

In `src/core/catalog.ts`, add:

```ts
export function catalogFileForKey(config: Config, locale: string, key: string): string {
  if (config.layout !== 'namespaced') return catalogPath(config, locale);
  return catalogPath(config, locale, namespaceOf(key));
}
```

Also add:

```ts
export function catalogueScopeIdentity(config: Config, files: string[]): string {
  return JSON.stringify({
    messagesDir: posix(config.messagesDir).replace(/^\.\/|\/+$/g, ''),
    sourceLocale: config.sourceLocale,
    layout: config.layout,
    files: [...files].sort(),
  });
}

export function catalogueScopeDigest(cwd: string, config: Config): string {
  return sha(catalogueScopeIdentity(config, sourceCatalogueFiles(cwd, config)));
}
```

Implement `sourceCatalogueFiles` as the single source file returned by
`catalogPath` for non-namespaced layouts. For namespaced layouts, return sorted
direct `.json` children of `<messagesDir>/<sourceLocale>/`; do not recurse.

Use the existing `sha` helper to compute the same digest contract as
marketing-loop.

- [ ] **Step 4: Separate installation detection from handoff validation**

Keep config/voice discovery in `detectMarketingLoop`. Remove `pendingTexts` and
the raw proposal-text filter.

In `inspectMarketingHandoff`:

1. return compatible/empty when marketing is absent or has never run
2. read `.marketing-loop/handoff.json` strictly when present
3. validate every required field and `schemaVersion === 1`
4. require scope fields to equal `Config`
5. require `handoff.scopeDigest === catalogueScopeDigest(cwd, config)`
6. require each status to be `pending` or `approved`
7. require each key in memory
8. require `entry.sourceHash === memory.entries[key].sourceHash`
9. require `entry.file === catalogFileForKey(config, config.sourceLocale, key)`
10. reject duplicate unresolved keys
11. return a sorted `Set`

If active schema-v5 proposals exist without a valid handoff, return an
incompatible state. If only schema-v4 proposals exist, inspect their statuses:
pending or approved legacy proposals are incompatible; a legacy run with no
unresolved proposals does not block translation.

`requireMarketingKeys` throws `state.error` when `compatible` is false.

- [ ] **Step 5: Add legacy and malformed-state cases**

Append:

```js
test('schema-v4 active proposals require marketing regeneration', () => {
  const { cwd, config, memory } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/proposals.json'), JSON.stringify({
    schemaVersion: 4,
    proposals: [{ before: 'Submit', status: 'pending' }],
  }));
  assert.throws(
    () => requireMarketingKeys(cwd, config, memory),
    /schema v4.*marketing-loop propose/i,
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('handoff scope, file, and source hashes must match localization memory', () => {
  const { cwd, config, memory } = fixture();
  fs.writeFileSync(path.join(cwd, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
    messagesDir: 'locales',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [],
  }));
  assert.throws(
    () => requireMarketingKeys(cwd, config, memory),
    /disagree on messagesDir/,
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('handoff rejects stale scope digests, catalogue files, and source hashes', () => {
  const { cwd, config, memory } = fixture();
  const handoff = {
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: 'stale-scope',
    messagesDir: 'messages',
    sourceLocale: 'en',
    layout: 'single-file',
    unresolved: [{
      key: 'first.submit',
      file: 'messages/en.json',
      sourceHash: sha('Submit'),
      status: 'pending',
    }],
  };
  const write = () => fs.writeFileSync(
    path.join(cwd, '.marketing-loop/handoff.json'),
    JSON.stringify(handoff),
  );

  write();
  assert.throws(() => requireMarketingKeys(cwd, config, memory), /scope digest/i);

  handoff.scopeDigest = '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5';
  handoff.unresolved[0].file = 'messages/de.json';
  write();
  assert.throws(() => requireMarketingKeys(cwd, config, memory), /catalogue file/i);

  handoff.unresolved[0].file = 'messages/en.json';
  handoff.unresolved[0].sourceHash = sha('Old Submit');
  write();
  assert.throws(() => requireMarketingKeys(cwd, config, memory), /source hash/i);
  fs.rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 6: Run handoff tests**

Run:

```bash
npm run build && node --test tests/marketing-handoff.test.js
```

Expected: all cases pass.

- [ ] **Step 7: Commit the consumer boundary**

```bash
git add src/types.ts src/core/catalog.ts src/core/marketing.ts src/index.ts tests/marketing-handoff.test.js
git commit -m "feat: validate marketing handoff keys"
```

---

### Task 2: Remove marketing freezes from extraction

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/extract.test.js`
- Test: `tests/extract.test.js`

**Interfaces:**
- `cmdExtract` does not call `detectMarketingLoop`, `inspectMarketingHandoff`,
  or any marketing filtering function.
- `language-loop extract` always evaluates every safe hardcoded source string.

- [ ] **Step 1: Replace the obsolete extraction test**

Replace `marketing-loop pending copy freezes the matching strings` with:

```js
test('marketing handoff never prevents hardcoded text extraction', () => {
  const dir = sandbox();
  const { config, memory } = setup(dir);
  fs.mkdirSync(path.join(dir, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
    messagesDir: config.messagesDir,
    sourceLocale: config.sourceLocale,
    layout: config.layout,
    unresolved: [{
      key: 'future.getStartedFree',
      file: `${config.messagesDir}/${config.sourceLocale}.json`,
      sourceHash: 'not-created-yet',
      status: 'pending',
    }],
  }));

  const scan = scanRepo(dir, config);
  const keyed = assignKeys(scan.strings, config, memory);
  assert.ok(keyed.some((item) => item.text === 'Get started free'));
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="marketing handoff" tests/extract.test.js
```

Expected: current test support and CLI behavior still use raw pending text.

- [ ] **Step 3: Remove marketing filtering from `cmdExtract`**

Delete:

```ts
const marketing = detectMarketingLoop(cwd);
const frozen = frozenTexts(marketing, config);
const strings = scan.strings.filter((s) => !frozen.has(s.text));
```

Use:

```ts
const strings = scan.strings;
```

Remove the `frozenCount` output. Keep source edit adoption and target catalogue
adoption unchanged.

- [ ] **Step 4: Run extraction tests**

Run:

```bash
npm run build && node --test tests/extract.test.js tests/scan.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit lifecycle correction**

```bash
git add src/cli.ts tests/extract.test.js
git commit -m "fix: extract code before marketing review"
```

---

### Task 3: Key filtering in staged translation and briefs

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/core/brief.ts`
- Modify: `src/types.ts`
- Modify: `tests/brief.test.js`
- Modify: `tests/regressions.test.js`
- Test: `tests/brief.test.js`
- Test: `tests/regressions.test.js`

**Interfaces:**
- Consumes: `requireMarketingKeys(cwd, config, memory)`.
- `writeBrief` receives `frozen: WorkItem[]`, where each item was excluded by
  canonical key.
- Staged translation uses:

```ts
const marketingKeys = requireMarketingKeys(cwd, config, memory);
const frozen = work.filter((item) => marketingKeys.has(item.key));
const usable = work.filter((item) => !marketingKeys.has(item.key));
```

- [ ] **Step 1: Write a failing brief identity test**

Update the fixture in `tests/brief.test.js` so marketing metadata uses the new
installation type. Add:

```js
test('translation brief names exact marketing-frozen keys', () => {
  const frozen = [{
    key: 'hero.getStarted',
    locale: 'pt-BR',
    source: 'Get started',
    kind: 'cta',
    file: 'src/Hero.tsx',
    placeholders: [],
    reason: 'new',
  }];
  const result = writeBrief(dir, {
    config,
    memory,
    work: [],
    batch: createBatch([], { id: 'empty', sourceLocale: 'en-US' }),
    marketing: { installed: true, hasRun: true },
    openItems: [],
    frozen,
  });
  const brief = fs.readFileSync(path.join(dir, result.file), 'utf8');
  assert.match(brief, /hero\.getStarted/);
  assert.match(brief, /marketing-loop has an unresolved rewrite/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="marketing-frozen" tests/brief.test.js
```

Expected: brief types and rendering still expect raw frozen strings.

- [ ] **Step 3: Filter staged work by key**

In `cmdTranslate`, replace `frozenTexts` and source-text filtering with the
three-line key filter in the interface block. If `usable` is empty but `frozen`
is non-empty, print:

```text
<n> translation key(s) are waiting for marketing review.
Run npx marketing-loop review --ui, then npx marketing-loop apply.
```

Save memory and return without claiming every translation is complete.

- [ ] **Step 4: Render exact keys in the translation brief**

Change the frozen section to list:

```md
- `hero.getStarted` — “Get started”
```

Do not list or compare raw texts without keys. The voice/audience metadata from
`detectMarketingLoop` remains available.

- [ ] **Step 5: Add a CLI regression with duplicate source text**

Create two memory entries with the source `Submit`, hand off only one key, run
the staged `translate` command, and assert `.language-loop/batch.json` contains
the other key only.

- [ ] **Step 6: Run staged translation tests**

Run:

```bash
npm run build && node --test --test-name-pattern="marketing|duplicate source|brief" tests/brief.test.js tests/regressions.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit staged key filtering**

```bash
git add src/cli.ts src/core/brief.ts src/types.ts tests/brief.test.js tests/regressions.test.js
git commit -m "feat: freeze staged translations by key"
```

---

### Task 4: Key filtering in the autonomous runner

**Files:**
- Modify: `src/core/runner.ts`
- Modify: `src/types.ts`
- Modify: `tests/runner.test.js`
- Test: `tests/runner.test.js`

**Interfaces:**
- `RunTranslationLoopSummary.status` adds `'waiting-marketing'`.
- `RunTranslationLoopSummary` adds:

```ts
marketingBlocked: number;
```

- `runTranslationLoop` resolves marketing keys internally so programmatic and
  CLI execution cannot diverge.

- [ ] **Step 1: Write a failing autonomous exact-key test**

Append to `tests/runner.test.js`:

```js
test('autonomous run translates an identical source only when its key is not frozen', async () => {
  const { cwd, config, memory } = fixture();
  memory.entries.second = {
    ...structuredClone(memory.entries.greeting),
    source: memory.entries.greeting.source,
    sourceHash: memory.entries.greeting.sourceHash,
  };
  fs.mkdirSync(path.join(cwd, '.marketing-loop'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.marketing-loop/handoff.json'), JSON.stringify({
    schemaVersion: 1,
    marketingRunId: 'run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
    messagesDir: config.messagesDir,
    sourceLocale: config.sourceLocale,
    layout: config.layout,
    unresolved: [{
      key: 'greeting',
      file: 'messages/en.json',
      sourceHash: memory.entries.greeting.sourceHash,
      status: 'pending',
    }],
  }));
  const seen = [];
  const summary = await runTranslationLoop({
    cwd,
    memory,
    config,
    translator: async (batch) => {
      seen.push(...batch.units.map((unit) => unit.key));
      return batch.units.map((unit) => ({
        key: unit.key,
        locale: unit.locale,
        value: 'Willkommen, {name}',
      }));
    },
    judge: async (_batch, _artifact, units) =>
      units.map((unit) => ({ key: unit.key, locale: unit.locale, ok: true })),
  });
  assert.deepEqual(seen, ['second']);
  assert.equal(summary.marketingBlocked, 1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="identical source" tests/runner.test.js
```

Expected: both keys are translated.

- [ ] **Step 3: Resolve and apply marketing keys in every iteration**

At runner start:

```ts
const marketingKeys = requireMarketingKeys(cwd, config, memory);
```

Create:

```ts
const eligibleWork = () =>
  pendingWork(memory, config, input.locales)
    .filter((item) => !marketingKeys.has(item.key));
```

Use `eligibleWork()` for the initial limit, each iteration, and fingerprints.
Set `summary.marketingBlocked` from pending keys found in memory. If no eligible
work exists but blocked keys do, return `status: 'waiting-marketing'`.

- [ ] **Step 4: Run all runner tests**

Run:

```bash
npm run build && node --test tests/runner.test.js tests/retry-loop.test.js
```

Expected: all tests pass and retry ceilings remain unchanged for eligible work.

- [ ] **Step 5: Commit autonomous filtering**

```bash
git add src/core/runner.ts src/types.ts tests/runner.test.js
git commit -m "feat: freeze autonomous translations by key"
```

---

### Task 5: Status, audit, and sync-marketing diagnostics

**Files:**
- Modify: `src/core/completeness.ts`
- Modify: `src/core/report.ts`
- Modify: `src/cli.ts`
- Modify: `tests/completeness.test.js`
- Modify: `tests/regressions.test.js`
- Test: `tests/completeness.test.js`
- Test: `tests/regressions.test.js`

**Interfaces:**
- `CompletenessFinding.kind` adds:

```ts
'marketing-pending' | 'marketing-incompatible'
```

- Pending handoff keys are warnings.
- Invalid handoff state is a blocker.

- [ ] **Step 1: Write failing completeness cases**

Add:

```js
test('completeness reports exact marketing-pending keys', () => {
  const report = analyzeCompleteness(cwd, config);
  const finding = report.findings.find((item) => item.kind === 'marketing-pending');
  assert.deepEqual(finding.keys, ['hero.getStarted']);
  assert.equal(finding.severity, 'warn');
});

test('incompatible marketing state blocks translation', () => {
  const report = analyzeCompleteness(cwd, config);
  const finding = report.findings.find((item) => item.kind === 'marketing-incompatible');
  assert.equal(finding.severity, 'block');
  assert.match(finding.message, /marketing-loop propose/);
});
```

Use real memory/config/handoff fixtures, not mocks.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="marketing" tests/completeness.test.js
```

Expected: no marketing completeness findings exist.

- [ ] **Step 3: Add marketing findings to completeness**

Call `inspectMarketingHandoff`. On incompatibility, add one block finding with
the error and action `translate`. On unresolved keys, add one warning finding
with exact keys and the next step `marketing-loop review/apply`.

Do not mark locale translations missing solely because a marketing key is
frozen; existing missing/stale findings may coexist.

- [ ] **Step 4: Rewrite `sync-marketing` output**

Report:

- installation and run presence
- handoff schema compatibility
- scope agreement
- unresolved key count and first ten keys
- stale key/hash/file mismatches
- exact next command

Remove all raw pending text output.

- [ ] **Step 5: Update status and audit**

`status` shows `waiting on marketing` when unresolved keys exist. `audit` renders
the new findings and does not recommend translation before marketing apply.

- [ ] **Step 6: Run diagnostics tests**

Run:

```bash
npm run build && node --test --test-name-pattern="marketing|status|audit|sync" tests/completeness.test.js tests/regressions.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit diagnostics**

```bash
git add src/core/completeness.ts src/core/report.ts src/cli.ts tests/completeness.test.js tests/regressions.test.js
git commit -m "feat: report marketing handoff status"
```

---

### Task 6: Documentation, installed rules, version, and package verification

**Files:**
- Modify: `README.md`
- Modify: `skills/language-loop/SKILL.md`
- Modify: `src/core/install.ts`
- Modify: `commands/language-loop.md`
- Modify: `commands/i18n-audit.md`
- Modify: files under `agents/` that describe the workflow
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: tests covering version/install text

**Interfaces:**
- Release version becomes `0.4.0`.
- Documented lifecycle is extract → market → translate.

- [ ] **Step 1: Write failing documentation/install assertions**

Add assertions against installed rules and CLI help:

```js
assert.match(rule, /language-loop extract[\s\S]*marketing-loop propose[\s\S]*language-loop translate/);
assert.doesNotMatch(rule, /marketing-loop fixes the source copy first, from the code/i);
assert.match(help, /exact catalogue keys.*waiting for marketing/i);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="install|help|marketing" tests/regressions.test.js
```

Expected: old workflow text remains.

- [ ] **Step 3: Rewrite lifecycle documentation**

Use this order everywhere:

```text
npx language-loop scan
npx language-loop extract
npx marketing-loop propose
npx marketing-loop review --ui
npx marketing-loop apply
npx language-loop translate
npx language-loop judge
npx language-loop apply
```

State that marketing-loop edits only the source catalogue and language-loop
owns all code extraction and target catalogues.

- [ ] **Step 4: Update the pitch and installed agent rules**

Replace “marketing fixes source copy from code first” with:

```text
language-loop first moves hardcoded UI text into the source catalogue.
marketing-loop then settles that source copy before language-loop translates it.
```

Explain that exact unresolved keys pause, not every matching string.

- [ ] **Step 5: Bump versions to 0.4.0**

Update package, lockfile, CLI constant, and plugin manifest. Run the repository's
version synchronization script if present, then inspect the diff.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm test
npm pack --dry-run
```

Expected: all tests pass and the package contains updated skills, commands,
agents, dist, README, and license.

- [ ] **Step 7: Search for obsolete raw-text integration**

Run:

```bash
rg -n "pendingTexts|frozenTexts|matching strings|from the code rather than the README|marketing-loop fixes the source copy first" src tests README.md skills commands agents
```

Expected: no operational raw-text freeze or obsolete workflow language remains.

- [ ] **Step 8: Commit the consumer release**

```bash
git add README.md skills commands agents src tests package.json package-lock.json .claude-plugin
git commit -m "chore: prepare marketing handoff release"
```

---

## Language-loop completion gate

- [ ] `git status --short` is clean.
- [ ] `npm test` passes.
- [ ] `npm pack --dry-run` exits 0.
- [ ] Extract processes hardcoded text regardless of marketing state.
- [ ] Staged and autonomous translation filter by `WorkItem.key`.
- [ ] Two identical source strings with different keys remain independent.
- [ ] Schema-v4 pending marketing state stops translation with a regeneration command.
- [ ] Rejected, blocked, failed, and applied proposals are absent from the handoff and therefore cannot freeze work.
- [ ] Status, audit, and sync-marketing report exact unresolved keys.
