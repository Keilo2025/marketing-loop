# Cross-loop Contract and Coordinated Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the catalogue-only marketing producer and key-based language consumer interoperate end to end, then release the compatible versions together.

**Architecture:** Each repository owns a copy of one versioned JSON contract fixture and tests its side independently. A release-only cross-loop test runs both built checkouts against one temporary app, verifies byte-for-byte ownership boundaries, and checks localization staleness after an approved marketing edit.

**Tech Stack:** Node.js 18.17+, ESM, `node:test`, both local CLI builds, temporary filesystem fixtures, npm package dry-runs, no runtime coupling between packages.

## Global Constraints

- Execute only after the marketing producer and language consumer plans pass their completion gates.
- Marketing repository: `/Users/christianbuchholz/GitStuff/marketing-loop`.
- Language repository: `/Users/christianbuchholz/GitStuff/language-loop`.
- Obtain write access to both repositories before execution.
- Do not add either npm package as a runtime or development dependency of the other.
- Handoff schema is exactly version 1.
- Compatible release pair is `marketing-loop@0.5.0` and `language-loop@0.4.0`.
- Publish neither package until both package dry-runs and the cross-loop test pass.
- The release test must prove application code and target-language catalogues are byte-for-byte unchanged by marketing apply.
- Use the actual built CLIs and actual state readers; do not mock either loop.

---

## File map

### Marketing repository

- Create: `tests/contracts/marketing-handoff-v1.json`
- Create: `tests/cross-loop.test.js`
- Modify: `tests/handoff.test.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `PUBLISHING.md`

### Language repository

- Create: `tests/contracts/marketing-handoff-v1.json`
- Modify: `tests/marketing-handoff.test.js`
- Modify: `README.md`
- Modify: publishing documentation if present

---

### Task 1: Pin handoff schema 1 with a shared contract fixture

**Files:**
- Create: `/Users/christianbuchholz/GitStuff/marketing-loop/tests/contracts/marketing-handoff-v1.json`
- Modify: `/Users/christianbuchholz/GitStuff/marketing-loop/tests/handoff.test.js`
- Create: `/Users/christianbuchholz/GitStuff/language-loop/tests/contracts/marketing-handoff-v1.json`
- Modify: `/Users/christianbuchholz/GitStuff/language-loop/tests/marketing-handoff.test.js`

**Interfaces:**
- Both fixtures contain identical bytes:

```json
{
  "schemaVersion": 1,
  "marketingRunId": "contract-run",
  "scopeDigest": "976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5",
  "messagesDir": "messages",
  "sourceLocale": "en",
  "layout": "single-file",
  "unresolved": [
    {
      "key": "hero.startFree",
      "file": "messages/en.json",
      "sourceHash": "22a1d78d60d5d6c4ed6c7e030a9bc8886239ca690c9327dc923a3496476b801f",
      "status": "pending"
    }
  ]
}
```

- Both helpers must calculate the pinned SHA-256
  `22a1d78d60d5d6c4ed6c7e030a9bc8886239ca690c9327dc923a3496476b801f`
  for `Start free`. Both fixture files must remain byte-equal.

- [ ] **Step 1: Add the fixture to marketing-loop and write a failing producer test**

Add:

```js
test('handoff producer matches the versioned contract fixture', () => {
  const expected = JSON.parse(fs.readFileSync(
    path.join(here, 'contracts/marketing-handoff-v1.json'),
    'utf8',
  ));
  const state = handoffState([{
    id: 'contract-proposal',
    key: 'hero.startFree',
    text: 'Start free',
    status: 'pending',
  }], {
    runId: 'contract-run',
    scopeDigest: '976e87b8cff00e0a92f84f08d333b0d87fa4cf98764aef8b79c392edd02ec5a5',
  });
  assert.deepEqual(deriveHandoff(state.set, state.inventory, state.scope), expected);
});
```

- [ ] **Step 2: Run marketing contract test and verify RED**

Run:

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
npm run build && node --test --test-name-pattern="contract fixture" tests/handoff.test.js
```

Expected: hash or fixture fields differ until the producer follows the pinned
contract exactly.

- [ ] **Step 3: Make the marketing producer match without special cases**

Fix general derivation ordering, source hashing, or field serialization. Do not
add a branch for `contract-run`.

- [ ] **Step 4: Copy the exact fixture into language-loop and write a consumer test**

The language test loads the fixture, writes it to
`.marketing-loop/handoff.json`, creates matching config/memory, and asserts:

