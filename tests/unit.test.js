import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyse, prioritise } from '../dist/core/analyse.js';
import { applyProposals } from '../dist/core/apply.js';
import { loadBehavior, parseDelimited } from '../dist/core/behavior.js';
import { extractFromFile, looksLikeCopy } from '../dist/core/extract.js';
import { applyGuardrails } from '../dist/core/guardrails.js';
import { AGENT_TARGETS, install, uninstall } from '../dist/core/install.js';
import { buildProductModel } from '../dist/core/product.js';
import { fixArticles, propose } from '../dist/core/propose.js';
import { PRINCIPLES } from '../dist/core/psychology.js';
import { applyDecisions, collectReview, renderReview } from '../dist/core/review.js';
import { scanRepo } from '../dist/core/scan.js';
import { defaultConfig } from '../dist/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixture');
const config = { ...defaultConfig, exclude: defaultConfig.exclude.filter((e) => !/^tests?$/.test(e)) };

/* ------------------------------------------------------------- extraction */

test('looksLikeCopy accepts sentences and rejects code', () => {
  assert.equal(looksLikeCopy('Stop losing six hours a week to manual reports'), true);
  assert.equal(looksLikeCopy('Get my audit'), true);

  assert.equal(looksLikeCopy('flex flex-col items-center gap-6 px-8'), false);
  assert.equal(looksLikeCopy('mx-auto max-w-4xl rounded-lg'), false);
  assert.equal(looksLikeCopy('onSubmitHandler'), false);
  assert.equal(looksLikeCopy('MAX_RETRY_COUNT'), false);
  assert.equal(looksLikeCopy('https://example.com/path'), false);
  assert.equal(looksLikeCopy('./components/Button'), false);
  assert.equal(looksLikeCopy('user-profile-card'), false);
  assert.equal(looksLikeCopy('logo.svg'), false);
});

test('extracts headline, cta and meta from html', () => {
  const html = fs.readFileSync(path.join(FIXTURE, 'index.html'), 'utf8');
  const items = extractFromFile('index.html', html);
  const texts = items.map((i) => i.text);

  assert.ok(texts.some((t) => t.startsWith('A powerful deployment monitoring dashboard')));
  assert.ok(items.some((i) => i.kind === 'headline'));
  assert.ok(items.some((i) => i.kind === 'cta' && i.text === 'Get Started'));
  assert.ok(items.some((i) => i.kind === 'meta' && i.text.includes('revolutionary')));

  // Class attributes must never be mistaken for copy.
  assert.equal(texts.some((t) => t.includes('flex flex-col')), false);
  assert.equal(texts.some((t) => t.includes('rounded-lg')), false);
});

test('extracts named copy constants from jsx', () => {
  const jsx = fs.readFileSync(path.join(FIXTURE, 'src/app/audit/page.jsx'), 'utf8');
  const items = extractFromFile('src/app/audit/page.jsx', jsx);
  const byText = new Map(items.map((i) => [i.text, i]));

  assert.ok(byText.has('No deployments found.'));
  assert.equal(byText.get('No deployments found.').kind, 'empty-state');
  assert.ok(byText.has('Something went wrong. Error code 500.'));
  assert.equal(byText.get('Something went wrong. Error code 500.').kind, 'error');
  assert.equal(byText.get('Submit').kind, 'cta');
});

/* ------------------------------------------------------------ product model */

test('infers stack, routes and integrations from the repo', () => {
  const product = buildProductModel(FIXTURE, config);

  assert.equal(product.name, 'deploywatch');
  assert.ok(product.stack.includes('Next.js'));
  assert.ok(product.stack.includes('Stripe billing'));
  assert.ok(product.integrations.includes('stripe'));
  assert.ok(product.routes.includes('/audit'));
  assert.ok(product.audienceHints.includes('engineering teams'));
});

/* ----------------------------------------------------------------- analysis */

