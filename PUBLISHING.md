# Publishing

Everything below runs on your machine. `npm publish` needs your credentials, so it cannot be done from anywhere else.

## Before the first publish

`marketing-loop` was free on the npm registry when this was written. Names get taken, so check again the moment before you go:

```bash
npm view marketing-loop
# "404 Not Found" means it is still yours to take
```

## Coordinated 0.5 release

The key-based handshake requires `marketing-loop` 0.5+ and `language-loop` 0.4+. Upgrade and release both together; do not publish either side until the shared contract and cross-loop lifecycle pass.

Marketing Loop is the primary Content Loop app. `language-loop` remains a
dynamically loaded peer (`>=0.4.0 <0.5.0`), not copied code. A release that
advertises filtered Content runs must pair with a Language Loop build exporting
`CONTENT_LOOP_API_VERSION = 1` and enforcing `RunTranslationLoopInput.keys`
across pending work, retries, judge decisions, memory, and target writes.

Required order:

1. Run both full test suites and inspect both package dry-runs.
2. Run the cross-loop test with `LANGUAGE_LOOP_REPO` pointing at the compatible consumer checkout.
3. Publish `language-loop@0.4.0`.
4. Immediately publish `marketing-loop@0.5.0`.
5. Verify registry metadata and clean-install smoke tests for both packages.

```bash
cd /absolute/path/to/language-loop
npm test
npm pack --dry-run

cd /absolute/path/to/marketing-loop
npm test
npm run test:content-integration
npm pack --dry-run
LANGUAGE_LOOP_REPO=/absolute/path/to/language-loop npm run test:cross-loop
```

The cross-loop command must run one test with zero skips. It proves marketing leaves application code and target catalogues byte-for-byte unchanged, changes only the approved source key, empties the resolved handoff after apply, and lets `language-loop` mark only that key stale.

Do not publish without explicit human authorization, even when every gate passes.

### Rollback and mixed-version safety

- Never apply schema-v5 state with `marketing-loop` 0.4.
- Never translate unresolved schema-v4 marketing state with `language-loop` 0.4.
- After both compatible versions are installed, run `marketing-loop propose` again to regenerate active state and the handoff.
- If only one package was published, pause the coordinated release and do not advise users to mix versions.
- A missing Content API marker is safe only for an unfiltered all-catalogue run.
  Filtered Content execution must remain fail-closed.
- Do not call a Content run complete unless its persisted progress shows every
  selected key accepted for every selected locale.

## First release

```bash
cd ~/GitStuff/marketing-loop

# 1. Install and test — the build script removes stale dist/ output
npm install
npm test

# 2. Look at exactly what will ship
npm pack --dry-run

# 3. Log in (opens a browser)
npm login
npm whoami                  # confirm it is the account you meant

# 4. Ship it
npm publish
```

`prepublishOnly` runs the full test suite, so a broken build cannot reach the registry. `prepack` rebuilds `dist/` so the tarball always matches the source.

### Verify it landed

```bash
cd /tmp && mkdir smoke && cd smoke && npm init -y
npm i marketing-loop
npx marketing-loop version
npx marketing-loop install --list
```

## Subsequent releases

```bash
npm version patch    # or minor / major — writes package.json and tags git
git push && git push --tags
npm publish
```

Four places carry the version. A test now fails if they drift, so `npm version patch` still needs a manual follow-up in three files:

| file | field |
| --- | --- |
| `package.json` | `version` (npm version writes this one) |
| `.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` and `plugins[0].version` |
| `src/cli.ts` | `const VERSION` |

## The GitHub half

The npm package and the Claude Code plugin ship from the same repo, but only npm works without GitHub. The plugin marketplace resolves `keilo2000/marketing-loop` over GitHub, so that half needs a public repo:

```bash
git init
git add -A
git commit -m "marketing-loop 0.1.0"
git branch -M main
git remote add origin https://github.com/keilo2000/marketing-loop.git
git push -u origin main
```

Then anyone can install the plugin:

```
/plugin marketplace add keilo2000/marketing-loop
/plugin install marketing-loop@marketing-loop
```

## If you need to undo

```bash
npm unpublish marketing-loop@0.1.0    # only within 72 hours of publishing
npm deprecate marketing-loop@0.1.0 "use 0.1.1"   # the better option after that
```

Unpublishing burns the version number permanently — `0.1.0` can never be republished. Deprecating is almost always the right call.

## Worth doing before you announce it

- **Add a `LICENSE` year and name check.** It says 2026, Christian Buchholz. Correct if not.
- **Set `"private": false` is not needed** — the package is already public, and `publishConfig.access` is set explicitly so a future rename to a scoped name still publishes publicly.
- **Consider a 2FA requirement** on the npm account before the package has users. `npm profile enable-2fa auth-and-writes`.
