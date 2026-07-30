# marketing-loop

`marketing-loop` is the primary app for one human-approved **Content Loop**:
marketing copy first, translation second. Its marketing engine diagnoses and
proposes changes only in the configured source catalogue; it never reads or
changes application code or target locales. Its language stage reuses the
installed Language Loop engine through a strict adapter.

## Run the unified Content Loop

Language Loop must have already extracted application strings and configured
the target languages. Then use one resumable command:

```bash
npx marketing-loop content plan
npx marketing-loop content --ui
# approve or reject the marketing proposals
npx marketing-loop content
npx marketing-loop content --llm
npx marketing-loop content status
```

The first run proposes source-copy changes and pauses for mandatory human
review. The next run applies only approved source messages and validates the
schema-v1 handoff. Without `--llm`, it stops at `language-ready`. With `--llm`,
it invokes Language Loop continuously until its independent judge accepts every
selected key in every selected target language.

Partial batches never count as completion. Status shows accepted, pending,
rework, and human-needed counts per language. Provider rate/availability
problems are resumable; a safety/configuration error or exhausted judge attempts
pause with an explicit reason.

### Select only the messages you mean

The same canonical selection binds marketing proposals, review decisions,
source apply, handoff, and translation:

```bash
# Built-in content types: cta, headline, button, navigation, label
npx marketing-loop content --types cta,headline --groups hero,pricing
npx marketing-loop content --keys hero.primaryCta,nav.signup --locales de,fr
```

`--groups` and its `--categories` alias match complete canonical key segments
or prefixes. `--keys` uses exact canonical catalogue keys. Values inside one
flag are ORed; different non-empty filter fields are ANDed. An empty filter
selects the complete source catalogue. Unknown content types, missing keys,
unconfigured languages, and empty matches fail closed.

The normalized filter, resolved keys, and target languages are persisted in
`.marketing-loop/content-loop.json` and the additive `handoff.selection`
block. Change an active selection only with `--restart`. Entries outside the
resolved keys cannot enter proposal/import/apply and are never passed to
translation.

## Use it standalone

Configure a source catalogue in `marketing-loop.config.json` (or use the default `messages/en.json`), then run:

```bash
npx marketing-loop init
npx marketing-loop scan
npx marketing-loop propose
npx marketing-loop review --ui
npx marketing-loop apply
```

`scan` lists every inspected source file. `status` reports the source locale, catalogue directory, layout, and unresolved handoff count. `apply` changes only human-approved source messages; `revert` restores the last source-catalogue apply.

## Use it with language-loop

`content` is now the preferred user-facing workflow. The low-level modular
commands remain available for automation and migration:

```bash
language-loop scan
language-loop extract
marketing-loop propose
marketing-loop review
marketing-loop apply
language-loop translate
language-loop judge
language-loop apply
```

`language-loop extract` moves hardcoded text into the source catalogue before marketing work. Once marketing edits are approved, translations are stale. Run `language-loop translate` only after marketing decisions have settled. Marketing-loop never rewrites target locales or application code.

The unified Content Loop requires `marketing-loop` 0.5+ and
`language-loop` 0.4.1+. Upgrade both together. Language Loop 0.4.1 provides
the schema-v1 handoff consumer and filtered orchestration API; pre-0.4.1
releases are outside the supported Content dependency range.

The producer contract is pinned at [`tests/contracts/marketing-handoff-v1.json`](tests/contracts/marketing-handoff-v1.json). A compatible consumer must validate schema version 1, the catalogue scope fields, canonical key, source-catalogue file, full SHA-256 source hash, and `pending`/`approved` status. It must freeze only those exact unresolved keys.

Filtered Content execution additionally requires the Language Loop public
capability:

```ts
export const CONTENT_LOOP_API_VERSION = 1;

interface RunLanguageLoopInput {
  cwd: string;
  keys?: string[];
  locales?: string[];
  translator: RunnerTranslator;
  judge: RunnerJudge;
}

inspectLanguageLoop(input: InspectLanguageLoopInput): LanguageLoopSnapshot;
runLanguageLoop(input: RunLanguageLoopInput): Promise<RunLanguageLoopResult>;
```

Marketing Loop prefers this published orchestration facade from Language
Loop's public exports. When `keys` is present, the consumer must restrict every
batch, retry, judge decision, memory update, and target-catalogue write to those
exact keys. The adapter still fails closed if the capability marker is missing,
even though the package peer policy excludes pre-orchestration releases.

See [`docs/content-loop-compatibility.md`](docs/content-loop-compatibility.md)
for the lifecycle/API contract, dependency policy, and migration checklist.

## Workflow

