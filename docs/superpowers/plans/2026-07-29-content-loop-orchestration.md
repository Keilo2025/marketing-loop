# Content Loop Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Marketing Loop the single resumable Content Loop entry point, with one canonical message filter, mandatory human marketing review, strict schema-v1 handoff validation, and continuous judge-accepted translation across every selected target language.

**Architecture:** A pure Content Loop state machine coordinates injected marketing and language adapters and persists only a status projection. The real marketing adapter reuses schema-v5 proposal/review/apply paths; the language adapter dynamically imports Language Loop 0.4 public APIs and refuses filtered execution without its explicit key-filter capability. Canonical resolved keys and locales bind both stages while the existing catalogue and decision digests remain the write authorization.

**Tech Stack:** Node.js 18.17+, TypeScript 5.7 ESM, `node:test`, JSON state files, `language-loop >=0.4.0 <0.5.0` peer dependency.

## Global Constraints

- Marketing may read and write only the configured source-locale JSON catalogue.
- Marketing must never inspect application code or target-locale catalogue content.
- Language Loop owns extraction, source-edit adoption, translation, judging, and target-catalogue writes.
- Handoff schema 1 keeps its existing required fields; `selection` is additive and optional.
- Active marketing state remains schema 5 and refuses legacy schema 4 authorization.
- One normalized `ContentFilter` and its resolved canonical keys bind propose, import, review, apply, handoff, and translation.
- Content Loop completes only when every selected key in every selected target locale is source-current and judge-approved or explicitly human-approved.
- Partial batches, outstanding locales, retry work, and `needs-human` entries are never reported as complete.
- Do not copy Language Loop implementation or shell out to its CLI.

---

## File map

### New files

- `src/core/filter.ts` — normalize, validate, match, and resolve Content filters.
- `src/core/content.ts` — pure resumable state machine and state persistence.
- `src/core/content-language.ts` — dynamic Language Loop module adapter and all-language completion verification.
- `tests/content-filter.test.js` — selector semantics and handoff persistence.
- `tests/content-loop.test.js` — pure state transitions and all-language completion gate.
- `tests/content-language.test.js` — dynamic adapter, capability, key filter, progress, and completion verification.
- `tests/content-cli.test.js` — single-command proposal/review/apply/status lifecycle.

### Focused changes

- `src/types.ts` — Content filter, selection, state, progress, and adapter types.
- `src/core/propose.ts` — generate only from selected ranked items.
- `src/core/ingest.ts` — reject untrusted proposals outside selected keys.
- `src/core/apply.ts` — fail the batch when a selected proposal escapes its bound selection.
- `src/core/handoff.ts` — persist optional selection and verify selected proposal identity.
- `src/core/state.ts` — bind selection into the proposal digest.
- `src/config.ts` — add the durable Content Loop state path.
- `src/cli.ts` — `content` command, real marketing adapter, flags, and status rendering.
- `src/index.ts` — export stable filter, orchestrator, and adapter APIs.
- `package.json` — compatible Language Loop peer dependency and Content integration test script.
- `README.md`, `PUBLISHING.md`, `skills/marketing-loop/SKILL.md`, `commands/marketing-loop.md` — single-app lifecycle, filters, completion semantics, and migration.
- `tests/cross-loop.test.js` — real consumer adoption plus all-language/key-filter integration when capability 1 is present.

---

### Task 1: Canonical Content Filter and Handoff Selection

**Files:**
- Create: `src/core/filter.ts`
- Create: `tests/content-filter.test.js`
- Modify: `src/types.ts`
- Modify: `src/core/handoff.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface ContentFilter {
  schemaVersion: 1;
  types: string[];
  groups: string[];
  keys: string[];
}

export interface ContentSelection {
  filter: ContentFilter;
  resolvedKeys: string[];
  targetLocales: string[];
}

export const EMPTY_CONTENT_FILTER: ContentFilter;
export function normalizeContentFilter(input?: Partial<ContentFilter>): ContentFilter;
export function matchesContentFilter(item: CopyItem, filter: ContentFilter): boolean;
export function resolveContentSelection(
  items: CopyItem[],
  filter: ContentFilter,
  targetLocales?: string[],
): ContentSelection;
```