test('diagnoses the usual copy failures', () => {
  const { items } = scanRepo(FIXTURE, config);
  const product = buildProductModel(FIXTURE, config);
  const findings = analyse(items, product, config);
  const rules = new Set(findings.map((f) => f.rule));

  assert.ok(rules.has('generic-cta'), 'flags Submit / Get Started');
  assert.ok(rules.has('company-centric'), 'flags "We help teams..."');
  assert.ok(rules.has('hype-vocabulary'), 'flags revolutionary / cutting-edge');
  assert.ok(rules.has('headline-too-long'), 'flags the 80-char hero headline');
  assert.ok(rules.has('unhelpful-error'), 'flags the error with no recovery path');
  assert.ok(rules.has('dead-empty-state'), 'flags "No deployments found."');
});

test('prioritisation puts ctas and headlines first', () => {
  const { items } = scanRepo(FIXTURE, config);
  const product = buildProductModel(FIXTURE, config);
  const findings = analyse(items, product, config);
  const ranked = prioritise(items, findings, []);

  assert.ok(ranked.length > 0);
  assert.ok(['cta', 'headline', 'meta', 'subhead'].includes(ranked[0].kind));
});

/* ----------------------------------------------------------------- behaviour */

test('parses a csv funnel and computes drop-off', () => {
  const csv = 'Step,Users\nA,1000\nB,400\nC,100\n';
  const { funnel } = parseDelimited(csv, 'generic-csv');

  assert.equal(funnel.length, 3);
  assert.equal(funnel[0].dropoff, 0);
  assert.equal(funnel[1].dropoff, 60);
  assert.equal(funnel[2].dropoff, 75);
});

test('reads the data directory and derives problems', () => {
  const { items } = scanRepo(FIXTURE, config);
  const report = loadBehavior(path.join(FIXTURE, 'marketing-data'), items);

  assert.ok(report.sourceFiles.length >= 3);
  assert.ok(report.funnel.length > 0);
  assert.ok(report.notes.some((n) => n.includes('what does this actually do')));
  assert.ok(report.problems.length > 0);
  assert.ok(report.problems.some((p) => p.severity === 'high'));
});

/* ----------------------------------------------------------------- proposals */

test('rewrites a generic cta using a deliverable from the same page', () => {
  const { items } = scanRepo(FIXTURE, config);
  const product = buildProductModel(FIXTURE, config);
  const findings = analyse(items, product, config);
  const ranked = prioritise(items, findings, []);
  const behavior = loadBehavior(path.join(FIXTURE, 'marketing-data'), items);

  const { proposals, openItems } = propose({ items, findings, product, behavior, config, ranked });

  const cta = proposals.find((p) => p.before === 'Submit' && p.file.endsWith('page.jsx'));
  assert.ok(cta, 'produced a proposal for the audit page Submit button');
  assert.equal(cta.after, 'Get my free deployment audit', 'borrowed the deliverable from the heading above it');
  assert.ok(cta.principles.includes('endowment'));
  assert.ok(cta.rationale.length > 60);
  assert.ok(cta.alternatives.length > 0, 'the human gets a real choice');

  // The same word on a different page is a different button, not a duplicate.
  const otherCta = proposals.find((p) => p.before === 'Submit' && p.file === 'index.html');
  assert.ok(otherCta, 'identical text in another file gets its own proposal');
  assert.notEqual(otherCta.after, cta.after, 'and its own deliverable');

  assert.ok(openItems.length > 0, 'leaves judgement calls to a model');
});

test('the engine never introduces a number that was not already there', () => {
  const { items } = scanRepo(FIXTURE, config);
  const product = buildProductModel(FIXTURE, config);
  const findings = analyse(items, product, config);
  const ranked = prioritise(items, findings, []);
  const behavior = loadBehavior(path.join(FIXTURE, 'marketing-data'), items);
  const { proposals } = propose({ items, findings, product, behavior, config, ranked });

  for (const p of proposals) {
    const newDigits = (p.after.match(/\d+/g) ?? []).filter((d) => !p.before.includes(d));
    assert.deepEqual(newDigits, [], `proposal ${p.id} invented a number: ${p.after}`);
  }
});

