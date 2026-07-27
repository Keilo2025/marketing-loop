# marketing-loop

**A marketing copy loop for vibe-coding agents.** It reads your code, works out what the product actually solves, rewrites the copy to sell *that* instead of the feature — and ships nothing until a human approves it.

Works in Claude Code, Cursor, Codex, Windsurf, Cline, Copilot and everything else that reads `AGENTS.md`. Also works on its own, from the terminal, with no agent at all.

```bash
npx marketing-loop install    # wire it into every agent in this repo
npx marketing-loop init       # create the config
npx marketing-loop scan       # find and diagnose every user-facing string
npx marketing-loop propose    # rewrite what can be proven; brief the agent on the rest
npx marketing-loop review --ui  # a human approves, on a canvas
npx marketing-loop apply      # write only what they approved
```

---

## The problem it fixes

Ask any coding agent to write your landing page and you get this:

> **Advanced analytics dashboard with real-time sync**
> Our powerful platform empowers teams to leverage cutting-edge insights.
> `[ Get Started ]`

Every word is about the software. Nobody wakes up wanting a dashboard. They wake up not knowing whether last week was good or bad, and hating that feeling.

The agent wrote it that way because it was working from a feature list. It never read the code, so it had nothing concrete to say — and vague is the only place to go when you have no facts.

`marketing-loop` reads the implementation first:

> **Find out your deploy broke in 4 minutes, not after lunch**
> Watches every deploy across your pipeline and tells you the moment one fails.
> `[ Get my free deployment audit ]`

Same product. The difference is that every claim came out of a file.

---

## How it works

```
   your codebase                marketing-data/
        │                            │
        ▼                            ▼
   ┌─────────┐                 ┌──────────┐
   │  scan   │  strings +      │ behavior │  funnels, drop-off,
   │         │  product model  │          │  CTR, your own notes
   └────┬────┘                 └────┬─────┘
        └──────────┬────────────────┘
                   ▼
             ┌──────────┐
             │ diagnose │  15 rules · ranked by what a fix is worth
             └────┬─────┘
                  ▼
             ┌──────────┐        ┌───────────────┐
             │ propose  │───────▶│   brief.md    │──▶ your coding agent
             │ (engine) │        │  (open items) │    writes the hard ones
             └────┬─────┘        └───────┬───────┘
                  │◀─────────────────────┘
                  ▼
            ┌────────────┐
            │ guardrails │  dark patterns and invented facts stop here
            └─────┬──────┘
                  ▼
            ┌────────────┐
            │   HUMAN    │  canvas or markdown — approve, edit, reject
            └─────┬──────┘
                  ▼
            ┌────────────┐
            │   apply    │  exact-match replace · backup · one-command revert
            └────────────┘
```

### 1. It reads the code, not the README

`scan` builds a product model from what is actually there: routes, API surface, feature directories, dependencies, pricing tiers, integrations. Then it finds every user-facing string across JSX, TSX, HTML, Vue, Svelte, Astro, Markdown, MDX, JSON i18n bundles and YAML — and works out what each one *is*: a headline, a CTA, an empty state, an error, a meta description.

No AST. Vibe-coded repos do not always parse, and a parser that throws gives you nothing.

### 2. It diagnoses, then ranks

Fifteen rules, each pointed at a specific failure: `generic-cta`, `feature-not-benefit`, `company-centric`, `hype-vocabulary`, `no-problem-named`, `unhelpful-error`, `dead-empty-state`, and so on. Full list in [`skills/marketing-loop/references/diagnostics.md`](skills/marketing-loop/references/diagnostics.md).

Ranking is weighted by severity, by kind (a CTA beats a nav link), by surface (landing beats docs) — and heavily by whatever your behavioural data pointed at.

### 3. You feed it behaviour

Drop exports into `marketing-data/`. No API keys, no OAuth, no vendor lock-in.

```
marketing-data/
├── ga4-landing.csv        # any export with a label column and a metric column
├── posthog-funnel.csv     # ordered funnels get drop-off computed automatically
├── amplitude-events.json  # arrays, or { results: [...] }
└── notes.md               # "support gets three 'what does this do' emails a week"
```

Column names are matched loosely, so most exports work untouched. Filenames identify the source.