- Extends `ProposalSet` with `selection?: ContentSelection`.
- Extends `MarketingHandoff` with `selection?: ContentSelection`.

- [ ] **Step 1: Write failing selector and handoff tests**

Test exact key, group-prefix, CTA/headline/button/navigation/label types, AND-across-fields semantics, unknown type refusal, empty selection refusal when a filter is explicit, sorted deduplicated keys/locales, and:

```js
const handoff = deriveHandoff(setWithSelection, inventory, scope);
assert.deepEqual(handoff.selection, {
  filter: { schemaVersion: 1, types: ['cta'], groups: ['hero'], keys: [] },
  resolvedKeys: ['hero.primaryCta'],
  targetLocales: ['de', 'fr'],
});
assert.deepEqual(
  handoff.unresolved.map((entry) => entry.key),
  ['hero.primaryCta'],
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test tests/content-filter.test.js
```

Expected: import failure for `dist/core/filter.js`.

- [ ] **Step 3: Implement normalization and matching**

Use exact canonical key identity:

```ts
const BUILT_INS: Record<string, (item: CopyItem) => boolean> = {
  cta: (item) => item.kind === 'cta',
  headline: (item) => item.kind === 'headline',
  button: (item) => item.catalogueKey.split('.').some((part) =>
    /^(button|btn|action|submit)$/i.test(part)),
  navigation: (item) => item.kind === 'nav',
  label: (item) => item.kind === 'label',
};
```

Normalize strings by trim, deduplicate, and sort. Reject unknown types,
malformed keys/groups, source locale in target locales, and an explicit filter
that resolves to no catalogue keys.

- [ ] **Step 4: Persist selection through handoff**

`deriveHandoff` must include `set.selection` only after checking:

```ts
const allowed = new Set(set.selection?.resolvedKeys ?? inventory.items.map((item) => item.catalogueKey));
if (set.proposals.some((proposal) => !allowed.has(proposal.catalogueKey))) {
  throw new Error('proposal is outside the Content Loop selection');
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build
node --test tests/content-filter.test.js tests/handoff.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/core/filter.ts src/core/handoff.ts src/index.ts tests/content-filter.test.js tests/handoff.test.js
git commit -m "feat: add canonical Content Loop filters"
```

---

### Task 2: Enforce Selection Through Propose, Import, Review, and Apply

**Files:**
- Modify: `src/core/propose.ts`
- Modify: `src/core/ingest.ts`
- Modify: `src/core/apply.ts`
- Modify: `src/core/state.ts`
- Modify: `src/core/brief.ts`
- Modify: `tests/unit.test.js`

**Interfaces:**
- Consumes: `ContentSelection`, `matchesContentFilter`.
- Extends `ProposeInput` with `selection?: ContentSelection`.
- Extends `importAgentOutput(..., selection?: ContentSelection)` or reads the
  selection from `ProposalSet`.

- [ ] **Step 1: Write failing selection-boundary tests**

Cover:

```js
const selected = resolveContentSelection(items, {
  schemaVersion: 1,
  types: ['cta'],
  groups: ['audit'],
  keys: [],
}, ['de']);
const proposed = propose({ items, ranked, findings, context, behavior, config, selection: selected });
assert.ok(proposed.proposals.every((p) => selected.resolvedKeys.includes(p.catalogueKey)));
```

