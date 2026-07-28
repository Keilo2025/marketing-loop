# Catalogue-only marketing loop and language-loop integration

**Status:** Approved design
**Date:** 2026-07-28
**Target release:** `marketing-loop` 0.5 and a compatible `language-loop` release

## Summary

`marketing-loop` will stop reading and rewriting application code. Its complete
copy boundary will be the source-language JSON catalogue owned by
`language-loop`, normally `messages/en.json` or `messages/en/*.json`.

The boundary will be enforced independently during scanning, agent-output
import, review, apply, and revert. It will be an allowlist derived from the
catalogue configuration, not a repository-wide scan narrowed by exclusions.

The two loops will exchange stable catalogue keys through an atomic handoff
manifest. `language-loop` will freeze only the exact keys with unresolved
marketing proposals. Raw text will no longer be used as identity.

## Problem

The current implementation violates the intended ownership boundary:

- The default `include` list contains `.`, which makes the scanner walk the
  repository.
- The extractor supports JavaScript, TypeScript, JSX, TSX, HTML, Vue, Svelte,
  Astro, Markdown, YAML, and other code or mixed-content formats.
- Product modelling reads dependencies, routes, feature directories,
  components, API files, README text, and pricing source files.
- Apply confines writes to the repository but not to a catalogue directory.
- Every locale catalogue is eligible, so marketing changes can be applied to
  translations that `language-loop` should own.
- `language-loop` identifies unresolved marketing work by raw source text.
  Repeated labels therefore freeze unrelated keys.
- `language-loop` currently treats rejected proposals as unresolved because it
  excludes only applied or independently approved proposal records.

The existing integration also teaches the wrong order. Once internationalized,
English copy lives in the source catalogue. The localization loop must extract
hardcoded text before the marketing loop evaluates or changes it.

## Goals

1. Make it impossible for `marketing-loop` commands to read application code as
   copy evidence or write application code.
2. Allow marketing changes only in the configured source-language JSON
   catalogue.
3. Prevent marketing changes to target-language catalogues.
4. Make scan and apply enforce the same independently resolved scope.
5. Integrate with `language-loop` using catalogue keys and source hashes.
6. Ensure rejected, blocked, failed, and applied proposals do not freeze
   translation.
7. Preserve the human approval gate and existing run, inventory, proposal, and
   decision digests.
8. Fail closed when active state predates the catalogue-only schema.
9. Keep standalone use possible with a safe `messages/en.json` default.

## Non-goals

- Extracting hardcoded strings from code. That remains `language-loop`'s job.
- Translating copy. `language-loop` owns target-language catalogues.
- Inferring product capabilities from implementation details.
- Supporting arbitrary content trees or source formats in the catalogue-only
  release.
- Automatically applying old schema-v4 proposals.
- Sharing runtime code between the two npm packages in this release.

## Approaches considered

### Configuration-only restriction

Setting `include` to `messages` would narrow normal scans but would not make the
boundary trustworthy. Product modelling would still read code, old state could
still target code, and apply would still accept any repository-relative file.
This approach is rejected.

### Catalogue boundary with a key-based handoff

Both loops resolve the same catalogue scope. Marketing state records canonical
catalogue keys, and a small manifest exposes only unresolved keys to
`language-loop`. Every write path revalidates the scope. This is the selected
approach.

### Merge marketing into language-loop

Merging the tools would remove the handshake but tightly couple copywriting and
localization workflows, complicate standalone marketing use, and create a much
larger migration. This approach is rejected.

## Ownership model

| Concern | Owner |
| --- | --- |
| Hardcoded UI-string discovery and code extraction | `language-loop` |
| Source-catalogue marketing diagnosis and rewriting | `marketing-loop` |
| Human marketing approval | `marketing-loop` |
| Source edit adoption and translation invalidation | `language-loop` |
| Translation, judging, and target-catalogue writes | `language-loop` |

The loops may read each other's configuration and handoff state. They may not
write each other's state files.

## Catalogue scope resolution

`marketing-loop` will introduce a single `resolveCatalogueScope(cwd, config)`
boundary used by every stage.

### With language-loop installed

When `language-loop.config.json` exists, these fields are authoritative:

- `messagesDir`
- `sourceLocale`
- `layout`

`marketing-loop` may carry matching standalone catalogue settings, but a
mismatch is an error. It will not silently override localization configuration.

### Standalone

Without `language-loop.config.json`, the marketing configuration may contain:

```json
{
  "catalogue": {
    "messagesDir": "messages",
    "sourceLocale": "en",
    "layout": "single-file"
  }
}
```

If the block is absent, the fallback is:

```json
{
  "messagesDir": "messages",
  "sourceLocale": "en",
  "layout": "single-file"
}
```

### Resolved targets

- `single-file` and `custom`:
  `<messagesDir>/<sourceLocale>.json`
- `namespaced`:
  every direct `.json` child of `<messagesDir>/<sourceLocale>/`

This matches `language-loop`'s existing catalogue reader. Namespaced canonical
keys use the file stem as the first namespace segment. For example,
`messages/en/hero.json` containing `{ "cta": { "start": "Start free" } }`
produces `hero.cta.start`.