`notes.md` is the least sophisticated input here and often the most useful. One line per observation, and it lands in the brief verbatim.

### 4. It proposes — carefully

The deterministic engine only makes changes it can justify from text already in the repo. It rewrites generic CTAs by borrowing the deliverable from the heading above them, strips hype, flips company-first sentences to reader-first, splits overlong headlines.

**It will not invent a fact.** No user counts, no percentages, no guarantees. If a rewrite would need one, the string becomes an *open item* instead.

It is also careful about the small things that give machine-written copy away. Deleting "robust" from "a robust API" leaves "a API"; the engine fixes the article. Stripping "We help teams" from "We help teams monitor their deployments" leaves a dangling "their"; the engine refuses the rewrite and hands it to a model with judgement.

### 5. Your agent does the hard half

`propose` writes `.marketing-loop/brief.md`: the product model, the behavioural evidence, the voice constraints, the persuasion library, the open items, and the exact output schema.

**This is what makes it work inside a coding agent with no API key.** The CLI is the harness; your agent is the model. It reads the brief, opens the code behind each claim, writes rewrites into `proposals.json`.

Standalone? `--llm` uses `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` instead. The approval gate applies either way.

### 6. Guardrails run before a human sees anything

Blocked outright: fabricated urgency, fake scarcity, confirmshaming, hidden auto-renewal, decline options framed as mistakes, health and financial outcome promises.

Flagged for review: unverifiable social proof, unprovable superlatives, banned vocabulary, and **any number that appears in the new copy but not in the old copy or your `allowedClaims`**. That last one catches the failure mode every LLM copywriter has — a precise, plausible, entirely invented statistic.

### 7. A human approves. Always.

```bash
npx marketing-loop review --ui
```

A local page, `127.0.0.1`, no dependencies. Every proposal shows the current copy, the rewrite, alternatives, the reasoning, the psychology principles and the evidence. The rewrite box is editable — whatever you type wins. `j`/`k` to move, `a` to approve, `r` to reject.

Prefer not to open a browser?

```bash
npx marketing-loop review            # writes review.md with tick boxes
npx marketing-loop review --collect  # reads your ticks back
```

Works over SSH, in a PR diff, on a phone.

### 8. Apply is paranoid

Only approved proposals. `before` must still match the file exactly — if the file changed since the scan, it refuses rather than guesses. If the text appears twice and the line number does not disambiguate it, it refuses. Every touched file is backed up first.

```bash
npx marketing-loop apply --dry-run   # see it first
npx marketing-loop apply
npx marketing-loop revert            # undo the last run
```

Quote style is preserved, apostrophes escaped, braces handled in JSX text nodes.

---

## Install

### As an npm CLI

```bash
npx marketing-loop install     # no install needed, or:
npm i -g marketing-loop
```

`install` detects the agents already in your repo and writes their rules files. `--all` writes every one, `--list` shows the ids.

| agent | file |
| --- | --- |
| Codex, Cursor, Copilot, Gemini CLI, Aider, Amp, OpenCode, Zed, Windsurf, Jules | `AGENTS.md` |
| Claude Code | `CLAUDE.md` (or install the plugin — better) |
| Cursor | `.cursor/rules/marketing-loop.mdc` |
| Windsurf | `.windsurf/rules/marketing-loop.md` |
| Cline | `.clinerules/marketing-loop.md` |
| Roo Code | `.roo/rules/marketing-loop.md` |
| Kilo Code | `.kilocode/rules/marketing-loop.md` |
| GitHub Copilot | `.github/instructions/marketing-loop.instructions.md` |
| Gemini CLI | `GEMINI.md` |
| Continue | `.continue/rules/marketing-loop.md` |
| Junie (JetBrains) | `.junie/guidelines.md` |
| Trae | `.trae/rules/project_rules.md` |
| Zed | `.rules` |
| Aider | `CONVENTIONS.md` |
| OpenCode | `.opencode/marketing-loop.md` |

Everything is written between `<!-- marketing-loop:start -->` markers, so re-running updates in place and `npx marketing-loop uninstall` removes it cleanly.

### As a Claude Code plugin

```
/plugin marketplace add christianbuchholz/marketing-loop
/plugin install marketing-loop@marketing-loop
```