test('deleting an adjective does not strand the wrong article', () => {
  assert.equal(fixArticles('We provide a API'), 'We provide an API');
  assert.equal(fixArticles('an dashboard'), 'a dashboard');
  assert.equal(fixArticles('a hour'), 'an hour');
  assert.equal(fixArticles('an user'), 'a user');
  assert.equal(fixArticles('a URL'), 'a URL');
  assert.equal(fixArticles('A audit'), 'An audit');
  assert.equal(fixArticles('a unique report'), 'a unique report');
});

test('the company-flip refuses to orphan a pronoun', () => {
  const items = [{
    id: 'x', file: 'a.html', line: 1, text: 'We help teams monitor their deployments.',
    kind: 'subhead', surface: 'landing', context: [], length: 40,
  }];
  const product = { name: 't', stack: [], routes: [], features: [], audienceHints: [], pricingTiers: [], integrations: [], generatedAt: '' };
  const findings = [{ copyId: 'x', rule: 'company-centric', severity: 'high', message: '', suggests: [] }];
  const behavior = { signals: [], funnel: [], notes: [], problems: [], sourceFiles: [] };

  const { proposals, openItems } = propose({ items, findings, product, behavior, config, ranked: items });

  assert.equal(proposals.length, 0, '"Monitor their deployments" would leave a dangling "their"');
  assert.equal(openItems.length, 1, 'it becomes a job for a model with judgement');
});

/* ---------------------------------------------------------------- guardrails */

test('guardrails block dark patterns and flag unsourced numbers', () => {
  const base = {
    id: 'x', copyId: 'c', file: 'a.html', line: 1, kind: 'cta',
    before: 'Sign up', alternatives: [], rationale: '', problemSolved: '',
    principles: [], evidence: [], confidence: 0.9, status: 'pending', author: 'llm',
  };

  const { kept, blocked } = applyGuardrails(
    [
      { ...base, id: 'urgency', after: 'Offer ends tonight — last chance' },
      { ...base, id: 'shame', after: "No thanks, I don't want more customers" },
      { ...base, id: 'numbers', after: 'Join 12,000 teams shipping faster' },
      { ...base, id: 'clean', after: 'Get my audit' },
    ],
    config,
  );

  const blockedIds = blocked.map((b) => b.proposal.id);
  assert.ok(blockedIds.includes('urgency'));
  assert.ok(blockedIds.includes('shame'));

  const numbers = kept.find((p) => p.id === 'numbers');
  assert.ok(numbers.warnings.some((w) => w.includes('unverifiable-social-proof') || w.includes('unsourced-number')));

  const clean = kept.find((p) => p.id === 'clean');
  assert.equal(clean.warnings, undefined);
});

test('guardrails respect allowedClaims', () => {
  const vouched = { ...config, allowedClaims: ['Join 12,000 teams shipping faster'] };
  const { kept } = applyGuardrails(
    [{
      id: 'ok', copyId: 'c', file: 'a.html', line: 1, kind: 'cta',
      before: 'Sign up', after: 'Join 12,000 teams shipping faster', alternatives: [],
      rationale: '', problemSolved: '', principles: [], evidence: [],
      confidence: 0.9, status: 'pending', author: 'llm',
    }],
    vouched,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].warnings, undefined);
});

/* -------------------------------------------------------------------- review */

test('review markdown round-trips approvals and edits', () => {
  const set = {
    generatedAt: new Date().toISOString(),
    product: 'test',
    proposals: [
      { id: 'p1', copyId: 'c1', file: 'a.html', line: 3, kind: 'cta', before: 'Submit', after: 'Get my audit', alternatives: ['See my audit'], rationale: 'r', problemSolved: 'p', principles: ['endowment'], evidence: [], confidence: 0.8, status: 'pending', author: 'engine' },
      { id: 'p2', copyId: 'c2', file: 'a.html', line: 9, kind: 'headline', before: 'Old', after: 'New', alternatives: [], rationale: 'r', problemSolved: 'p', principles: [], evidence: [], confidence: 0.6, status: 'pending', author: 'engine' },
    ],
  };

  let md = renderReview(set);
  assert.ok(md.includes('marketing-loop:p1'));

  // Human approves p1 with an edit, leaves p2 untouched.
  md = md.replace('<!-- marketing-loop:p1 -->\n- [ ] APPROVE', '<!-- marketing-loop:p1 -->\n- [x] APPROVE');
  md = md.replace('```FINAL\nGet my audit\n```', '```FINAL\nRun my free audit\n```');

  const decisions = collectReview(md);
  const updated = applyDecisions(set, decisions);

  assert.equal(updated.proposals[0].status, 'approved');
  assert.equal(updated.proposals[0].edited, 'Run my free audit');
  assert.equal(updated.proposals[1].status, 'rejected');
});