The resolver rejects:

- absolute paths
- empty paths and locale identifiers
- `.` or `..` traversal segments
- paths outside the real repository root
- symbolic links in any path segment
- non-JSON source catalogues
- a missing single-file catalogue
- a missing or empty namespaced source directory
- layouts not understood by the installed `language-loop` version

The old marketing `include` and `protectedFiles` fields are accepted for one
migration release, ignored for scope decisions, and reported as deprecated.
They cannot widen the catalogue boundary.

## Catalogue extraction

The generic markup and code extractor will be replaced in the command path by a
JSON catalogue extractor.

Each string entry will record:

- canonical catalogue key
- repository-relative catalogue file
- JSON property path
- normalized review text
- exact raw JSON string span
- complete file hash
- copy kind
- product surface
- source locale

Only string leaves are copy candidates. Objects establish key hierarchy.
Numbers, booleans, arrays, and null values are ignored and reported in scan
statistics when useful.

Duplicate text remains separate when the canonical keys differ.

### Classification

Classification will use the canonical key and namespace instead of component
markup:

- `headline`, `heading`, `hero.title` → headline
- `subhead`, `subtitle`, `tagline`, `description` → subhead or body
- `cta`, `button`, `submit`, `action` → CTA
- `error`, `invalid`, `failed` → error
- `empty`, `zeroState`, `noResults` → empty state
- `price`, `pricing`, `plan`, `tier` → pricing
- `label`, `placeholder`, `hint`, `help`, `tooltip` → label

Surface inference will likewise use key and namespace tokens:

- `landing`, `marketing`, `home`, `hero`, `pricing`, `signup`, `onboarding`
  → landing
- `email`, `mail`, `newsletter` → email
- `store`, `appStore`, `playStore` → store
- `legal`, `terms`, `privacy`, `cookie`, `refund` → legal
- all other catalogue keys → app

Legal entries remain out of scope unless a future explicit legal workflow is
designed. A generic message file no longer hides the surface information because
the key provides it.

## Text-only product context

The code-derived `ProductModel` command path will be replaced with a
catalogue-derived context.

Allowed inputs are:

- source catalogue keys and values
- `marketing-loop.config.json`
- `allowedClaims`
- voice and audience configuration
- `marketing-data/` CSV, JSON, TSV, and notes

Disallowed inputs are:

- source files
- dependencies and package metadata
- README files
- routes and component names
- API paths
- target-language catalogues

The brief will stop saying that facts may come from code. Claims must be present
in `allowedClaims`, source catalogue text, or marketing evidence. When a useful
claim is absent, the agent must return `NEEDS-FACT:` evidence rather than inspect
implementation files.

## State schema

The catalogue-only release will use marketing state schema version 5.

Schema-v5 inventory and proposals bind every change to:

- catalogue scope digest
- source locale
- canonical catalogue key
- source file
- complete file hash
- exact JSON span
- source text
- run ID and inventory digest

Agent output still identifies a target only by the inventory item ID. Import
reconstructs file, key, locale, source text, status, and author from the active
inventory. Model-provided target fields remain untrusted.

Schema-v4 active state may contain code paths. Review and apply will reject it
with an instruction to run `marketing-loop propose` again. It will never be
silently migrated or applied.

## Apply and revert safety

Apply will:

1. resolve the current catalogue scope independently
2. validate the inventory and decision digests
3. verify every approved item belongs to that scope and source locale
4. verify the complete source file hash and exact JSON span
5. encode the replacement as a JSON string
6. parse every updated file before the first write
7. back up the complete batch
8. atomically write the batch or roll it back

Only the JSON-string encoder remains in the apply command path. JavaScript,
HTML, Markdown, YAML, and generic plain-text replacement support becomes dead
code and will be removed as part of this change.

Revert will restore only files recorded in a schema-v5 catalogue backup
manifest. It will revalidate that every destination still belongs to the
currently configured source catalogue before restoring.

## Handoff manifest

`marketing-loop` will atomically maintain
`.marketing-loop/handoff.json`:

```json
{
  "schemaVersion": 1,
  "marketingRunId": "run-id",
  "scopeDigest": "sha256",
  "messagesDir": "messages",
  "sourceLocale": "en",
  "layout": "single-file",
  "unresolved": [
    {
      "key": "hero.startFree",
      "file": "messages/en.json",
      "sourceHash": "sha256",
      "status": "pending"
    }
  ]
}
```

The manifest contains only `pending` and approved-but-not-applied proposals.
Rejected, guardrail-blocked, failed, and applied proposals are absent.

A single handoff writer derives the manifest after:

- propose
- agent-output import
- markdown review collection
- each canvas decision
- apply
- creation of a new active run

New-run rotation archives the previous handoff with the rest of that run and
installs the new manifest atomically.

## language-loop behavior

`language-loop` will validate the handoff against its own `messagesDir`,
`sourceLocale`, and `layout`.

For each unresolved entry:

- the canonical key must exist in localization memory
- the memory source hash must equal the handoff source hash
- the handoff file must be the file `language-loop` maps that key to