Also submit a valid schema-v5 agent proposal for an inventory item outside the
selection and assert import rejection, forge an out-of-selection proposal before
apply and assert the entire batch is refused without changing the source file,
and assert the brief prints the normalized selection.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build
node --test --test-name-pattern="Content selection" tests/unit.test.js
```

Expected: the engine or import currently accepts an out-of-selection item.

- [ ] **Step 3: Filter deterministic and open proposals**

At the start of `propose`, construct:

```ts
const selected = new Set(input.selection?.resolvedKeys ?? items.map((item) => item.catalogueKey));
```

Skip every ranked item whose canonical key is absent. Do not use display text,
file names, or target locale data.

- [ ] **Step 4: Enforce untrusted import and apply**

In import, reject with:

```text
copyId <id> is outside the active Content Loop selection
```

In apply preflight, compare every proposal key against `set.selection.resolvedKeys`
before creating backups or writes. Bind the normalized selection into
`proposalDigest` so changing it invalidates prior decisions.

- [ ] **Step 5: Render selection in the brief/review context**

Print types, groups, explicit keys, resolved key count, and target locales.
Never include target catalogue values.

- [ ] **Step 6: Run focused and apply tests**

Run:

```bash
npm run build
node --test tests/unit.test.js tests/apply-security.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/propose.ts src/core/ingest.ts src/core/apply.ts src/core/state.ts src/core/brief.ts tests/unit.test.js
git commit -m "fix: enforce Content selection at every marketing gate"
```

---

### Task 3: Durable Pure Content Loop State Machine

**Files:**
- Create: `src/core/content.ts`
- Create: `tests/content-loop.test.js`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces:

```ts
export type ContentPhase =
  | 'marketing'
  | 'waiting-review'
  | 'language-ready'
  | 'language'
  | 'complete'
  | 'needs-human'
  | 'blocked';

export interface ContentLanguageProgress {
  locale: string;
  total: number;
  accepted: number;
  pending: number;
  rework: number;
  needsHuman: number;
  activeBatch?: number;
}

export interface ContentMarketingSnapshot {
  runId: string;
  selectedKeys: string[];
  proposals: number;
  pending: number;
  approved: number;
  rejected: number;
  applied: number;
  failed: number;
  explicitDecisions: number;
  handoffCompatible: boolean;
  unresolvedKeys: string[];
}

export interface ContentLanguageSnapshot {
  compatible: boolean;
  status: 'ready' | 'running' | 'complete' | 'needs-human' | 'blocked';
  adoptedSourceKeys: string[];
  pending: number;
  applied: number;
  needsHuman: number;
  marketingBlocked: number;
  progress: ContentLanguageProgress[];
  error?: string;
}

export interface ContentMarketingAdapter {
  start(selection: ContentSelection): Promise<ContentMarketingSnapshot>;
  inspect(): Promise<ContentMarketingSnapshot>;
  collectAndApply(): Promise<ContentMarketingSnapshot>;
  openReview?(): Promise<void>;
}

export interface ContentLanguageAdapter {
  run(input: {
    execute: boolean;
    keys: string[];
    locales: string[];
    onProgress?: (progress: ContentLanguageProgress[]) => void;
  }): Promise<ContentLanguageSnapshot>;
}

export async function runContentLoop(input: {
  stateFile: string;
  selection: ContentSelection;
  marketing: ContentMarketingAdapter;
  language: ContentLanguageAdapter;
  executeLanguage: boolean;
  restart?: boolean;
  openReview?: boolean;
}): Promise<ContentLoopState>;
```

- [ ] **Step 1: Write failing transition tests**

Test:

1. new → waiting-review and language adapter not called;
2. untouched review remains waiting-review;
3. reviewed → apply → language-ready without execution;
4. non-empty/incompatible handoff → blocked;
5. `complete` snapshot with any locale where `accepted < total` → blocked;
6. all selected locales accepted → complete;
7. needs-human and provider failure preserve per-language progress;
8. terminal rerun is idempotent;
9. restart creates a new content run but retains filter/locales.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
npm run build
node --test tests/content-loop.test.js
```

Expected: missing `dist/core/content.js`.

- [ ] **Step 3: Implement atomic state persistence**

Use `writeJson` for every transition and progress callback. Validate schema,
phase, selected keys/locales, and progress counts when reading existing state.
State is never a write authorization.

- [ ] **Step 4: Implement transition guards**

Before language:

```ts
if (!marketing.handoffCompatible || marketing.unresolvedKeys.length) {
  return block('marketing handoff must be compatible and resolved before translation');
}
```

Before complete:

```ts
const outstanding = language.progress.filter((row) =>
  row.total !== row.accepted || row.pending || row.rework || row.needsHuman);
if (language.status === 'complete' && outstanding.length) {
  return block('language runner reported complete with outstanding selected languages');
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run build
node --test tests/content-loop.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts src/core/content.ts src/index.ts tests/content-loop.test.js
git commit -m "feat: add resumable Content Loop state machine"
```

