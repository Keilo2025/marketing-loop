# Content Loop orchestration

**Status:** Approved design  
**Date:** 2026-07-29  
**Owner:** `marketing-loop` 0.5  
**Language engine:** compatible `language-loop` 0.4.1+

## Summary

Marketing Loop becomes the primary user-facing application for one Content
Loop. The underlying marketing and localization engines remain separate
modules. A resumable `marketing-loop content` command and `runContentLoop()`
API run the marketing stage, stop at the existing human approval gate, apply
approved source-catalogue edits, validate the schema-v1 handoff, and then call
Language Loop's public translation runner through a dependency adapter.

Marketing Loop never reads application code or target locales. Language Loop
continues to own extraction, source-edit adoption, translation, judging, and
target-catalogue writes. No Language Loop implementation is copied into this
repository.

## Goals

1. Present one Content Loop entry point and lifecycle status.
2. Keep human marketing approval mandatory and resumable.
3. Reuse Language Loop's completed schema-v1 consumer and translation runner.
4. Fail closed before translation when the handoff or catalogue scope is
   incompatible.
5. Keep both engines independently testable through stable adapters.
6. Preserve existing low-level marketing commands and programmatic APIs.
7. Apply one user-selected message filter to both stages.
8. Complete only when every selected message in every selected target language
   is judge-accepted or explicitly accepted by a human.

## Non-goals

- Reimplementing Language Loop extraction, translation, judging, providers, or
  target-catalogue apply logic.
- Letting the marketing engine inspect code or target locales.
- Removing the human marketing review gate.
- Building a new graphical application in this release.
- Making provider-backed translation run without the provider credentials
  already required by Language Loop.

## Approaches

### Selected: dependency-backed resumable orchestrator

Marketing Loop owns a small state machine and dynamically imports the compatible
Language Loop package. The adapter calls only Language Loop's exported public
APIs. It is injectable for deterministic tests and supports an explicit module
path for local integration testing.

This gives users one command while keeping the engines modular and independently
releasable.

### Rejected: shell out to the Language Loop CLI

Spawning a second binary would preserve implementation reuse, but couples the
workflow to console text, exit codes, binary discovery, and another user-facing
command. It is not a stable application boundary.

### Rejected: copy or merge Language Loop implementation

Copying would create two localization engines and make contract, guardrail, and
provider fixes diverge. A full source merge would also weaken the ownership
boundary that protects application code and target locales from marketing.

## Public interface

### CLI

```bash
npx marketing-loop content
npx marketing-loop content --ui
npx marketing-loop content --llm
npx marketing-loop content --types cta,headline --groups hero,pricing
npx marketing-loop content --keys hero.primaryCta,nav.signup --locales de,fr
npx marketing-loop content status
npx marketing-loop content --restart
```

`content` is resumable:

1. With no active Content Loop run, it runs the marketing proposal stage,
   writes the review surface, records `waiting-review`, and stops.
2. While no explicit review decision exists, it remains `waiting-review`.
   `--ui` opens the existing approval canvas.
3. Once review decisions exist, the command collects them and applies only
   approved source-catalogue changes.
4. It requires an empty, schema-v1-compatible handoff before entering the
   language stage.
5. Without `--llm`, it adopts the approved source edits through Language Loop
   and records `language-ready`, including pending translation counts for every
   selected language.
6. With `--llm`, it calls Language Loop's provider-backed
   `runTranslationLoop()` continuously across all selected keys and target
   languages. Partial batches are progress, never completion.
7. It records `complete` only after independently verifying every selected
   key/language pair has a source-current `approved` translation. An explicit
   human acceptance may satisfy a terminal item; missing, stale, pending,
   rework, or `needs-human` entries cannot.

`content status` reads state and reports both stages without mutating either
engine. `--restart` starts a new marketing run but never deletes engine history
or measurement state.

### Programmatic API

```ts
export interface ContentMarketingAdapter {
  start(input: ContentRunOptions): Promise<ContentMarketingSnapshot>;
  inspect(): Promise<ContentMarketingSnapshot>;
  collectAndApply(): Promise<ContentMarketingSnapshot>;
  openReview?(): Promise<void>;
}

export interface ContentLanguageAdapter {
  inspect(): Promise<ContentLanguageSnapshot>;
  run(input: {
    execute: boolean;
    keys: string[];
    locales: string[];
    onProgress?: (progress: ContentLanguageProgress[]) => void;
  }): Promise<ContentLanguageSnapshot>;
}

export function runContentLoop(input: RunContentLoopInput): Promise<ContentLoopResult>;
export function loadLanguageLoopAdapter(options: LanguageLoopAdapterOptions): Promise<ContentLanguageAdapter>;
```

