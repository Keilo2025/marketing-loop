import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyse, prioritise, prioritiseDetailed } from '../dist/core/analyse.js';
import { applyProposals } from '../dist/core/apply.js';
import { loadBehavior, parseDelimited } from '../dist/core/behavior.js';
import { serveCanvas } from '../dist/core/canvas.js';
import { extractFromFile, inferSurface, looksLikeCopy } from '../dist/core/extract.js';
import { applyGuardrails } from '../dist/core/guardrails.js';
import { importAgentOutput, parseAgentOutput } from '../dist/core/ingest.js';
import { AGENT_TARGETS, install, uninstall } from '../dist/core/install.js';
import { buildProductModel } from '../dist/core/product.js';
import { buildMarketingContext } from '../dist/core/context.js';
import { fixArticles, propose } from '../dist/core/propose.js';
import { PRINCIPLES } from '../dist/core/psychology.js';
import { applyDecisions, collectReview, foldDecisions, renderReview } from '../dist/core/review.js';
import { linkSiblings, localeOf, siblingGroups } from '../dist/core/siblings.js';
import { scanRepo } from '../dist/core/scan.js';
import { resolveCatalogueScope } from '../dist/core/catalogue.js';
import {
  collectDecisionSet,
  proposalDigest,
  rotateActiveRun,
  validateDecisionSet,
} from '../dist/core/state.js';
import { defaultConfig, loadConfig } from '../dist/config.js';
import { hashText, readJsonStrict, walkDetailed, writeJson } from '../dist/util/fsx.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixture');
const config = { ...defaultConfig, exclude: defaultConfig.exclude.filter((e) => !/^tests?$/.test(e)) };

function contextForFixture(items) {
  return buildMarketingContext(resolveCatalogueScope(FIXTURE, config), items, config);
}

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
  const context = contextForFixture(items);
  const findings = analyse(items, context, config);
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
  const context = contextForFixture(items);
  const findings = analyse(items, context, config);
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
  const context = contextForFixture(items);
  const findings = analyse(items, context, config);
  const ranked = prioritise(items, findings, []);
  const behavior = loadBehavior(path.join(FIXTURE, 'marketing-data'), items);

  const { proposals, openItems } = propose({ items, findings, context, behavior, config, ranked });

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
  const context = contextForFixture(items);
  const findings = analyse(items, context, config);
  const ranked = prioritise(items, findings, []);
  const behavior = loadBehavior(path.join(FIXTURE, 'marketing-data'), items);
  const { proposals } = propose({ items, findings, context, behavior, config, ranked });

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
  const context = { sourceLocale: 'en', messagesDir: 'messages', layout: 'single-file', namespaces: [], audience: '', allowedClaims: [], generatedAt: '' };
  const findings = [{ copyId: 'x', rule: 'company-centric', severity: 'high', message: '', suggests: [] }];
  const behavior = { signals: [], funnel: [], notes: [], problems: [], sourceFiles: [] };

  const { proposals, openItems } = propose({ items, findings, context, behavior, config, ranked: items });

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
  assert.ok(blockedIds.includes('numbers'), 'an invented number is refused, not merely flagged');

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