```js
assert.deepEqual(
  [...requireMarketingKeys(cwd, config, memory)],
  ['hero.startFree'],
);
```

- [ ] **Step 5: Run both contract tests**

Run:

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
npm run build && node --test --test-name-pattern="contract fixture" tests/handoff.test.js
cd /Users/christianbuchholz/GitStuff/language-loop
npm run build && node --test --test-name-pattern="contract fixture" tests/marketing-handoff.test.js
cmp /Users/christianbuchholz/GitStuff/marketing-loop/tests/contracts/marketing-handoff-v1.json /Users/christianbuchholz/GitStuff/language-loop/tests/contracts/marketing-handoff-v1.json
```

Expected: both tests pass and `cmp` exits 0.

- [ ] **Step 6: Commit in each repository**

Marketing repository:

```bash
git add tests/contracts/marketing-handoff-v1.json tests/handoff.test.js
git commit -m "test: pin marketing handoff contract"
```

Language repository:

```bash
git add tests/contracts/marketing-handoff-v1.json tests/marketing-handoff.test.js
git commit -m "test: pin marketing handoff contract"
```

---

### Task 2: Add the real cross-loop lifecycle test

**Files:**
- Create: `/Users/christianbuchholz/GitStuff/marketing-loop/tests/cross-loop.test.js`
- Modify: `/Users/christianbuchholz/GitStuff/marketing-loop/package.json`
- Test: `/Users/christianbuchholz/GitStuff/marketing-loop/tests/cross-loop.test.js`

**Interfaces:**
- Environment variable:

```text
LANGUAGE_LOOP_REPO=/absolute/path/to/language-loop
```

- npm script:

```json
"test:cross-loop": "npm run build && node --test tests/cross-loop.test.js"
```

- The test skips only when `LANGUAGE_LOOP_REPO` is absent. The coordinated
  release command always supplies it, so a skip is a release failure.

- [ ] **Step 1: Write the failing cross-loop test fixture**

Create `tests/cross-loop.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const languageRepo = process.env.LANGUAGE_LOOP_REPO;
const marketingRoot = fileURLToPath(new URL('..', import.meta.url));

