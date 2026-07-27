# Publishing

Everything below runs on your machine. `npm publish` needs your credentials, so it cannot be done from anywhere else.

## Before the first publish

`marketing-loop` was free on the npm registry when this was written. Names get taken, so check again the moment before you go:

```bash
npm view marketing-loop
# "404 Not Found" means it is still yours to take
```

## First release

```bash
cd ~/GitStuff/marketing-loop

# 1. Clean build from scratch — never publish a stale dist/
rm -rf dist node_modules
npm install
npm test                    # builds, then runs 19 tests

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