---

### Task 4: Dynamic Continuous Language Loop Adapter

**Files:**
- Create: `src/core/content-language.ts`
- Create: `tests/content-language.test.js`
- Modify: `src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ContentLanguageAdapter`, `ContentLanguageSnapshot`.
- Produces:

```ts
export interface LanguageLoopAdapterOptions {
  cwd: string;
  modulePath?: string;
  translator?: (
    batch: unknown,
    contexts: ReadonlyMap<string, unknown>,
    config: unknown,
  ) => Promise<Array<{ key: string; locale: string; value: string; note?: string }>>;
  judge?: (
    batch: unknown,
    translations: unknown,
    units: unknown[],
    contexts: ReadonlyMap<string, unknown>,
    config: unknown,
  ) => Promise<Array<{ key: string; locale: string; ok: boolean; reason: string }>>;
}

export async function loadLanguageLoopAdapter(
  options: LanguageLoopAdapterOptions,
): Promise<ContentLanguageAdapter>;
```

- [ ] **Step 1: Write failing module-contract and completion tests**

Use temporary ESM fixture modules to prove:

- missing required export gives the exact export name;
- filtered run without `CONTENT_LOOP_API_VERSION === 1` is refused before runner call;
- `keys` and every selected locale reach `runTranslationLoop`;
- a two-locale, multi-batch runner keeps reporting progress and verifies both
  locale rows before complete;
- runner `complete` with a stale/missing selected pair becomes blocked;
- out-of-selection keys are never passed to translator/judge;
- rate/provider errors retain progress and return blocked.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
npm run build
node --test tests/content-language.test.js
```

Expected: missing adapter module.

- [ ] **Step 3: Implement safe dynamic resolution**

Resolve an explicit file path first. Otherwise use
`createRequire(import.meta.url).resolve('language-loop')` and dynamic import its
file URL. Never inspect Language Loop source files.

Validate the public API functions listed in the design. For filtered execution
require `CONTENT_LOOP_API_VERSION === 1`.

- [ ] **Step 4: Implement adoption, execution, and progress**

Load config/memory, validate `inspectMarketingHandoff`, adopt catalogue/source
edits, resolve every target locale (all configured targets when none supplied),
and call:

```ts
await module.runTranslationLoop({
  cwd,
  memory,
  config,
  keys,
  locales,
  translator: wrappedTranslator,
  judge: wrappedJudge,
});
```

The wrappers update per-locale active/accepted projections after each batch.
After the call, reload memory and independently compute the selected
key-by-locale matrix. Only source-current `approved` or explicit `manual`
records count as accepted.

- [ ] **Step 5: Declare dependency policy**

Add:

```json
"peerDependencies": {
  "language-loop": ">=0.4.0 <0.5.0"
}
```

Do not add Language Loop source to package files.

- [ ] **Step 6: Run adapter tests**

Run:

```bash
npm run build
node --test tests/content-language.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/content-language.ts src/index.ts package.json tests/content-language.test.js
git commit -m "feat: adapt the continuous Language Loop runner"
```

---

### Task 5: Single Content CLI and Real Marketing Adapter

**Files:**
- Create: `tests/content-cli.test.js`
- Modify: `src/cli.ts`
- Modify: `src/config.ts`
- Modify: `src/core/handoff.ts`

**Interfaces:**
- Consumes: `runContentLoop`, `loadLanguageLoopAdapter`,
  `normalizeContentFilter`, `resolveContentSelection`.
- Produces CLI:

```text
marketing-loop content [status] [--ui] [--llm] [--restart]
  --types cta,headline,button,navigation,label
  --groups hero,pricing
  --keys hero.primaryCta,nav.signup
  --locales de,fr
  --language-module /absolute/path/to/language-loop/dist/index.js
```

- [ ] **Step 1: Write failing CLI lifecycle tests**

In a temporary catalogue:

1. run `content --types cta --groups audit --locales de`;
2. assert review/state/handoff selection contain only the audit CTA;
3. assert status prints phase, filter, selected keys, and per-language progress;
4. tick review and rerun with an injected fixture language module;
5. assert only selected source key changed and only selected key was passed to
   translation;
6. assert missing Language Loop produces a blocked actionable message;
7. assert `--restart` archives the prior marketing run and starts another.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
npm run build
node --test tests/content-cli.test.js
```