/* --------------------------------------------------------------------- apply */

test('apply writes approved copy, backs up, and refuses stale matches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-'));
  const file = 'page.html';
  fs.writeFileSync(path.join(tmp, file), '<h1>Old headline</h1>\n<button>Submit</button>\n');

  const set = {
    generatedAt: new Date().toISOString(),
    product: 'test',
    proposals: [
      { id: 'ok', copyId: 'c1', file, line: 2, kind: 'cta', before: 'Submit', after: 'Get my audit', alternatives: [], rationale: '', problemSolved: '', principles: [], evidence: [], confidence: 0.8, status: 'approved', author: 'engine' },
      { id: 'stale', copyId: 'c2', file, line: 1, kind: 'headline', before: 'Text that is not there', after: 'Whatever', alternatives: [], rationale: '', problemSolved: '', principles: [], evidence: [], confidence: 0.8, status: 'approved', author: 'engine' },
      { id: 'skipped', copyId: 'c3', file, line: 1, kind: 'headline', before: 'Old headline', after: 'Never applied', alternatives: [], rationale: '', problemSolved: '', principles: [], evidence: [], confidence: 0.8, status: 'pending', author: 'engine' },
    ],
  };

  const backups = path.join(tmp, '.marketing-loop', 'backups');
  const results = applyProposals(set, { cwd: tmp, config, backupDir: backups });

  const written = fs.readFileSync(path.join(tmp, file), 'utf8');
  assert.ok(written.includes('Get my audit'));
  assert.ok(written.includes('Old headline'), 'pending proposals are never applied');

  assert.equal(results.find((r) => r.proposalId === 'ok').ok, true);
  assert.equal(results.find((r) => r.proposalId === 'stale').ok, false);
  assert.match(results.find((r) => r.proposalId === 'stale').reason, /not found/);
  assert.equal(results.some((r) => r.proposalId === 'skipped'), false);

  assert.ok(fs.existsSync(path.join(backups)), 'backup directory created');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('apply escapes quotes to match the surrounding literal', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-'));
  const file = 'x.js';
  fs.writeFileSync(path.join(tmp, file), "const cta = 'Submit';\n");

  const set = {
    generatedAt: '', product: 'test',
    proposals: [{
      id: 'q', copyId: 'c', file, line: 1, kind: 'cta',
      before: 'Submit', after: "Get my team's audit", alternatives: [],
      rationale: '', problemSolved: '', principles: [], evidence: [],
      confidence: 0.8, status: 'approved', author: 'engine',
    }],
  };

  applyProposals(set, { cwd: tmp, config, backupDir: path.join(tmp, 'bk') });
  assert.equal(fs.readFileSync(path.join(tmp, file), 'utf8'), "const cta = 'Get my team\\'s audit';\n");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dry run changes nothing on disk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-'));
  const file = 'page.html';
  const original = '<button>Submit</button>\n';
  fs.writeFileSync(path.join(tmp, file), original);

  const set = {
    generatedAt: '', product: 'test',
    proposals: [{
      id: 'd', copyId: 'c', file, line: 1, kind: 'cta', before: 'Submit', after: 'Get my audit',
      alternatives: [], rationale: '', problemSolved: '', principles: [], evidence: [],
      confidence: 0.8, status: 'approved', author: 'engine',
    }],
  };

  const results = applyProposals(set, { cwd: tmp, config, backupDir: path.join(tmp, 'bk'), dryRun: true });
  assert.equal(results[0].ok, true);
  assert.equal(fs.readFileSync(path.join(tmp, file), 'utf8'), original);
  assert.equal(set.proposals[0].status, 'approved', 'status is not marked applied on a dry run');

  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ install */

test('agents with a command directory get invokable slash commands, not just rules', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-install-'));
  const targets = AGENT_TARGETS.filter((t) => ['cursor', 'windsurf', 'cline'].includes(t.id));

  const results = install(tmp, targets);

  // The bug this covers: shipping only .cursor/rules means typing
  // "marketing-loop" in Cursor finds nothing, because a rule is not a command.
  for (const dir of ['.cursor/commands', '.windsurf/workflows', '.clinerules/workflows']) {
    for (const name of ['marketing-loop', 'copy-audit', 'copy-review']) {
      assert.ok(
        fs.existsSync(path.join(tmp, dir, `${name}.md`)),
        `missing ${dir}/${name}.md`,
      );
    }
  }

  assert.equal(results.filter((r) => r.command).length, 9);
  assert.equal(results.filter((r) => !r.command).length, 3, 'rules are still installed too');

  // Windsurf workflows need frontmatter; Cursor commands must not have it.
  const workflow = fs.readFileSync(path.join(tmp, '.windsurf/workflows/marketing-loop.md'), 'utf8');
  assert.match(workflow, /^---\ndescription: /);
  const cursorCommand = fs.readFileSync(path.join(tmp, '.cursor/commands/marketing-loop.md'), 'utf8');
  assert.equal(cursorCommand.startsWith('---'), false);

  // Re-running is a no-op.
  const second = install(tmp, targets);
  assert.equal(second.every((r) => r.action === 'unchanged'), true);

  // Uninstall takes the commands with it.
  uninstall(tmp, targets);
  assert.equal(fs.existsSync(path.join(tmp, '.cursor/commands/marketing-loop.md')), false);
  assert.equal(fs.existsSync(path.join(tmp, '.windsurf/workflows/copy-audit.md')), false);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('AGENTS.md section installs and strips cleanly around existing content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-agents-'));
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# My project\n\nExisting instructions.\n');
  const target = AGENT_TARGETS.filter((t) => t.id === 'agents-md');

  install(tmp, target);
  let content = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
  assert.ok(content.includes('Existing instructions.'), 'never clobbers what was there');
  assert.ok(content.includes('marketing-loop:start'));

  install(tmp, target);
  content = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
  assert.equal(content.match(/marketing-loop:start/g).length, 1, 'no duplicate blocks');

  uninstall(tmp, target);
  content = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
  assert.equal(content.includes('marketing-loop'), false);
  assert.ok(content.includes('Existing instructions.'));

  fs.rmSync(tmp, { recursive: true, force: true });
});

