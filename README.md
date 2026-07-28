# marketing-loop

`marketing-loop` is a human-approved marketing-copy producer for a configured source catalogue. It diagnoses and proposes changes only in the source catalogue; it never reads or changes application code or target locales.

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

When `language-loop` is available, it owns extraction and translation. Follow this lifecycle exactly:

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

## Workflow

`propose` creates `.marketing-loop/brief.md` and candidate rewrites. Use only source-catalogue text, `marketing-data/`, `allowedClaims`, and the brief when completing open items. An agent writes only `.marketing-loop/agent-output.json`; `import` validates it before the human review gate.

```bash
npx marketing-loop import
npx marketing-loop review --ui
npx marketing-loop apply
```

Every source edit is bound to the active catalogue inventory and a human approval decision. The apply step rejects stale, redirected, or forged targets and records a handoff containing only pending and approved source keys.

## Configuration

```json
{
  "catalogue": {
    "messagesDir": "messages",
    "sourceLocale": "en",
    "layout": "single-file"
  },
  "dataDir": "marketing-data",
  "audience": "",
  "allowedClaims": [],
  "surfaces": ["landing", "store", "email", "app"]
}
```

If `language-loop.config.json` exists, its `messagesDir`, `sourceLocale`, and `layout` are authoritative. Marketing-loop refuses a disagreement. Older `include` and `protectedFiles` settings are accepted for migration but ignored: source-catalogue scope is enforced.

## Migrating to 0.5

Version 0.5 is an intentional catalogue-only boundary change:

- Marketing-loop now scans and writes only source-locale JSON catalogues. Application source, package metadata, README content, and target locales are outside its copy scope.
- Active schema-v4 inventory, proposals, reviews, and decisions are refused because they may target application files. Run `marketing-loop propose` to archive the old run and regenerate schema-v5 state from the source catalogue.
- The old programmatic code-scanner exports `buildProductModel`, `extractFromFile`, and `SCANNABLE` were removed. Use `resolveCatalogueScope`, `scanRepo`, and `extractCatalogueFile`.
- Legacy `include` and `protectedFiles` configuration remains readable for one migration release but is ignored and cannot widen catalogue scope.
- Standalone use remains supported through the explicit `catalogue` block or the safe `messages/en.json` default; `language-loop` is not a runtime dependency.
- When `language-loop` is present, upgrade the tools as a coordinated optional lifecycle: extract first, settle and apply marketing decisions, then translate, judge, and apply locales. The atomic handoff freezes only unresolved canonical source keys.

## Install guidance for agents

```bash
npx marketing-loop install
```

The installed skill, commands, and agent guidance follow the same constraint: source catalogue only; no application-code or target-locale access. They document both the standalone workflow and the optional language-loop lifecycle above.

## Development

```bash
npm install
npm test
npm pack --dry-run
```

MIT.