function run(cli, cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--cwd', cwd], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

test('catalogue marketing hands one changed key back to language-loop', {
  skip: !languageRepo && 'set LANGUAGE_LOOP_REPO to the language-loop checkout',
}, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-loop-'));
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
  assert.match(fs.readFileSync(path.join(cwd, 'messages/en.json'), 'utf8'), /A deployment dashboard/);

  const languageConfig = await import(pathToFileURL(path.join(languageDist, 'config.js')));
  const languageMemory = await import(pathToFileURL(path.join(languageDist, 'memory.js')));
  const config = languageConfig.loadConfig(cwd);
  const memory = languageMemory.loadMemory(cwd, 'en');
  const changed = languageMemory.adoptSourceEdits(cwd, memory, config);
  assert.deepEqual(changed, ['hero.headline']);
  assert.equal(memory.entries['hero.headline'].translations.de.status, 'stale');
  assert.equal(memory.entries['hero.body'].translations.de, undefined);

  const handoff = JSON.parse(fs.readFileSync(path.join(cwd, '.marketing-loop/handoff.json'), 'utf8'));
  assert.deepEqual(handoff.unresolved, []);
  fs.rmSync(cwd, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add the npm script and run RED**

Run:

```bash
cd /Users/christianbuchholz/GitStuff/language-loop
npm run build
cd /Users/christianbuchholz/GitStuff/marketing-loop
LANGUAGE_LOOP_REPO=/Users/christianbuchholz/GitStuff/language-loop npm run test:cross-loop
```

Expected: failure at the first producer/consumer contract difference or missing
CLI lifecycle behavior. A skipped test is not acceptable because the environment
variable is set.

- [ ] **Step 3: Fix only cross-repository contract defects**

Correct serialization order, CLI handoff timing, source hashing, or key-to-file
validation in the owning repository. Do not weaken scope validation and do not
special-case the fixture.

- [ ] **Step 4: Run GREEN and inspect test count**

Run the same command. Expected:

- one cross-loop test runs
- zero skipped
- application code unchanged
- German catalogue unchanged during marketing
- only `hero.headline` becomes stale
- handoff is empty after marketing apply

- [ ] **Step 5: Commit the release-only test**

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
git add tests/cross-loop.test.js package.json package-lock.json
git commit -m "test: verify cross-loop catalogue lifecycle"
```

---

### Task 3: Document compatibility and coordinated upgrade

**Files:**
- Modify: `/Users/christianbuchholz/GitStuff/marketing-loop/README.md`
- Modify: `/Users/christianbuchholz/GitStuff/marketing-loop/PUBLISHING.md`
- Modify: `/Users/christianbuchholz/GitStuff/language-loop/README.md`
- Modify: language-loop publishing documentation if present

**Interfaces:**
- Required pair:

```text
marketing-loop >= 0.5.0
language-loop >= 0.4.0
```

- [ ] **Step 1: Add compatibility statements**

Both READMEs must say:

```text
The key-based handshake requires marketing-loop 0.5+ and language-loop 0.4+.
Upgrade both together. language-loop refuses legacy pending marketing state
instead of guessing by raw text.
```

- [ ] **Step 2: Add release order and rollback notes**

Publishing docs must require:

1. verify both tarballs
2. run the cross-loop test
3. publish `language-loop@0.4.0`
4. immediately publish `marketing-loop@0.5.0`
5. verify npm metadata and clean-install smoke tests

Rollback guidance:

- do not apply schema-v5 state with marketing-loop 0.4
- do not translate unresolved schema-v4 marketing state with language-loop 0.4
- regenerate marketing proposals after both compatible versions are installed

- [ ] **Step 3: Search for contradictory version guidance**

Run:

```bash
rg -n "marketing-loop|language-loop|0\\.4|0\\.5|upgrade|compatib" README.md PUBLISHING.md
```

in each repository. Expected: no statement recommends running the old
marketing-from-code order.

- [ ] **Step 4: Commit docs in each repository**

Marketing:

```bash
git add README.md PUBLISHING.md
git commit -m "docs: document paired loop upgrade"
```

Language:

```bash
git add README.md
git commit -m "docs: document paired loop upgrade"
```

---

### Task 4: Final release verification

**Files:**
- No production changes expected.
- Generated `.tgz` files must be created in temporary directories, not repository roots.

**Interfaces:**
- Evidence required before publishing:
  - both full test suites
  - both package dry-runs
  - cross-loop test with zero skips
  - clean working trees
  - package contents and versions

- [ ] **Step 1: Run both full suites**

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
npm test
cd /Users/christianbuchholz/GitStuff/language-loop
npm test
```

Expected: zero failures. Run the marketing canvas test in an environment allowed
to bind `127.0.0.1`.

- [ ] **Step 2: Run the cross-loop test again**

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
LANGUAGE_LOOP_REPO=/Users/christianbuchholz/GitStuff/language-loop npm run test:cross-loop
```

Expected: one test passes, zero tests skip.

- [ ] **Step 3: Verify package contents**

```bash
cd /Users/christianbuchholz/GitStuff/marketing-loop
npm pack --dry-run
cd /Users/christianbuchholz/GitStuff/language-loop
npm pack --dry-run
```

Expected: both exit 0 and include built distribution, skills, commands, agents,
README, license, and plugin metadata without tests or local state.

- [ ] **Step 4: Verify versions and clean trees**

```bash
node -p "require('/Users/christianbuchholz/GitStuff/marketing-loop/package.json').version"
node -p "require('/Users/christianbuchholz/GitStuff/language-loop/package.json').version"
git -C /Users/christianbuchholz/GitStuff/marketing-loop status --short
git -C /Users/christianbuchholz/GitStuff/language-loop status --short
```

Expected:

```text
0.5.0
0.4.0
```

and no status entries.

- [ ] **Step 5: Inspect commit ranges**

```bash
git -C /Users/christianbuchholz/GitStuff/marketing-loop log --oneline origin/main..HEAD
git -C /Users/christianbuchholz/GitStuff/language-loop log --oneline origin/main..HEAD
```

Confirm every commit belongs to the approved catalogue-only scope and no
unrelated user changes are included.

---

## Coordinated release gate

- [ ] Producer and consumer contract fixtures are byte-identical.
- [ ] `marketing-loop@0.5.0` full suite passes.
- [ ] `language-loop@0.4.0` full suite passes.
- [ ] Cross-loop test passes with zero skips.
- [ ] Marketing apply leaves application code unchanged.
- [ ] Marketing apply leaves target catalogues unchanged.
- [ ] Language-loop marks only changed source keys stale.
- [ ] Both `npm pack --dry-run` commands pass.
- [ ] Both working trees are clean.
- [ ] Compatibility and regeneration instructions are present in both READMEs.
- [ ] Publishing still requires the user's explicit authorization.