test('legacy proposal status flags cannot authorize source writes', () => {
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

  const results = applyProposals(set, {
    cwd: tmp,
    config,
    backupDir: path.join(tmp, '.marketing-loop', 'backups'),
  });

  const written = fs.readFileSync(path.join(tmp, file), 'utf8');
  assert.ok(written.includes('Submit'));
  assert.ok(written.includes('Old headline'), 'pending proposals are never applied');
  assert.equal(results.find((r) => r.proposalId === 'ok').ok, false);
  assert.match(results.find((r) => r.proposalId === 'ok').reason, /schema v4/i);
  assert.equal(results.some((r) => r.proposalId === 'skipped'), false);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('apply escapes quotes to match the surrounding literal', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-'));
  const file = 'x.js';
  fs.writeFileSync(path.join(tmp, file), "const cta = 'Submit';\n");

  const state = secureApplyState(tmp, [{
    file,
    before: 'Submit',
    after: "Get my team's audit",
  }]);

  applyProposals(state.set, {
    cwd: tmp,
    config: state.applyConfig,
    backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory,
    decisions: state.decisions,
  });
  assert.equal(fs.readFileSync(path.join(tmp, file), 'utf8'), "const cta = 'Get my team\\'s audit';\n");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dry run changes nothing on disk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-'));
  const file = 'page.html';
  const original = '<button>Submit</button>\n';
  fs.writeFileSync(path.join(tmp, file), original);

  const state = secureApplyState(tmp, [{
    file,
    before: 'Submit',
    after: 'Get my audit',
  }]);

  const results = applyProposals(state.set, {
    cwd: tmp,
    config: state.applyConfig,
    backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory,
    decisions: state.decisions,
    dryRun: true,
  });
  assert.equal(results[0].ok, true, results[0].reason);
  assert.equal(fs.readFileSync(path.join(tmp, file), 'utf8'), original);
  assert.equal(state.set.proposals[0].status, 'pending', 'status is not marked applied on a dry run');

  fs.rmSync(tmp, { recursive: true, force: true });
});

function secureApplyState(tmp, changes, applyConfig = {
  ...config,
  include: ['.'],
  exclude: [],
  protectedFiles: [],
}) {
  const scan = scanRepo(tmp, applyConfig, 'run-apply');
  const inventory = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    repositoryRoot: tmp,
    filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy,
    truncated: scan.truncated,
    items: scan.items,
  };
  const proposals = changes.map((change, index) => {
    const item = scan.items.find((candidate) =>
      candidate.file === change.file && candidate.text === change.before
    );
    assert.ok(item, `missing inventory item for ${change.file}: ${change.before}`);
    return {
      id: `secure-${index}`, copyId: item.id, file: item.file, line: item.line,
      kind: item.kind, before: item.text, after: change.after, alternatives: [],
      rationale: 'Names the outcome.', problemSolved: 'The original was vague.',
      principles: [], evidence: [], confidence: 0.8, status: 'pending', author: 'engine',
    };
  });
  const set = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    product: 'test',
    proposals,
  };
  const decisions = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    decisions: proposals.map((proposal) => ({
      proposalId: proposal.id,
      proposalDigest: proposalDigest(proposal, proposal.after),
      decision: 'approved',
      finalText: proposal.after,
      source: 'markdown',
      decidedAt: new Date().toISOString(),
    })),
  };
  return { set, inventory, decisions, applyConfig };
}