The core orchestrator depends only on these interfaces. The CLI supplies the
real marketing adapter and dynamically loaded Language Loop adapter. Tests may
inject deterministic adapters without filesystem or provider dependencies.

## Durable state

`.marketing-loop/content-loop.json` is not rotated with per-run marketing
artefacts.

```ts
interface ContentLoopState {
  schemaVersion: 1;
  phase:
    | 'marketing'
    | 'waiting-review'
    | 'language-ready'
    | 'language'
    | 'complete'
    | 'needs-human'
    | 'blocked';
  contentRunId: string;
  marketingRunId?: string;
  startedAt: string;
  updatedAt: string;
  filter: ContentFilter;
  selectedKeys: string[];
  selectedLocales: string[];
  marketing: {
    proposals: number;
    pending: number;
    approved: number;
    rejected: number;
    applied: number;
    failed: number;
  };
  language?: {
    compatible: boolean;
    adoptedSourceKeys: string[];
    pending: number;
    applied: number;
    needsHuman: number;
    marketingBlocked: number;
    status: string;
    progress: Array<{
      locale: string;
      total: number;
      accepted: number;
      pending: number;
      rework: number;
      needsHuman: number;
      activeBatch?: number;
    }>;
  };
  error?: string;
}
```

Writes are atomic. State is a status projection, not authorization: marketing
apply still requires the digest-bound decision ledger, and Language Loop still
validates the handoff and its own memory before translating.

## Message selection

The Content Loop filter is an extensible, include-only model:

```ts
interface ContentFilter {
  schemaVersion: 1;
  types: Array<'cta' | 'headline' | 'button' | 'navigation' | 'label' | string>;
  groups: string[];
  keys: string[];
}
```

- Empty arrays mean the complete configured source catalogue.
- Values within one field are ORed.
- Non-empty fields are ANDed with each other. For example, types
  `cta,headline` plus group `hero` selects hero CTAs and headlines.
- `keys` are exact canonical catalogue keys.
- `groups` match complete canonical key segments/prefixes, never raw text or
  file-name substrings.
- Built-in type matching uses catalogue identity: `cta` matches CTA-kind
  items, `headline` matches headline-kind items, `button` matches canonical
  button/action/submit key tokens, `navigation` matches nav-kind items, and
  `label` matches label-kind items. Unknown types fail closed until a registered
  matcher exists.

The filter is resolved once against the active schema-v5 inventory. The
canonical `selectedKeys` list is persisted in Content Loop state and in an
optional backward-compatible `selection` block on the schema-v1 marketing
handoff:

```ts
selection?: {
  // Exact-key union filter consumed by Language Loop.
  filter: { categories: []; groups: []; keys: string[] };
  // Original normalized Marketing selectors retained for audit/status.
  requestedFilter: {
    categories: string[];
    groups: string[];
    keys: string[];
  };
  resolvedKeys: string[];
  targetLocales: string[];
}
```

The exact-key consumer filter preserves Marketing's cross-field intersection
semantics across Language Loop's union-based filter contract. Existing
schema-v1 consumers may ignore the additive selection block. Content Loop's
adapter passes the same resolved keys and locales to the Content-capable
language facade. Proposal generation, untrusted agent import, review, apply,
handoff entries, source-edit adoption, and translation all enforce that
resolved key set. A stale or forged proposal outside it is refused. Catalogue
entries outside it remain byte-identical.

## Language Loop adapter

The default loader resolves the installed `language-loop` package or an
explicit ESM module path. Language Loop 0.4.1's public orchestration facade is
the preferred integration:

- `CONTENT_LOOP_API_VERSION`
- `inspectLanguageLoop`
- `runLanguageLoop`
- public memory/config exports used to verify durable terminal truth
- provider registry and default translator/judge providers for `--llm`

The exported Content capability contract is:

```ts
export const CONTENT_LOOP_API_VERSION = 1;

interface LanguageLoopScopeInput {
  cwd: string;
  keys?: string[];
  locales?: string[];
}

inspectLanguageLoop(input: LanguageLoopScopeInput): LanguageLoopSnapshot;
runLanguageLoop(input: LanguageLoopScopeInput & {
  translator: RunnerTranslator;
  judge: RunnerJudge;
  onProgress?: (event: TranslationLoopProgressEvent) => void;
}): Promise<RunLanguageLoopResult>;
```

When `keys` is present, Language Loop must form work exclusively from those
canonical keys through every retry and batch. It may not synthesize, update, or
write an out-of-scope key. The adapter validates facade schema/API versions,
scope, lifecycle, and progress, then reloads durable Language memory before
accepting completion. It refuses filtered execution when the capability marker
is missing.