`propose` creates `.marketing-loop/brief.md` and candidate rewrites. Use only source-catalogue text, `marketing-data/`, `allowedClaims`, and the brief when completing open items. An agent writes only `.marketing-loop/agent-output.json`; `import` validates it before the human review gate.

```bash
npx marketing-loop import
npx marketing-loop review --ui
npx marketing-loop apply
```

Every source edit is bound to the active catalogue inventory and a human approval decision. The apply step rejects stale, redirected, or forged targets and records a handoff containing only pending and approved source keys.

When rejecting a proposal, add a reason in the canvas or markdown `REASON` block. The decision ledger archives that explanation, and later `propose`/`brief` runs use it to avoid repeating the same rejected wording. Human edits are included in the same review history.

## Close the measurement loop

Record the baseline before rollout, bind the applied proposal as a variant, mark the real deployment, then compare the post-change metric:

```bash
npx marketing-loop measure baseline --subject hero.primaryCta --metric conversion_rate --value 3 --unit % --sample-size 1000 --source "GA4 signup funnel"
npx marketing-loop measure variant --baseline <baseline-id> --proposal <applied-proposal-id>
npx marketing-loop measure deploy --variant <variant-id> --environment production --marker git:abc123
npx marketing-loop measure result --variant <variant-id> --value 3.6 --sample-size 1100 --source "GA4 signup funnel" --minimum-uplift 5 --minimum-sample 500
npx marketing-loop measure status
```

Results are stored in `.marketing-loop/measurements.json` and survive run rotation. The recorded decision is `keep`, `revert`, or `inconclusive`; the sample and uplift thresholds are an explicit directional heuristic, not a statistical-significance test.

## Configuration

```json
{
  "catalogue": {
    "messagesDir": "messages",
    "sourceLocale": "en",
    "layout": "single-file"
  },
  "dataDir": "marketing-data",
  "benchmarks": {
    "conversion_rate": {
      "value": 2.8,
      "source": "GA4 signup funnel, trailing 28 days ending 2026-06-30"
    }
  },
  "audience": "",
  "allowedClaims": [],
  "surfaces": ["landing", "store", "email", "app"]
}
```

If `language-loop.config.json` exists, its `messagesDir`, `sourceLocale`, and `layout` are authoritative. Marketing-loop refuses a disagreement. Older `include` and `protectedFiles` settings are accepted for migration but ignored: source-catalogue scope is enforced.

Behavior benchmarks are optional and may be set independently for `conversion_rate`, `bounce_rate`, `scroll_depth`, and `dropoff`. Every override requires both a numeric `value` and a human-readable `source`; otherwise the config is refused. Unconfigured metrics use explicitly labelled marketing-loop heuristics.

## Migrating to 0.5

Version 0.5 is an intentional catalogue-only boundary change:

- Marketing-loop now scans and writes only source-locale JSON catalogues. Application source, package metadata, README content, and target locales are outside its copy scope.
- Active schema-v4 inventory, proposals, reviews, and decisions are refused because they may target application files. Run `marketing-loop propose` to archive the old run and regenerate schema-v5 state from the source catalogue.
- The old programmatic code-scanner exports `buildProductModel`, `extractFromFile`, and `SCANNABLE` were removed. Use `resolveCatalogueScope`, `scanRepo`, and `extractCatalogueFile`.
- Legacy `include` and `protectedFiles` configuration remains readable for one migration release but is ignored and cannot widen catalogue scope.
- Standalone use remains supported through the explicit `catalogue` block or the safe `messages/en.json` default; `language-loop` is not a runtime dependency.
- When `language-loop` is present, upgrade the tools as a coordinated optional lifecycle: extract first, settle and apply marketing decisions, then translate, judge, and apply locales. The atomic handoff freezes only unresolved canonical source keys.
- For one user-facing app, replace the separately operated marketing/translation sequence with `marketing-loop content`. Keep the old commands only where staged automation explicitly needs them.
- Install the published compatible `language-loop >=0.4.1 <0.5.0` peer for Content translation. The runtime `CONTENT_LOOP_API_VERSION = 1` check remains a defense-in-depth capability gate.
- Existing schema-v1 consumers may ignore the additive `selection` block. Content-capable consumers must honor the adapter's exact `keys` and `locales`.

## Install guidance for agents

```bash
npx marketing-loop install
```

The installed skill, commands, and agent guidance follow the same constraint: source catalogue only; no application-code or target-locale access. They document both the standalone workflow and the optional language-loop lifecycle above.

## Development

```bash
npm install
npm test
npm run test:content-integration
LANGUAGE_LOOP_REPO=/absolute/path/to/language-loop npm run test:cross-loop
npm pack --dry-run
```

MIT.
