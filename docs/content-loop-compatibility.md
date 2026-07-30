# Content Loop compatibility and migration

Marketing Loop 0.5 is the primary user-facing Content Loop app. It orchestrates
its own catalogue-only marketing engine and imports Language Loop as a modular
translation dependency. It does not copy Language Loop code or invoke its CLI.

## Dependency policy

- Marketing-only commands (`scan`, `propose`, `review`, `apply`, `measure`) do
  not require Language Loop at runtime.
- `content` requires `language-loop >=0.4.1 <0.5.0` when it reaches the
  translation stage. The module is loaded dynamically, so proposal and human
  review can still start before that optional peer is installed.
- A local integration build can be selected with `--language-module
  /absolute/path/to/dist/index.js`, `LANGUAGE_LOOP_MODULE`, or
  `LANGUAGE_LOOP_REPO=/absolute/repo` (which resolves `dist/index.js`).
- Marketing Loop calls only Language Loop public exports. Provider credentials,
  retries, guardrails, judging, memory, and target writes remain Language Loop
  responsibilities.

## Stable handoff

The required Marketing handoff remains schema version 1:

```json
{
  "schemaVersion": 1,
  "marketingRunId": "...",
  "scopeDigest": "...",
  "messagesDir": "messages",
  "sourceLocale": "en",
  "layout": "single-file",
  "unresolved": []
}
```

Content Loop may add:

```json
{
  "selection": {
    "filter": {
      "categories": [],
      "groups": [],
      "keys": ["hero.primaryCta"]
    },
    "requestedFilter": {
      "categories": ["cta"],
      "groups": ["hero"],
      "keys": []
    },
    "resolvedKeys": ["hero.primaryCta"],
    "targetLocales": ["de", "fr"]
  }
}
```

This is additive: existing schema-v1 consumers may ignore `selection`.
`selection.filter` deliberately uses exact canonical keys because Language
Loop combines its filter fields as a union, while Marketing Loop intersects
different non-empty selector fields. `requestedFilter` preserves the user's
normalized selectors for audit/status, and `resolvedKeys` is the immutable
scope passed to translation.

## Required Language Loop Content API

A consumer that supports filtered runs must export:

```ts
export const CONTENT_LOOP_API_VERSION = 1;

interface LanguageLoopScopeInput {
  cwd: string;
  keys?: string[];
  locales?: string[];
}

inspectLanguageLoop(input: LanguageLoopScopeInput): LanguageLoopSnapshot;
runLanguageLoop(
  input: LanguageLoopScopeInput & {
    translator: RunnerTranslator;
    judge: RunnerJudge;
    onProgress?: (event: TranslationLoopProgressEvent) => void;
  },
): Promise<RunLanguageLoopResult>;
```

Marketing Loop prefers this facade from the package's public exports and
validates its schema/API version, selected keys, selected locales, lifecycle,
and per-locale progress. With `keys`, Language Loop must:

1. Build pending work from only those canonical keys.
2. Preserve the key restriction through every batch and judge retry.
3. Never update memory or source/target catalogue entries outside that set.
4. Continue across every supplied locale until each selected key/locale pair is
   current and `approved`/explicitly human-approved, or return an explicit
   terminal/retryable pause.
5. Never report `complete` with missing, stale, pending, rework, or
   `needs-human` selected entries.

Marketing Loop independently reloads Language memory and verifies that matrix.
It refuses filtered execution without capability version 1, because an older
JavaScript runner could silently ignore an unknown `keys` property. The package
policy starts at the published orchestration release, 0.4.1; the runtime marker
remains a defense-in-depth check.

## Lifecycle states

- `waiting-review`: marketing proposals exist and Content Loop is waiting for
  explicit human decisions.
- `language-ready`: marketing is settled, the handoff is compatible and empty,
  and translations have been inspected but providers were not invoked.
- `language`: provider-backed batches are running; durable state includes
  per-language progress.
- `needs-human`: bounded automated judge attempts were exhausted. A human must
  explicitly resolve the Language Loop item, then rerun `content --llm`.
- `blocked`: incompatible handoff/configuration/safety failure, or a retryable
  rate/availability pause. The error and retryability are recorded.
- `complete`: every selected key is accepted in every selected target locale.

## Migration checklist

1. Upgrade Marketing Loop to 0.5 and regenerate schema-v5 active marketing
   state with `marketing-loop propose` or `marketing-loop content --restart`.
2. Upgrade Language Loop to the published orchestration release, 0.4.1 or a
   later compatible 0.4 patch.
3. Verify that Language Loop exports `CONTENT_LOOP_API_VERSION = 1`,
   `inspectLanguageLoop`, and `runLanguageLoop`, and enforces the facade's
   exact `keys`/`locales` scope.
4. Keep `language-loop.config.json` authoritative for catalogue scope and
   configured target languages.
5. Replace separately operated marketing and language commands with
   `marketing-loop content`; keep underlying commands only for intentional
   staged automation.
6. Run `npm run test:content-integration` and the real
   `LANGUAGE_LOOP_REPO=... npm run test:cross-loop` gate before a coordinated
   release.