Any mismatch means the marketing run is stale or incompatible. Translation
stops with a command telling the user to regenerate marketing proposals. It
does not fall back to raw-text matching.

Pending marketing keys are filtered from translation work by `work.key`.
Unrelated keys with identical source text remain eligible.

The marketing check is removed from `language-loop extract`. Marketing cannot
have catalogue proposals until extraction has created the source catalogue.
The check remains in translate, autonomous run, status, audit, and
`sync-marketing`, where catalogue work already has stable keys.

If marketing-loop is installed but has:

- no run: translation proceeds
- a valid empty handoff: translation proceeds
- a valid non-empty handoff: exact unresolved keys are skipped
- schema-v4 pending state: translation stops and requests a new marketing run
- missing or malformed handoff alongside schema-v5 active state: translation
  stops and requests repair or regeneration

## Lifecycle

The supported order is:

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

Projects whose code already uses catalogue keys begin at `marketing-loop
propose`.

After marketing apply, `language-loop` adopts source-catalogue edits and marks
translations stale using its existing source hashes. Only changed keys are
translated again.

Rejecting a marketing proposal immediately removes its key from the handoff.
The existing source text may then be translated.

## CLI and documentation changes

Marketing CLI language changes from “reads your code” and “writes approved
changes to your code” to “reads your source messages” and “writes approved
changes to the source catalogue.”

`marketing-loop init` will:

1. detect `language-loop.config.json`
2. show the resolved source catalogue
3. refuse a configuration mismatch
4. fall back to `messages/en.json` only when language-loop is absent

`marketing-loop scan` prints the exact source catalogue files it inspected.
`status` prints the resolved scope and the count of unresolved handoff keys.

Installed skills, commands, agent rules, README examples, API documentation,
and package descriptions will use the corrected lifecycle and ownership model.

`language-loop sync-marketing` will report:

- handoff schema compatibility
- scope agreement
- unresolved keys
- stale key or hash mismatches
- the correct next command

## Error handling

Errors are actionable and fail before writes:

- `Source catalogue messages/en.json does not exist. Run language-loop extract first.`
- `marketing-loop and language-loop disagree on messagesDir.`
- `Active marketing state is schema v4 and may target code. Run marketing-loop propose to regenerate it.`
- `Marketing handoff key hero.startFree no longer matches the source catalogue. Run marketing-loop propose again.`
- `Approved target src/app/page.tsx is outside the source catalogue. No files were changed.`

A batch with one invalid target writes nothing.

## Migration

1. Release `marketing-loop` with schema v5, the catalogue resolver, and the
   handoff manifest.
2. Release `language-loop` support for handoff schema 1.
3. Update both install-time agent instructions to use the corrected lifecycle.
4. Existing schema-v4 state remains archived but cannot be reviewed or applied.
5. The first `marketing-loop propose` under the new version regenerates the
   active inventory and proposals from the source catalogue.
6. Old `include` and `protectedFiles` configuration is warned about but cannot
   widen scope.

The release notes must call out that source-code marketing scans have been
removed intentionally.

## Test strategy

### marketing-loop

Tests will prove:

- a repository containing persuasive strings in TSX scans only
  `messages/<sourceLocale>.json`
- a configured target locale is never scanned
- single-file, namespaced, and custom catalogue paths resolve correctly
- canonical keys match `language-loop`'s flattening rules
- key-based kind and surface inference is deterministic
- source code, README, and package metadata cannot appear in the brief
- traversal, absolute paths, symlinks, missing catalogues, and unsupported
  layouts fail closed
- agent output cannot forge a code target
- an inventory item altered to point at code fails apply
- schema-v4 state cannot authorize review or apply
- JSON escaping and multi-entry atomic writes remain correct
- revert cannot restore outside the resolved source catalogue
- handoff contents follow every proposal and decision state transition

### language-loop

Tests will prove:

- only the exact unresolved key is frozen when two keys share source text
- rejected, blocked, failed, and applied proposals do not freeze keys
- scope and source-hash mismatches stop translation
- schema-v4 marketing state produces an actionable regeneration error
- extract no longer uses marketing text freezes
- source-catalogue marketing edits mark only affected translations stale
- single-file and namespaced key-to-file validation agree with catalogue reads

### Cross-loop fixture

An end-to-end fixture will:

1. extract two code strings into the English catalogue
2. create and approve one marketing rewrite
3. apply it only to the English catalogue
4. confirm application code is byte-for-byte unchanged after marketing apply
5. confirm target catalogues are byte-for-byte unchanged after marketing apply
6. confirm language-loop marks only that key stale
7. translate and apply the changed key
8. confirm no unresolved handoff entries remain

Both complete test suites, builds, and package dry-runs must pass before
release. The canvas network test must run in an environment allowed to bind a
loopback port.

## Implementation repositories

The marketing changes belong in:

`/Users/christianbuchholz/GitStuff/marketing-loop`

The key-based consumer and lifecycle changes belong in:

`/Users/christianbuchholz/GitStuff/language-loop`

Implementation requires write access to both repositories. The changes should
be developed as coordinated releases, with the marketing producer remaining
safe when the language consumer is absent.