test('secure apply uses the approval ledger, exact source span, and representation encoding', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-secure-'));
  const file = 'messages.json';
  fs.writeFileSync(path.join(tmp, file), '{"cta":"Get started today"}\n');
  const state = secureApplyState(tmp, [{
    file,
    before: 'Get started today',
    after: 'Get "my" audit\nnow',
  }]);

  const results = applyProposals(state.set, {
    cwd: tmp,
    config: state.applyConfig,
    backupDir: path.join(tmp, '.marketing-loop', 'backups'),
    inventory: state.inventory,
    decisions: state.decisions,
  });

  assert.equal(results[0].ok, true, results[0].reason);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(tmp, file), 'utf8')),
    { cta: 'Get "my" audit\nnow' },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('secure apply rejects traversal, protected files, and symlink targets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-confine-'));
  fs.writeFileSync(path.join(tmp, 'page.html'), '<button>Start my audit</button>\n');
  const state = secureApplyState(tmp, [{
    file: 'page.html',
    before: 'Start my audit',
    after: 'Run my audit',
  }]);

  const proposal = state.set.proposals[0];
  const item = state.inventory.items.find((candidate) => candidate.id === proposal.copyId);
  item.file = '../outside.html';
  proposal.file = '../outside.html';
  state.decisions.decisions[0].proposalDigest = proposalDigest(proposal, proposal.after);
  let results = applyProposals(state.set, {
    cwd: tmp, config: state.applyConfig, backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory, decisions: state.decisions,
  });
  assert.match(results[0].reason, /inside the repository|inventory digest/i);

  item.file = 'page.html';
  proposal.file = 'page.html';
  state.decisions.decisions[0].proposalDigest = proposalDigest(proposal, proposal.after);
  const protectedConfig = { ...state.applyConfig, protectedFiles: ['./page.html'] };
  results = applyProposals(state.set, {
    cwd: tmp, config: protectedConfig, backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory, decisions: state.decisions,
  });
  assert.match(results[0].reason, /protected/i);

  fs.renameSync(path.join(tmp, 'page.html'), path.join(tmp, 'real.html'));
  fs.symlinkSync('real.html', path.join(tmp, 'page.html'));
  results = applyProposals(state.set, {
    cwd: tmp, config: state.applyConfig, backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory, decisions: state.decisions,
  });
  assert.match(results[0].reason, /symbolic link/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('secure apply preflights the whole batch and writes nothing when one file is stale', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-atomic-'));
  fs.writeFileSync(path.join(tmp, 'a.html'), '<button>Start first audit</button>\n');
  fs.writeFileSync(path.join(tmp, 'b.html'), '<button>Start second audit</button>\n');
  const state = secureApplyState(tmp, [
    { file: 'a.html', before: 'Start first audit', after: 'Run first audit' },
    { file: 'b.html', before: 'Start second audit', after: 'Run second audit' },
  ]);
  fs.writeFileSync(path.join(tmp, 'b.html'), '<button>Changed after scan</button>\n');

  const results = applyProposals(state.set, {
    cwd: tmp, config: state.applyConfig, backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory, decisions: state.decisions,
  });

  assert.equal(results.some((result) => !result.ok), true);
  assert.equal(fs.readFileSync(path.join(tmp, 'a.html'), 'utf8'), '<button>Start first audit</button>\n');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('changing an approved proposal after review invalidates the entire apply batch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-forged-'));
  fs.writeFileSync(path.join(tmp, 'page.html'), '<button>Start my audit</button>\n');
  const state = secureApplyState(tmp, [{
    file: 'page.html',
    before: 'Start my audit',
    after: 'Run my audit',
  }]);
  state.set.proposals[0].after = 'Last chance — offer ends tonight';

  const results = applyProposals(state.set, {
    cwd: tmp, config: state.applyConfig, backupDir: path.join(tmp, 'bk'),
    inventory: state.inventory, decisions: state.decisions,
  });

  assert.match(results[0].reason, /digest/i);
  assert.equal(fs.readFileSync(path.join(tmp, 'page.html'), 'utf8'), '<button>Start my audit</button>\n');
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

/* ----------------------------------------------------------------- surfaces */

test('legal and internal paths are recognised before anything else', () => {
  assert.equal(inferSurface('legal/terms.md'), 'legal');
  assert.equal(inferSurface('app/(marketing)/privacy-policy/page.tsx'), 'legal');
  assert.equal(inferSurface('src/pages/cookie-policy.tsx'), 'legal');
  assert.equal(inferSurface('content/gdpr.mdx'), 'legal');
  // A legal page about pricing is still a legal page.
  assert.equal(inferSurface('legal/pricing-terms.md'), 'legal');

  assert.equal(inferSurface('.github/PULL_REQUEST_TEMPLATE.md'), 'internal');
  assert.equal(inferSurface('CHANGELOG.md'), 'internal');
  assert.equal(inferSurface('docs/adr/0001-use-postgres.md'), 'internal');

  assert.equal(inferSurface('docs/getting-started.md'), 'docs');
  assert.equal(inferSurface('src/app/(marketing)/page.tsx'), 'landing');
  assert.equal(inferSurface('src/app/dashboard/page.tsx'), 'app');
});

test('out-of-scope surfaces are counted and held back, not silently dropped', () => {
  const items = [
    { id: 'a', file: 'src/app/page.tsx', line: 1, text: 'Submit', kind: 'cta', surface: 'landing', context: [], length: 6 },
    { id: 'b', file: 'legal/terms.md', line: 1, text: 'Liability is limited by the provider.', kind: 'body', surface: 'legal', context: [], length: 36 },
    { id: 'c', file: 'docs/guide.md', line: 1, text: 'Configuration is handled by the wizard.', kind: 'body', surface: 'docs', context: [], length: 38 },
  ];
  const findings = items.map((i) => ({ copyId: i.id, rule: 'passive-voice', severity: 'low', message: '', suggests: [] }));

  const { ranked, outOfScope } = prioritiseDetailed(items, findings, []);

  assert.deepEqual(ranked.map((r) => r.id), ['a'], 'only the landing string is in scope');
  assert.equal(outOfScope.legal, 1);
  assert.equal(outOfScope.docs, 1);

  // Opting in is possible, because sometimes docs really are the funnel.
  const opted = prioritiseDetailed(items, findings, [], ['landing', 'docs']);
  assert.deepEqual(opted.ranked.map((r) => r.id).sort(), ['a', 'c']);
  assert.equal(opted.outOfScope.legal, 1);
});

test('the proposal cap covers open items too, and never starves them', () => {
  // 40 rewritable strings, all of which the engine could handle on its own.
  const items = Array.from({ length: 40 }, (_, i) => ({
    id: 'i' + i, file: `src/app/p${i}.tsx`, line: 1,
    text: `We provide a powerful platform for teams number ${i}.`,
    kind: 'subhead', surface: 'landing', context: [], length: 50,
  }));
  const findings = items.map((i) => ({ copyId: i.id, rule: 'hype-vocabulary', severity: 'high', message: '', suggests: [] }));
  const context = { sourceLocale: 'en', messagesDir: 'messages', layout: 'single-file', namespaces: [], audience: '', allowedClaims: [], generatedAt: '' };
  const behavior = { signals: [], funnel: [], notes: [], problems: [], sourceFiles: [] };

  const capped = { ...config, maxProposals: 10 };
  const { proposals, openItems } = propose({ items, findings, context, behavior, config: capped, ranked: items });

  assert.ok(proposals.length <= 6, `engine took ${proposals.length}, should cap at 60% of 10`);
  assert.ok(
    proposals.length + openItems.length <= capped.maxProposals,
    `total ${proposals.length + openItems.length} exceeds the cap of ${capped.maxProposals}`,
  );
});

/* ---------------------------------------------------------------- siblings */

function fakeProposal(id, file, over = {}) {
  return {
    id, copyId: 'c' + id, file, line: 189, kind: 'subhead',
    before: 'Enhance your experience with powerful extras',
    after: 'Enhance your experience with extras',
    alternatives: [], rationale: 'r', problemSolved: 'p', principles: [],
    evidence: [], confidence: 0.7, status: 'pending', author: 'engine', ...over,
  };
}

test('identical changes across files are linked, and locale bundles are called out', () => {
  const proposals = linkSiblings([
    fakeProposal('a', 'messages/en/marketing.json'),
    fakeProposal('b', 'messages/tr/marketing.json'),
    fakeProposal('c', 'messages/uk/marketing.json'),
    // Same string, different rewrite — not a sibling. Approving the group must
    // never drag in a change the human was not shown.
    fakeProposal('d', 'messages/de/marketing.json', { after: 'Add extras to your plan' }),
    fakeProposal('e', 'index.html', { before: 'Submit', after: 'Get my audit' }),
  ]);

  const [a, b, c, d, e] = proposals;
  assert.deepEqual(a.siblings.sort(), ['b', 'c']);
  assert.deepEqual(b.siblings.sort(), ['a', 'c']);
  assert.equal(d.siblings, undefined, 'a different rewrite is not a sibling');
  assert.equal(e.siblings, undefined, 'a different string is not a sibling');

  assert.match(a.localeWarning, /3 locales/);
  assert.match(a.localeWarning, /tr|uk/);
  assert.match(a.localeWarning, /re-translating/);

  const groups = siblingGroups(proposals);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
  assert.deepEqual(groups[0].locales.sort(), ['en', 'tr', 'uk']);
});

test('locale detection handles the shapes people actually use', () => {
  assert.equal(localeOf('messages/tr/marketing.json'), 'tr');
  assert.equal(localeOf('src/locales/pt-BR/common.json'), 'pt-BR');
  assert.equal(localeOf('public/i18n/de.json'), 'de');
  assert.equal(localeOf('app/translations/fr_CA/app.yaml'), 'fr_CA');
  assert.equal(localeOf('src/components/Hero.tsx'), null);
  assert.equal(localeOf('index.html'), null);
  // A two-letter directory that is not a locale directory must not match.
  assert.equal(localeOf('src/ui/button.tsx'), null);
});

test('a ticked fan-out carries the decision, but never overrides an explicit one', () => {
  const set = {
    generatedAt: '', product: 't',
    proposals: linkSiblings([
      fakeProposal('a', 'messages/en/m.json'),
      fakeProposal('b', 'messages/tr/m.json'),
      fakeProposal('c', 'messages/uk/m.json'),
    ]),
  };

  const { set: folded, fannedOut } = foldDecisions(set, [
    { proposalId: 'a', approved: true, finalText: 'Enhance your experience with extras', fanOut: true },
    // The human looked at the Ukrainian one and said no. That has to stand.
    { proposalId: 'c', approved: false },
  ]);

  const byId = Object.fromEntries(folded.proposals.map((p) => [p.id, p]));
  assert.equal(byId.a.status, 'approved');
  assert.equal(byId.b.status, 'approved', 'carried to the untouched sibling');
  assert.equal(byId.c.status, 'rejected', 'an explicit reject is not overwritten by a fan-out');
  assert.equal(fannedOut, 1);
});

test('without the fan-out tick, siblings are left alone', () => {
  const set = {
    generatedAt: '', product: 't',
    proposals: linkSiblings([
      fakeProposal('a', 'messages/en/m.json'),
      fakeProposal('b', 'messages/tr/m.json'),
    ]),
  };

  const { set: folded, fannedOut } = foldDecisions(set, [{ proposalId: 'a', approved: true }]);
  const byId = Object.fromEntries(folded.proposals.map((p) => [p.id, p]));

  assert.equal(byId.a.status, 'approved');
  assert.equal(byId.b.status, 'pending', 'one click must never change a file the human did not see');
  assert.equal(fannedOut, 0);
});

test('the review file round-trips the fan-out tick', () => {
  const set = {
    generatedAt: '', product: 't',
    proposals: linkSiblings([
      fakeProposal('aaa1', 'messages/en/m.json'),
      fakeProposal('bbb2', 'messages/tr/m.json'),
    ]),
  };

  let md = renderReview(set);
  assert.match(md, /SAME DECISION FOR ALL IDENTICAL COPIES \(1 other\)/);
  assert.match(md, /Translation\./, 'the locale warning reaches the markdown path too');

  md = md.replace('<!-- marketing-loop:aaa1 -->\n- [ ] APPROVE', '<!-- marketing-loop:aaa1 -->\n- [x] APPROVE')
         .replace('- [ ] SAME DECISION FOR ALL IDENTICAL COPIES', '- [x] SAME DECISION FOR ALL IDENTICAL COPIES');

  const decisions = collectReview(md);
  const lead = decisions.find((d) => d.proposalId === 'aaa1');
  assert.equal(lead.approved, true);
  assert.equal(lead.fanOut, true);

  const { fannedOut } = foldDecisions(set, decisions);
  assert.equal(fannedOut, 1);
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

/* ------------------------------------------------------------ state safety */

test('strict JSON reads explain malformed state instead of silently falling back', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-state-'));
  const file = path.join(tmp, 'broken.json');
  fs.writeFileSync(file, '{"runId":');

  assert.throws(() => readJsonStrict(file), /Invalid JSON.*broken\.json/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('state writes are atomic and content hashes are stable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-state-'));
  const file = path.join(tmp, 'state.json');

  writeJson(file, { runId: 'run-1' });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { runId: 'run-1' });
  assert.equal(fs.readdirSync(tmp).some((name) => name.includes('.tmp-')), false);
  assert.equal(hashText('same'), hashText('same'));
  assert.notEqual(hashText('same'), hashText('different'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('starting a new scan archives and clears stale run artefacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-rotate-'));
  writeJson(path.join(tmp, 'inventory.json'), { schemaVersion: 4, runId: 'old-run' });
  writeJson(path.join(tmp, 'agent-output.json'), { runId: 'old-run' });
  fs.writeFileSync(path.join(tmp, 'review.md'), 'old review');

  const archived = rotateActiveRun(tmp);

  assert.equal(archived, path.join(tmp, 'history', 'old-run'));
  assert.equal(fs.existsSync(path.join(tmp, 'agent-output.json')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'review.md')), false);
  assert.deepEqual(
    readJsonStrict(path.join(tmp, 'history', 'old-run', 'agent-output.json')),
    { runId: 'old-run' },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('invalid config fails closed with the field name', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-config-'));
  fs.writeFileSync(path.join(tmp, 'marketing-loop.config.json'), '{"include":"src"}\n');

  assert.throws(() => loadConfig(tmp), /include.*array/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('empty configured claims cannot bypass factual guardrails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-config-'));
  fs.writeFileSync(
    path.join(tmp, 'marketing-loop.config.json'),
    '{"allowedClaims":["!!!"]}\n',
  );

  assert.throws(() => loadConfig(tmp), /allowedClaims.*non-empty/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('inventory preserves normalized text and exact multiline source', () => {
  const source = '<h1>Hello\n    world &amp; friends</h1>';
  const [item] = extractFromFile('page.html', source);

  assert.equal(item.text, 'Hello world & friends');
  assert.equal(item.source.raw, 'Hello\n    world &amp; friends');
  assert.equal(source.slice(item.source.start, item.source.end), item.source.raw);
  assert.equal(item.source.representation, 'html-text');
});

test('JavaScript string inventory keeps escapes in the span but decodes review text', () => {
  const source = "const cta = 'Get your team\\'s deployment audit';\n";
  const item = extractFromFile('copy.js', source).find((candidate) => candidate.kind === 'cta');

  assert.ok(item);
  assert.equal(item.text, "Get your team's deployment audit");
  assert.equal(item.source.raw, "Get your team\\'s deployment audit");
  assert.equal(source.slice(item.source.start, item.source.end), item.source.raw);
  assert.equal(item.source.representation, 'js-string-single');
});

test('scan honors include roots and records file hashes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-scan-'));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.mkdirSync(path.join(tmp, 'elsewhere'));
  fs.writeFileSync(path.join(tmp, 'src', 'a.html'), '<h1>Inside source copy</h1>');
  fs.writeFileSync(path.join(tmp, 'elsewhere', 'b.html'), '<h1>Outside requested scope</h1>');

  const result = scanRepo(
    tmp,
    { ...defaultConfig, include: ['src'], exclude: [], protectedFiles: [] },
    'run-test',
  );

  assert.deepEqual(result.items.map((item) => item.file), ['src/a.html']);
  assert.equal(
    result.items[0].fileHash,
    hashText(fs.readFileSync(path.join(tmp, 'src', 'a.html'), 'utf8')),
  );
  assert.equal(result.runId, 'run-test');
  assert.equal(typeof result.inventoryDigest, 'string');
  assert.equal(result.inventoryDigest.length, 64);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('walk reports truncation instead of silently presenting a partial scan', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-walk-'));
  fs.writeFileSync(path.join(tmp, 'a.html'), '<h1>First page</h1>');
  fs.writeFileSync(path.join(tmp, 'b.html'), '<h1>Second page</h1>');

  const result = walkDetailed(tmp, { extensions: ['.html'], maxFiles: 1 });

  assert.equal(result.files.length, 1);
  assert.equal(result.truncated, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('agent output is canonicalized from inventory and cannot approve itself', () => {
  const scan = scanRepo(FIXTURE, config, 'run-import');
  const item = scan.items.find((candidate) => candidate.text === 'No deployments found.');
  assert.ok(item);
  const inventory = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    repositoryRoot: FIXTURE,
    filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy,
    truncated: scan.truncated,
    items: scan.items,
  };
  const set = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: '',
    product: 'test',
    proposals: [],
  };
  const output = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    proposals: [{
      copyId: item.id,
      after: 'Connect your first deployment to see it here.',
      alternatives: ['Connect a deployment'],
      rationale: 'Gives the empty state a recovery action.',
      problemSolved: 'The user did not know what to do next.',
      principles: ['goal-gradient'],
      evidence: ['src/app/audit/page.jsx'],
      confidence: 0.8,
      file: '../outside.txt',
      status: 'approved',
      author: 'engine',
    }],
  };

  const result = importAgentOutput(set, inventory, output, config);
  const [proposal] = result.set.proposals;

  assert.equal(result.accepted, 1);
  assert.equal(proposal.file, item.file);
  assert.equal(proposal.before, item.text);
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.author, 'agent');
  assert.match(proposal.id, /^[a-f0-9]{8}$/);
});

test('agent output identity must match the active run', () => {
  const raw = JSON.stringify({
    schemaVersion: 4,
    runId: 'wrong-run',
    inventoryDigest: 'wrong-digest',
    proposals: [],
  });
  const parsed = parseAgentOutput(raw, 'agent-output.json');
  const set = {
    schemaVersion: 4, runId: 'right-run', inventoryDigest: 'right-digest',
    generatedAt: '', product: 'test', proposals: [],
  };
  const inventory = {
    schemaVersion: 4, runId: 'right-run', inventoryDigest: 'right-digest',
    generatedAt: '', repositoryRoot: FIXTURE, filesScanned: 0,
    filesWithCopy: 0, truncated: false, items: [],
  };

  assert.throws(
    () => importAgentOutput(set, inventory, parsed, config),
    /does not match the active run/,
  );
});

test('model-written evidence cannot source an invented number', () => {
  const proposal = {
    id: 'claim', copyId: 'c', file: 'page.html', line: 1, kind: 'headline',
    before: 'Trusted by teams', after: 'Trusted by 12,347 teams',
    alternatives: [], rationale: '', problemSolved: '', principles: [],
    evidence: ['README says 12,347 teams'], confidence: 0.9,
    status: 'pending', author: 'llm',
  };

  const { blocked } = applyGuardrails([proposal], config);
  assert.match(blocked[0].hits.map((hit) => hit.rule).join(' '), /unsourced-number/);
});

test('agent dark patterns are blocked during import before review', () => {
  const scan = scanRepo(FIXTURE, config, 'run-dark');
  const item = scan.items.find((candidate) => candidate.text === 'Submit');
  assert.ok(item);
  const inventory = {
    schemaVersion: 4, runId: scan.runId, inventoryDigest: scan.inventoryDigest,
    generatedAt: '', repositoryRoot: FIXTURE, filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy, truncated: false, items: scan.items,
  };
  const set = {
    schemaVersion: 4, runId: scan.runId, inventoryDigest: scan.inventoryDigest,
    generatedAt: '', product: 'test', proposals: [],
  };
  const output = {
    schemaVersion: 4, runId: scan.runId, inventoryDigest: scan.inventoryDigest,
    proposals: [{
      copyId: item.id,
      after: 'Last chance — offer ends tonight',
      alternatives: [],
      rationale: 'Pressure the user.',
      problemSolved: 'None.',
      principles: [],
      evidence: [],
      confidence: 0.8,
    }],
  };

  const result = importAgentOutput(set, inventory, output, config);
  assert.equal(result.accepted, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.set.proposals.length, 0);
});

test('approval records are bound to the run, inventory, proposal, and final text', () => {
  const proposal = {
    id: 'p-bound', copyId: 'c-bound', file: 'page.html', line: 1, kind: 'cta',
    before: 'Submit', after: 'Get my audit', alternatives: [],
    rationale: 'Names the deliverable.', problemSolved: 'The action was vague.',
    principles: [], evidence: [], confidence: 0.8, status: 'pending', author: 'engine',
  };
  const set = {
    schemaVersion: 4, runId: 'run-bound', inventoryDigest: 'inventory-bound',
    generatedAt: '', product: 'test', proposals: [proposal],
  };
  let markdown = renderReview(set);
  markdown = markdown.replace(
    '<!-- marketing-loop:p-bound -->\n- [ ] APPROVE',
    '<!-- marketing-loop:p-bound -->\n- [x] APPROVE',
  );

  const decisions = collectDecisionSet(set, markdown);
  assert.equal(decisions.runId, set.runId);
  assert.equal(decisions.inventoryDigest, set.inventoryDigest);
  assert.equal(decisions.decisions[0].proposalDigest, proposalDigest(proposal, 'Get my audit'));
  assert.equal(validateDecisionSet(set, decisions).length, 0);

  const tampered = {
    ...set,
    proposals: [{ ...proposal, after: 'A different proposal' }],
  };
  assert.match(validateDecisionSet(tampered, decisions)[0], /digest/i);
});

test('a review file from another run is refused instead of silently reused', () => {
  const proposal = {
    id: 'p-stale', copyId: 'c-stale', file: 'page.html', line: 1, kind: 'cta',
    before: 'Submit', after: 'Get my audit', alternatives: [], rationale: '',
    problemSolved: '', principles: [], evidence: [], confidence: 0.8,
    status: 'pending', author: 'engine',
  };
  const oldSet = {
    schemaVersion: 4, runId: 'old-run', inventoryDigest: 'old-inventory',
    generatedAt: '', product: 'test', proposals: [proposal],
  };
  const currentSet = {
    ...oldSet, runId: 'current-run', inventoryDigest: 'current-inventory',
  };

  assert.throws(
    () => collectDecisionSet(currentSet, renderReview(oldSet)),
    /different run/i,
  );
});

test('canvas requires its launch token and writes digest-bound decisions', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-canvas-'));
  fs.writeFileSync(path.join(tmp, 'page.html'), '<button>Start my audit</button>\n');
  const state = secureApplyState(tmp, [{
    file: 'page.html',
    before: 'Start my audit',
    after: 'Run my audit',
  }]);
  state.set.proposals[0].id = 'deadbeef';
  const decisionsPath = path.join(tmp, '.marketing-loop', 'decisions.json');
  const canvas = await serveCanvas({
    cwd: tmp,
    config: state.applyConfig,
    set: state.set,
    inventory: state.inventory,
    proposalsPath: path.join(tmp, '.marketing-loop', 'proposals.json'),
    decisionsPath,
    backupDir: path.join(tmp, '.marketing-loop', 'backups'),
    port: 0,
  });

  try {
    const launch = new URL(canvas.url);
    const token = launch.searchParams.get('token');
    assert.ok(token);

    const bare = await fetch(launch.origin + '/');
    assert.equal(bare.status, 403);

    const page = await fetch(canvas.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const unauthenticated = await fetch(launch.origin + '/api/state');
    assert.equal(unauthenticated.status, 403);

    const wrongType = await fetch(launch.origin + '/api/decide', {
      method: 'POST',
      headers: {
        origin: launch.origin,
        'x-marketing-loop-token': token,
      },
      body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const decided = await fetch(launch.origin + '/api/decide', {
      method: 'POST',
      headers: {
        origin: launch.origin,
        'content-type': 'application/json',
        'x-marketing-loop-token': token,
      },
      body: JSON.stringify({ id: 'deadbeef', status: 'approved', edited: 'Run my audit' }),
    });
    assert.equal(decided.status, 200);

    const ledger = readJsonStrict(decisionsPath);
    assert.equal(ledger.runId, state.set.runId);
    assert.equal(ledger.decisions[0].proposalId, 'deadbeef');
    assert.equal(
      ledger.decisions[0].proposalDigest,
      proposalDigest(state.set.proposals[0], 'Run my audit'),
    );
  } finally {
    canvas.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('schema v4 CLI completes scan, agent import, human review, and safe apply', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-e2e-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const cli = path.join(here, '..', 'dist', 'cli.js');
  const run = (...args) => spawnSync(
    process.execPath,
    [cli, ...args, '--cwd', tmp],
    { encoding: 'utf8' },
  );

  try {
    let result = run('propose');
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const out = path.join(tmp, '.marketing-loop');
    const inventory = readJsonStrict(path.join(out, 'inventory.json'));
    let set = readJsonStrict(path.join(out, 'proposals.json'));
    assert.equal(inventory.schemaVersion, 4);
    assert.equal(set.runId, inventory.runId);
    assert.equal(set.inventoryDigest, inventory.inventoryDigest);

    const item = inventory.items.find((candidate) => candidate.text === 'No deployments found.');
    assert.ok(item);
    writeJson(path.join(out, 'agent-output.json'), {
      schemaVersion: 4,
      runId: inventory.runId,
      inventoryDigest: inventory.inventoryDigest,
      proposals: [{
        copyId: item.id,
        after: 'Connect your first deployment to see it here.',
        alternatives: ['Connect a deployment to get started.'],
        rationale: 'Turns a dead end into a concrete recovery action.',
        problemSolved: 'The empty state did not explain what to do next.',
        principles: ['goal-gradient'],
        evidence: ['The deployment view already exists in this route.'],
        confidence: 0.8,
      }],
    });

    result = run('import');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    set = readJsonStrict(path.join(out, 'proposals.json'));
    const imported = set.proposals.find((proposal) =>
      proposal.copyId === item.id && proposal.author === 'agent'
    );
    assert.ok(imported);
    assert.equal(imported.status, 'pending');

    result = run('review');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reviewPath = path.join(out, 'review.md');
    let review = fs.readFileSync(reviewPath, 'utf8');
    assert.match(review, new RegExp(`marketing-loop-run:${inventory.runId}`));
    review = review.replace(
      `<!-- marketing-loop:${imported.id} -->\n- [ ] APPROVE`,
      `<!-- marketing-loop:${imported.id} -->\n- [x] APPROVE`,
    );
    fs.writeFileSync(reviewPath, review);

    result = run('review', '--collect');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const ledger = readJsonStrict(path.join(out, 'decisions.json'));
    assert.equal(
      ledger.decisions.find((decision) => decision.proposalId === imported.id).decision,
      'approved',
    );

    const source = path.join(tmp, item.file);
    const before = fs.readFileSync(source, 'utf8');
    result = run('apply', '--dry-run');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(source, 'utf8'), before);

    result = run('apply');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(fs.readFileSync(source, 'utf8'), /Connect your first deployment to see it here\./);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