/* -------------------------------------------------------------- versioning */

test('every version number in the repo agrees', () => {
  const root = path.join(here, '..');
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

  const pkg = read('package.json');
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  const cli = fs.readFileSync(path.join(root, 'src/cli.ts'), 'utf8');
  const cliVersion = /const VERSION = '([^']+)'/.exec(cli)?.[1];

  // Four places, nothing that syncs them. This test is that thing.
  assert.equal(plugin.version, pkg.version, '.claude-plugin/plugin.json is behind package.json');
  assert.equal(market.metadata.version, pkg.version, 'marketplace metadata.version is behind');
  assert.equal(market.plugins[0].version, pkg.version, 'marketplace plugins[0].version is behind');
  assert.equal(cliVersion, pkg.version, 'src/cli.ts VERSION is behind');
});

/* ---------------------------------------------------------------- psychology */

test('every principle documents its own abuse case', () => {
  assert.ok(PRINCIPLES.length >= 20);
  for (const p of PRINCIPLES) {
    assert.ok(p.id && p.name && p.summary, `${p.id} is incomplete`);
    assert.ok(p.honestUse.length > 20, `${p.id} has no honest use`);
    assert.ok(p.abuse.length > 20, `${p.id} has no abuse case`);
    assert.ok(p.source.length > 5, `${p.id} has no source`);
    assert.ok(p.bestFor.length > 0, `${p.id} has no placement`);
  }
  const ids = PRINCIPLES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'principle ids are unique');
});