Before provider execution, the adapter calls `inspectLanguageLoop`. It refuses:

- missing or incompatible handoff schema
- catalogue scope mismatch
- canonical key-to-file mismatch
- source-hash mismatch
- unresolved `pending` or `approved` marketing keys
- legacy marketing state that the Language Loop consumer marks incompatible

The compatible dependency range is `language-loop >=0.4.1 <0.5.0`. Marketing
Loop declares that policy in package metadata and produces a direct,
actionable error when the module is absent or incompatible. Local and CI tests
may use `--language-module` or `LANGUAGE_LOOP_REPO` to load a built checkout.

## Marketing adapter and boundary

The real marketing adapter invokes the same internal command-path functions as
`propose`, review collection, and `apply`; it does not create another proposal
or apply implementation. Those functions retain the existing schema-v5 scope,
inventory, digest, exact-span, and decision checks.

The adapter exposes counts and run identity only. It never broadens catalogue
scope. Language Loop is loaded only after marketing has settled, so importing
the dependency cannot become marketing evidence.

The marketing proposal set binds the normalized filter and resolved keys.
Deterministic proposals are generated only from matching ranked items.
`importAgentOutput` refuses a copy ID outside that set, even though the complete
inventory remains available for digest and scope validation. Apply rechecks the
same condition before writing.

## Continuous all-language completion

The selected locale set comes from `--locales`; when omitted, it is every
configured target locale except the source locale. An empty resolved target set
is a configuration error.

Language Loop's runner may split work into any number of batches. Content Loop
keeps the same invocation active while the runner retries rejected candidates
and advances across locales. Translator and judge callbacks update the durable
per-language progress after each batch so `content status` can show accepted,
pending, rework, and terminal counts.

After the runner returns, the adapter reloads localization memory and verifies
every Cartesian pair of `selectedKeys × selectedLocales`:

- the translation exists
- its `sourceHash` equals the current source entry hash
- its status is `approved`, or `manual` following an explicit human decision

Only then may the phase become `complete`. A runner summary of `complete` with
any outstanding pair is a contract violation and becomes `blocked`. Allowed
pauses are limited to terminal judge exhaustion/explicit human ownership,
safety or configuration errors, provider rate/availability failures, or an
explicit user pause.

## Failure and resume behavior

- No review decision: `waiting-review`, no source write.
- All proposals rejected: marketing is settled; language may continue with no
  source change.
- Marketing apply refusal: `blocked` with failed count and report path.
- Non-empty handoff: `blocked`; translation is not called.
- Missing/incompatible Language Loop: `blocked` with install/version guidance.
- Provider-free language run: `language-ready`, no target write.
- A completed batch with another selected language outstanding remains
  `language`; it is never projected as complete.
- Language runner `needs-human` or `no-progress`: preserve per-language counts
  and the exact terminal reason for the next Content Loop invocation.
- Provider rate/availability errors: `blocked` with the affected language and
  retryable reason; accepted languages remain recorded.
- Re-running a terminal state is idempotent unless `--restart` is supplied.

## Testing

1. Pure orchestrator tests cover every state transition, review pause,
   idempotent resume, restart, and error projection with injected adapters.
   They prove a partial batch and a partially accepted locale set cannot
   produce `complete`.
2. CLI tests cover first-run proposal/review creation, status output, reviewed
   apply, and missing dependency guidance.
3. Adapter contract tests reject missing exports and incompatible handoffs.
4. A real integration test loads the built Language Loop checkout, applies one
   approved source-catalogue change, proves application code and the German
   catalogue remain byte-identical during marketing, adopts exactly the changed
   key, and executes Language Loop's runner with deterministic translator and
   judge callbacks until every configured target language is accepted.
5. Filtered end-to-end tests select CTA/headline/group/key combinations and
   prove only resolved keys reach proposals, review, handoff entries,
source-catalogue writes, source-edit adoption, and translation; all other
   source spans and decoded target values remain unchanged, and target files
   containing no selected keys remain byte-identical.
6. The complete Marketing Loop suite and package dry-run remain release gates.

## Migration and release

The old two-application sequence remains available as advanced engine commands,
but user documentation leads with:

```bash
npx marketing-loop content --ui
# approve or reject marketing proposals
npx marketing-loop content --llm
```

Release Language Loop 0.4 first, then Marketing Loop with the declared compatible
range. Both contract fixtures and the real cross-loop test must pass with zero
skips before publishing. Existing schema-v4 marketing state must be regenerated
with Content Loop or `marketing-loop propose`; it is never migrated into an
authorization record.