Expected: `content` prints help or unknown command.

- [ ] **Step 3: Factor reusable marketing command results**

Make `cmdPropose`, review collection, and `cmdApply` return structured summaries
without changing existing console behavior. The Content marketing adapter calls
these functions directly in-process; it never spawns `marketing-loop`.

- [ ] **Step 4: Parse and persist filter/locales**

Normalize comma-separated flags, resolve against the new inventory, bind
selection to the proposal set, brief, handoff, and Content state. On resume,
reject flags that differ from persisted selection unless `--restart` is given.

- [ ] **Step 5: Render one lifecycle status**

Print:

```text
Content Loop · waiting-review
filter: types=cta · groups=audit · 1 selected key
marketing: 1 pending · 0 applied · 0 failed
language de: 0/1 accepted · 1 pending
next: npx marketing-loop content --ui
```

Every next command remains `marketing-loop content`; do not direct users to the
Language Loop CLI.

- [ ] **Step 6: Run CLI and existing workflow tests**

Run:

```bash
npm run build
node --test tests/content-cli.test.js tests/workflow.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/config.ts src/core/handoff.ts tests/content-cli.test.js
git commit -m "feat: expose the unified Content Loop command"
```

---

### Task 6: Real Cross-Loop Gate, Migration Docs, and Release Verification

**Files:**
- Modify: `tests/cross-loop.test.js`
- Modify: `README.md`
- Modify: `PUBLISHING.md`
- Modify: `skills/marketing-loop/SKILL.md`
- Modify: `commands/marketing-loop.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: built compatible Language Loop module at
  `$LANGUAGE_LOOP_REPO/dist/index.js`.

- [ ] **Step 1: Extend the real integration test**

Use at least two target locales and two source keys. Select one canonical key.
Provide deterministic translator/judge callbacks. Assert:

- marketing leaves app code and every target catalogue byte-identical;
- only selected marketing key reaches proposals/review/handoff;
- Language Loop adopts exactly that source key;
- every selected locale is processed even when `maxBatch` forces several
  batches;
- a first judge rejection is retried and the later acceptance lands;
- Content phase is complete only after every selected locale is accepted;
- the unselected key's decoded values remain unchanged;
- files/namespaces with no selected keys remain byte-identical.

- [ ] **Step 2: Add the dedicated integration script**

Add:

```json
"test:content-loop": "npm run build && node --test tests/content-language.test.js tests/content-cli.test.js tests/cross-loop.test.js"
```

- [ ] **Step 3: Replace the two-app primary documentation**

Lead with:

```bash
npx marketing-loop content --ui --types cta,headline
npx marketing-loop content --llm
npx marketing-loop content status
```

Document advanced modular commands separately, filter intersection semantics,
all-configured-target default, judge-accepted completion, allowed pause reasons,
schema-v4 regeneration, Language Loop peer range/capability 1, and the
coordinated release order.

- [ ] **Step 4: Run forbidden-boundary and contract scans**

Run:

```bash
rg -n "readFileSync|readdirSync|walk" src/core/content.ts src/core/filter.ts
rg -n "language-loop (translate|judge|apply)" README.md skills commands
git diff --check
```

Expected: Content orchestration contains no application/target file reads, user
docs do not teach a second-app lifecycle, and diff check is clean.

- [ ] **Step 5: Run final verification**

Run:

```bash
LANGUAGE_LOOP_REPO=/absolute/path/to/compatible/language-loop npm test
LANGUAGE_LOOP_REPO=/absolute/path/to/compatible/language-loop npm run test:content-loop
npm_config_cache=/tmp/marketing-loop-npm-cache npm pack --dry-run
```

Expected: all tests pass with zero cross-loop skips; package contains compiled
Content modules but no copied Language Loop source.

- [ ] **Step 6: Commit**

```bash
git add README.md PUBLISHING.md skills/marketing-loop/SKILL.md commands/marketing-loop.md package.json tests/cross-loop.test.js
git commit -m "docs: make Content Loop the primary lifecycle"
```