You get:

- **`/marketing-loop`** — run the whole loop, with the agent writing the hard rewrites
- **`/copy-audit`** — a report on what your copy is costing you, no changes made
- **`/copy-review`** — open the approval canvas
- **`marketing-loop` skill** — triggers automatically whenever you ask for copy
- **`copy-strategist` subagent** — a conversion copywriter that reads code before writing

---

## Configuration

`marketing-loop.config.json`:

```jsonc
{
  "dataDir": "marketing-data",
  "audience": "engineering teams shipping daily who have no idea when a deploy breaks",

  // Facts the copy is cleared to state. Anything else is off limits.
  "allowedClaims": [
    "Free tier, no card required",
    "Used by 40 engineering teams",
    "Detects failures in under 4 minutes"
  ],

  "voice": {
    "tone": "plain, confident, specific — no hype, no exclamation marks",
    "person": "second",
    "readingLevel": "grade 7",
    "banned": ["revolutionary", "seamless", "leverage", "unlock"],
    "required": []
  },

  "disabledPrinciples": ["scarcity-honest"],  // switch off techniques you never want used
  "protectedFiles": ["LICENSE", "CHANGELOG.md"],
  "maxProposals": 60
}
```

**`allowedClaims` is the important one.** It is the list of things the loop is permitted to assert. Leave it empty and the copy cannot make a single external claim — which is the correct default, and the reason this tool does not hallucinate testimonials.

---

## The persuasion library

26 documented principles, each with its mechanism, where it belongs, the honest application, the version that turns it into a dark pattern, and a source you can go read.

`outcome-framing` · `problem-agitate-solve` · `before-after-bridge` · `loss-aversion` · `specificity` · `social-proof` · `authority` · `risk-reversal` · `anchoring` · `decoy-effect` · `cognitive-fluency` · `curiosity-gap` · `goal-gradient` · `zeigarnik` · `commitment-consistency` · `reciprocity` · `labor-illusion` · `peak-end` · `hicks-law` · `von-restorff` · `status-quo-default` · `negativity-bias` · `endowment` · `fresh-start` · `scarcity-honest` · `unity`

Full reference: [`skills/marketing-loop/references/psychology.md`](skills/marketing-loop/references/psychology.md)

The abuse cases are written down on purpose — the guardrails use them. Every dark pattern in that list converts in the short run, and every one of them costs more than it earns once you count refunds, chargebacks, review scores and the people who never come back. That is a business argument, not a lecture.

---

## Programmatic use

```ts
import { scanRepo, analyse, propose, applyGuardrails, loadConfig } from 'marketing-loop';

const config = loadConfig(process.cwd());
const { items } = scanRepo(process.cwd(), config);
const findings = analyse(items, product, config);
const { kept, blocked } = applyGuardrails(proposals, config);
```

Every stage is exported, so the loop drops into CI, a git hook, or an MCP server. The approval gate is the one thing you should not automate away.

---

## FAQ

**Does it need an API key?**
No. Inside a coding agent, the agent is the model — it reads `brief.md`. The `--llm` flag exists for unattended runs.

**Will it edit my code without asking?**
No. `apply` only ever touches proposals a human marked approved, and `revert` undoes the last run.

**Does my code or data get uploaded?**
Not by default. Everything is local. With `--llm`, the brief — which includes aggregate figures from `marketing-data/` — goes to that API. Keep raw user-level exports out of the folder.

**It missed strings in my repo.**
The extractor is conservative on purpose; false positives waste more of your time than false negatives. Add directories to `include`, or move copy into a JSON or Markdown content file where it is unambiguous.

**Why is one string still flagged after I fixed it?**
The loop is meant to be run repeatedly. A headline that was too long *and* full of hype gets the hype removed on the first pass and the length flagged on the next. Run it again after applying.

**It suggested something that is not true about my product.**
That is a bug, and worth an issue. The engine cannot invent facts by construction; an agent or an API model can, which is exactly why the guardrails flag unsourced numbers and why a human sits between the proposal and the code.

---

## Development

```bash
npm install
npm run build
npm test          # 19 tests, no network
node dist/cli.js scan --cwd tests/fixture
```

MIT.
