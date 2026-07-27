#!/usr/bin/env node
/**
 * marketing-loop — CLI entry point.
 *
 * scan → propose → review → apply. Each stage reads the previous stage's file
 * from `.marketing-loop/`, so you can stop after any of them, hand the repo to
 * an agent, come back tomorrow, and pick up exactly where you were.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, defaultConfig, loadConfig, paths, saveConfig } from './config.js';
import { analyse, prioritiseDetailed } from './core/analyse.js';
import { applyProposals, revert } from './core/apply.js';
import { behaviorSubjects, loadBehavior } from './core/behavior.js';
import { renderBrief } from './core/brief.js';
import { serveCanvas } from './core/canvas.js';
import { applyGuardrails } from './core/guardrails.js';
import { importAgentOutput, parseAgentOutput } from './core/ingest.js';
import { linkSiblings, siblingGroups } from './core/siblings.js';
import {
  AGENT_TARGETS,
  detectAgents,
  install as installAgents,
  uninstall as uninstallAgents,
} from './core/install.js';
import { detectProvider, generateWithLlm } from './core/llm.js';
import { buildProductModel } from './core/product.js';
import { propose } from './core/propose.js';
import { renderReport } from './core/report.js';
import { applyDecisions, collectReview, foldDecisions, renderReview } from './core/review.js';
import { digestInventoryItems, scanRepo, summarise } from './core/scan.js';
import { collectDecisionSet, rotateActiveRun } from './core/state.js';
import { DEFAULT_SURFACES } from './types.js';
import type {
  BehaviorReport,
  CopyFinding,
  CopyItem,
  DecisionSet,
  Inventory,
  LoopConfig,
  ProductModel,
  ProposalSet,
} from './types.js';
import { exists, readJsonStrict, writeJson, writeText } from './util/fsx.js';
import { c, log, table } from './util/log.js';

const VERSION = '0.4.0';

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (!key) continue;
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next && !next.startsWith('-')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const command = flags._[0] ?? 'help';
  const cwd = typeof flags.cwd === 'string' ? path.resolve(flags.cwd) : process.cwd();

  switch (command) {
    case 'init': return cmdInit(cwd, flags);
    case 'scan': return cmdScan(cwd, flags);
    case 'propose': return cmdPropose(cwd, flags);
    case 'brief': return cmdBrief(cwd);
    case 'import': return cmdImport(cwd);
    case 'review': return cmdReview(cwd, flags);
    case 'apply': return cmdApply(cwd, flags);
    case 'revert': return cmdRevert(cwd);
    case 'install': return cmdInstall(cwd, flags);
    case 'uninstall': return cmdUninstall(cwd, flags);
    case 'status': return cmdStatus(cwd);
    case 'run': return cmdRun(cwd, flags);
    case 'version':
    case '--version': return void console.log(VERSION);
    default: return cmdHelp();
  }
}

/* ------------------------------------------------------------------- init */

function cmdInit(cwd: string, flags: Flags): void {
  const file = path.join(cwd, CONFIG_FILE);
  if (exists(file) && !flags.force) {
    log.warn(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
    return;
  }

  const product = buildProductModel(cwd, defaultConfig);
  const config = {
    ...defaultConfig,
    audience: product.audienceHints.slice(0, 3).join(', '),
  };
  saveConfig(cwd, config);

  const dataDir = path.join(cwd, config.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const readme = path.join(dataDir, 'README.md');
  if (!exists(readme)) writeText(readme, DATA_README);

  log.ok(`Created ${c.bold(CONFIG_FILE)}`);
  log.ok(`Created ${c.bold(config.dataDir + '/')} — drop analytics exports here`);
  log.blank();
  log.info('Two things to fill in before your first run:');
  table([
    ['audience', 'who you are selling to, in your own words'],
    ['allowedClaims', 'facts the copy is cleared to state — everything else is off limits'],
  ]);
  log.blank();
  log.info(`Then: ${c.cyan('npx marketing-loop scan')}`);
}

/* ------------------------------------------------------------------- scan */

interface ScanArtefacts {
  inventory: Inventory;
  items: CopyItem[];
  product: ProductModel;
  findings: CopyFinding[];
  behavior: BehaviorReport;
  ranked: CopyItem[];
  outOfScope: Record<string, number>;
}

function runScan(cwd: string): ScanArtefacts {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  rotateActiveRun(p.out);

  const scan = scanRepo(cwd, config);
  const { items } = scan;
  const inventory: Inventory = {
    schemaVersion: 4,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt: new Date().toISOString(),
    repositoryRoot: cwd,
    filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy,
    truncated: scan.truncated,
    items,
  };
  const product = buildProductModel(cwd, config);
  const behavior = loadBehavior(p.data, items);
  const findings = analyse(items, product, config);
  const { ranked, outOfScope } = prioritiseDetailed(
    items,
    findings,
    behaviorSubjects(behavior),
    config.surfaces ?? DEFAULT_SURFACES,
  );

  writeJson(p.inventory, inventory);
  writeJson(p.product, product);
  writeJson(p.findings, findings);
  writeJson(p.behavior, behavior);

  return { inventory, items, product, findings, behavior, ranked, outOfScope };
}

/** Tell the human what was deliberately left alone, and how to change that. */
function reportOutOfScope(outOfScope: Record<string, number>, config: LoopConfig): void {
  const entries = Object.entries(outOfScope).filter(([, n]) => n > 0);
  if (!entries.length) return;

  const total = entries.reduce((n, [, count]) => n + count, 0);
  log.blank();
  log.dim(
    `${total} string${total === 1 ? '' : 's'} skipped as out of scope: ` +
      entries.map(([surface, n]) => `${n} ${surface}`).join(' · '),
  );

  if (outOfScope.legal) {
    log.dim('Legal text is never rewritten by default — persuasive terms of service are a liability.');
  }
  log.dim(`Change this with "surfaces" in ${CONFIG_FILE} (currently: ${(config.surfaces ?? DEFAULT_SURFACES).join(', ')}).`);
}

function cmdScan(cwd: string, flags: Flags): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  log.step('Scanning…');

  const { items, product, findings, behavior, ranked, outOfScope } = runScan(cwd);
  const counts = summarise(items);

  log.blank();
  log.title(product.name);
  table([
    ['strings found', String(items.length)],
    ['by kind', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(' · ')],
    ['capabilities', product.features.slice(0, 6).map((f) => f.name).join(', ') || '—'],
    ['routes', String(product.routes.length)],
    ['findings', `${findings.length} across ${new Set(findings.map((f) => f.copyId)).size} strings`],
    ['worth rewriting', String(ranked.length)],
    ['behaviour data', behavior.sourceFiles.length ? behavior.sourceFiles.join(', ') : c.yellow(`none — drop exports in ${config.dataDir}/`)],
  ]);

  if (behavior.problems.length) {
    log.blank();
    log.title('What the data says');
    for (const problem of behavior.problems.slice(0, 5)) {
      log.info(`  ${severityColor(problem.severity)} ${c.bold(problem.subject)} — ${problem.evidence}`);
    }
  }

  log.blank();
  log.title('Highest-value strings');
  for (const item of ranked.slice(0, 8)) {
    const itemFindings = findings.filter((f) => f.copyId === item.id).map((f) => f.rule);
    log.info(`  ${c.grey(`${item.file}:${item.line}`)}`);
    log.info(`    ${c.bold(truncate(item.text, 76))}`);
    log.info(`    ${c.grey(`${item.kind} · ${itemFindings.join(', ')}`)}`);
  }

  reportOutOfScope(outOfScope, config);

  log.blank();
  log.dim(`Written to ${path.relative(cwd, p.out)}/`);
  log.info(`Next: ${c.cyan('npx marketing-loop propose')}`);
  if (flags.json) console.log(JSON.stringify({ items, findings }, null, 2));
}

/* ---------------------------------------------------------------- propose */

async function cmdPropose(cwd: string, flags: Flags): Promise<void> {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);

  if (typeof flags.max === 'string') config.maxProposals = Number(flags.max) || config.maxProposals;

  log.step('Scanning…');
  const { inventory, items, product, findings, behavior, ranked, outOfScope } = runScan(cwd);

  log.step('Proposing…');
  const result = propose({ items, findings, product, behavior, config, ranked });

  const { kept, blocked } = applyGuardrails(result.proposals, config);
  let set: ProposalSet = {
    schemaVersion: 4,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    generatedAt: new Date().toISOString(),
    product: product.name,
    proposals: linkSiblings(kept),
  };
  const brief = renderBrief({
    product,
    items,
    findings,
    behavior,
    config,
    proposed: result,
    outDir: config.outDir,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
  });

  if (flags.llm) {
    const { provider, model } = detectProvider();
    if (provider === 'none') {
      log.err('No ANTHROPIC_API_KEY or OPENAI_API_KEY set.');
      log.dim('Inside a coding agent you do not need one — the agent reads the brief. See .marketing-loop/brief.md.');
    } else {
      log.step(`Asking ${provider} (${model}) for the open items…`);
      try {
        const generated = await generateWithLlm(brief, config, config.maxProposals - set.proposals.length);
        const output = {
          schemaVersion: 4 as const,
          runId: inventory.runId,
          inventoryDigest: inventory.inventoryDigest,
          proposals: generated.map((proposal) => ({
            copyId: proposal.copyId,
            after: proposal.after,
            alternatives: proposal.alternatives,
            rationale: proposal.rationale,
            problemSolved: proposal.problemSolved,
            principles: proposal.principles,
            evidence: proposal.evidence,
            confidence: proposal.confidence,
          })),
        };
        const imported = importAgentOutput(set, inventory, output, config, 'llm');
        set = imported.set;
        log.ok(`${imported.accepted} proposals from the model`);
        if (imported.blocked.length || imported.rejected.length) {
          log.warn(`${imported.blocked.length + imported.rejected.length} model proposals refused`);
        }
      } catch (error) {
        log.err(String(error instanceof Error ? error.message : error));
      }
    }
  }

  writeJson(p.proposals, set);
  writeText(p.brief, brief);

  log.blank();
  const linked = set.proposals;
  const groups = siblingGroups(linked);
  const localised = groups.filter((g) => g.locales.length > 1);

  log.ok(`${linked.length} proposals ready`);
  reportOutOfScope(outOfScope, config);

  if (groups.length) {
    const duplicated = groups.reduce((n, g) => n + g.members.length, 0);
    log.info(
      `${duplicated} of them are ${groups.length} change${groups.length === 1 ? '' : 's'} repeated across files. ` +
        'Approve one and the review offers to carry the rest.',
    );
  }

  if (localised.length) {
    log.blank();
    log.warn(
      `${localised.length} string${localised.length === 1 ? ' appears' : 's appear'} identically in several locale bundles.`,
    );
    log.dim('That usually means those locales were never translated. Fixing the copy does not fix that.');
  }
  if (blocked.length) {
    log.warn(`${blocked.length} blocked by guardrails:`);
    for (const b of blocked.slice(0, 5)) {
      log.dim(`    "${truncate(b.proposal.after, 50)}" — ${b.hits.map((h) => h.rule).join(', ')}`);
    }
  }
  if (result.openItems.length) {
    log.info(`${c.yellow(String(result.openItems.length))} strings need judgement the engine will not fake.`);
  }

  log.blank();
  log.title('If you are inside a coding agent');
  log.info(`  Read ${c.cyan(path.join(config.outDir, 'brief.md'))} and write rewrites to ${c.cyan(path.join(config.outDir, 'agent-output.json'))}.`);
  log.info(`  Then run ${c.cyan('npx marketing-loop import')} to validate them.`);
  log.blank();
  log.title('If you are a human');
  log.info(`  ${c.cyan('npx marketing-loop review --ui')}   open the approval canvas`);
  log.info(`  ${c.cyan('npx marketing-loop review')}        or tick boxes in review.md`);
}

function cmdBrief(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { inventory, items, product, findings, behavior, ranked } = runScan(cwd);
  const result = propose({ items, findings, product, behavior, config, ranked });
  const { kept } = applyGuardrails(result.proposals, config);
  const set: ProposalSet = {
    schemaVersion: 4,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    generatedAt: new Date().toISOString(),
    product: product.name,
    proposals: linkSiblings(kept),
  };
  writeJson(p.proposals, set);
  writeText(p.brief, renderBrief({
    product,
    items,
    findings,
    behavior,
    config,
    proposed: result,
    outDir: config.outDir,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
  }));
  log.ok(`Brief written to ${path.relative(cwd, p.brief)}`);
}

function cmdImport(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { set, inventory } = readActiveState(p);
  if (!exists(p.agentOutput)) {
    throw new Error(`${path.relative(cwd, p.agentOutput)} not found`);
  }
  const output = parseAgentOutput(fs.readFileSync(p.agentOutput, 'utf8'), p.agentOutput);
  const imported = importAgentOutput(set, inventory, output, config);
  writeJson(p.proposals, imported.set);
  log.ok(`${imported.accepted} agent proposal${imported.accepted === 1 ? '' : 's'} imported`);
  for (const rejected of imported.rejected) log.warn(`${rejected.copyId ?? `entry ${rejected.index}`} — ${rejected.reason}`);
  for (const blocked of imported.blocked) log.warn(`${blocked.copyId} — ${blocked.reasons.join('; ')}`);
}

function readActiveState(p: ReturnType<typeof paths>): {
  set: ProposalSet;
  inventory: Inventory;
} {
  if (!exists(p.proposals)) throw new Error('No proposals found. Run `marketing-loop propose` first.');
  if (!exists(p.inventory)) throw new Error('No inventory found. Run `marketing-loop scan` first.');
  const set = readJsonStrict<ProposalSet>(p.proposals);
  const inventory = readJsonStrict<Inventory>(p.inventory);
  if (
    set.schemaVersion !== 4 ||
    inventory.schemaVersion !== 4 ||
    !Array.isArray(set.proposals) ||
    !Array.isArray(inventory.items)
  ) {
    throw new Error('State is not schema v4. Run `marketing-loop propose` to regenerate it.');
  }
  if (
    set.runId !== inventory.runId ||
    set.inventoryDigest !== inventory.inventoryDigest ||
    digestInventoryItems(inventory.items) !== inventory.inventoryDigest
  ) {
    throw new Error('Active proposal and inventory state do not match. Run `marketing-loop propose` again.');
  }
  return { set, inventory };
}

/* ----------------------------------------------------------------- review */

async function cmdReview(cwd: string, flags: Flags): Promise<void> {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  let { set, inventory } = readActiveState(p);

  if (exists(p.agentOutput)) {
    const output = parseAgentOutput(fs.readFileSync(p.agentOutput, 'utf8'), p.agentOutput);
    const imported = importAgentOutput(set, inventory, output, config);
    set = imported.set;
    writeJson(p.proposals, set);
    if (imported.accepted) log.ok(`${imported.accepted} agent proposal${imported.accepted === 1 ? '' : 's'} imported`);
    for (const rejected of imported.rejected) log.warn(`${rejected.copyId ?? `entry ${rejected.index}`} — ${rejected.reason}`);
    for (const blocked of imported.blocked) log.warn(`${blocked.copyId} — ${blocked.reasons.join('; ')}`);
  }

  if (!set.proposals.length) {
    log.err('No proposals found. Run `marketing-loop propose` first.');
    process.exitCode = 1;
    return;
  }

  if (flags.collect) {
    if (!exists(p.review)) {
      log.err(`${path.relative(cwd, p.review)} not found.`);
      process.exitCode = 1;
      return;
    }
    const markdown = fs.readFileSync(p.review, 'utf8');
    const collected = collectReview(markdown);
    const decisions = collectDecisionSet(set, markdown);
    const { set: updated, fannedOut } = foldDecisions(set, collected);
    writeJson(p.proposals, updated);
    writeJson(p.decisions, decisions);

    const approved = updated.proposals.filter((x) => x.status === 'approved').length;
    const rejected = updated.proposals.filter((x) => x.status === 'rejected').length;
    log.ok(`${approved} approved, ${rejected} rejected`);

    if (fannedOut) {
      log.info(`${fannedOut} carried across identical copies in other files.`);
    } else {
      const groups = siblingGroups(updated.proposals);
      const undecided = groups.filter((g) => g.members.some((m) => m.status === 'pending'));
      if (undecided.length) {
        log.blank();
        log.warn(`${undecided.length} change${undecided.length === 1 ? '' : 's'} appear in more than one file.`);
        log.dim('Tick SAME DECISION FOR ALL IDENTICAL COPIES on a block to carry your call across the rest.');
      }
    }

    log.info(`Next: ${c.cyan('npx marketing-loop apply')}`);
    return;
  }

  if (flags.ui) {
    const port = Number(flags.port) || 7788;
    const canvas = await serveCanvas({
      cwd,
      config,
      set,
      inventory,
      proposalsPath: p.proposals,
      decisionsPath: p.decisions,
      backupDir: p.backups,
      port,
      onApplied: (results) => {
        writeJson(p.applied, results);
        writeText(p.report, renderReport(set, results));
        const ok = results.filter((r) => r.ok).length;
        log.ok(`Applied ${ok} change${ok === 1 ? '' : 's'} · report at ${path.relative(cwd, p.report)}`);
      },
    });

    log.ok(`Canvas at ${c.cyan(canvas.url)}`);
    log.dim('Approve, edit, then press Apply. Ctrl-C when you are done.');
    open(canvas.url);
    return;
  }

  writeText(p.review, renderReview(set));
  log.ok(`Review file at ${c.cyan(path.relative(cwd, p.review))}`);
  log.blank();
  log.info('  1. Tick APPROVE or REJECT on each block, edit the FINAL text if you want');
  log.info(`  2. ${c.cyan('npx marketing-loop review --collect')}`);
  log.info(`  3. ${c.cyan('npx marketing-loop apply')}`);
  log.blank();
  log.dim(`Prefer a UI? ${c.cyan('npx marketing-loop review --ui')}`);
}

/* ------------------------------------------------------------------ apply */

function cmdApply(cwd: string, flags: Flags): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { set, inventory } = readActiveState(p);
  let decisions: DecisionSet;

  // A review.md left on disk with ticks in it is the human's latest word.
  if (exists(p.review)) {
    const markdown = fs.readFileSync(p.review, 'utf8');
    const collected = collectReview(markdown);
    decisions = collectDecisionSet(set, markdown);
    set.proposals = applyDecisions(set, collected).proposals;
    writeJson(p.decisions, decisions);
  } else if (exists(p.decisions)) {
    decisions = readJsonStrict<DecisionSet>(p.decisions);
  } else {
    throw new Error('Nothing approved yet. Run `marketing-loop review` first.');
  }

  const approved = decisions.decisions.filter((decision) => decision.decision === 'approved');
  if (!approved.length) {
    log.warn('Nothing approved yet. Nothing to do.');
    log.dim('A human has to approve before anything is written. That is the point of the tool.');
    log.info(`  ${c.cyan('npx marketing-loop review --ui')}`);
    return;
  }

  const dryRun = Boolean(flags['dry-run'] || flags.n);
  const results = applyProposals(set, {
    cwd,
    config,
    backupDir: p.backups,
    inventory,
    decisions,
    dryRun,
  });
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);

  if (!dryRun) {
    writeJson(p.proposals, set);
    writeJson(p.applied, results);
    writeText(p.report, renderReport(set, results));
  }

  log.blank();
  for (const result of ok) {
    const proposal = set.proposals.find((x) => x.id === result.proposalId);
    if (!proposal) continue;
    log.info(`  ${c.green('→')} ${c.grey(`${proposal.file}:${proposal.line}`)}`);
    log.info(`    ${c.red('-')} ${truncate(proposal.before, 74)}`);
    log.info(`    ${c.green('+')} ${truncate(proposal.edited ?? proposal.after, 74)}`);
  }

  log.blank();
  log.ok(`${dryRun ? 'Would apply' : 'Applied'} ${ok.length} change${ok.length === 1 ? '' : 's'}`);
  for (const result of bad) log.warn(`${result.file} — ${result.reason}`);

  if (!dryRun && ok.length) {
    log.dim(`Report: ${path.relative(cwd, p.report)}`);
    log.dim(`Undo:   npx marketing-loop revert`);
  }
}

function cmdRevert(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const restored = revert(cwd, p.backups);
  if (!restored.length) {
    log.warn('No backups to restore.');
    return;
  }
  log.ok(`Restored ${restored.length} file${restored.length === 1 ? '' : 's'}`);
  for (const file of restored) log.dim(`  ${file}`);
}

/* ---------------------------------------------------------------- install */

function cmdInstall(cwd: string, flags: Flags): void {
  if (flags.list) {
    log.title('Supported agents');
    for (const target of AGENT_TARGETS) {
      log.info(`  ${c.bold(target.id.padEnd(12))} ${c.grey(target.file)}`);
      log.dim(`    ${target.name}`);
      if (target.commandDir) log.dim(`    slash commands → ${target.commandDir}/`);
      if (target.note) log.dim(`    ${target.note}`);
    }
    return;
  }

  let targets = detectAgents(cwd);

  if (flags.all) {
    targets = AGENT_TARGETS;
  } else if (typeof flags.agents === 'string') {
    const wanted = flags.agents.split(',').map((s) => s.trim());
    targets = AGENT_TARGETS.filter((t) => wanted.includes(t.id));
    if (!targets.length) {
      log.err(`No agents matched "${flags.agents}". Run with --list to see the ids.`);
      process.exitCode = 1;
      return;
    }
  } else {
    // AGENTS.md is the cross-tool standard — always install it.
    const agentsMd = AGENT_TARGETS.find((t) => t.id === 'agents-md');
    if (agentsMd && !targets.some((t) => t.id === 'agents-md')) targets = [agentsMd, ...targets];
  }

  const results = installAgents(cwd, targets, { force: Boolean(flags.force) });
  const commands = results.filter((r) => r.command);
  const rules = results.filter((r) => !r.command);

  if (commands.length) {
    log.title('Slash commands — type / in your agent and pick one');
    for (const result of commands) {
      const mark = result.action === 'unchanged' ? c.grey('=') : c.green('✓');
      log.info(`  ${mark} ${c.cyan('/' + path.basename(result.file, '.md')).padEnd(28)} ${c.grey(result.file)}`);
    }
  }

  log.title('Rules — background context, not something you invoke');
  for (const result of rules) {
    const mark = result.action === 'unchanged' ? c.grey('=') : c.green('✓');
    log.info(`  ${mark} ${result.file.padEnd(46)} ${c.grey(result.action)}`);
  }

  log.blank();
  log.dim(`${targets.length} agent${targets.length === 1 ? '' : 's'}. Add more with --agents cursor,cline or everything with --all.`);

  const noCommands = targets.filter((t) => !t.commandDir && t.id !== 'claude-code');
  if (noCommands.length) {
    log.blank();
    log.dim(`${noCommands.map((t) => t.id).join(', ')} have no slash-command directory — for those, ask the agent to "run the marketing loop" and it will pick up the rule.`);
  }

  log.blank();
  log.info(`Claude Code gets more from the plugin than the rules file:`);
  log.info(`  ${c.cyan('/plugin marketplace add keilo2000/marketing-loop')}`);
  log.info(`  ${c.cyan('/plugin install marketing-loop@marketing-loop')}`);
  log.blank();
  log.info(`Next: ${c.cyan('npx marketing-loop init')} then ${c.cyan('npx marketing-loop scan')}`);
}

function cmdUninstall(cwd: string, flags: Flags): void {
  const targets = flags.all ? AGENT_TARGETS : detectAgents(cwd);
  const removed = uninstallAgents(cwd, targets);
  if (!removed.length) {
    log.warn('Nothing to remove.');
    return;
  }
  log.ok(`Removed from ${removed.length} file${removed.length === 1 ? '' : 's'}`);
  for (const file of removed) log.dim(`  ${file}`);
}

/* ----------------------------------------------------------------- status */

function cmdStatus(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const set = exists(p.proposals) ? readJsonStrict<ProposalSet>(p.proposals) : null;

  log.title('marketing-loop status');
  table([
    ['config', exists(path.join(cwd, CONFIG_FILE)) ? c.green('yes') : c.yellow('using defaults — run init')],
    ['data', exists(p.data) ? c.green(config.dataDir + '/') : c.yellow('none')],
    ['inventory', exists(p.inventory) ? c.green('yes') : c.grey('not scanned')],
    ['brief', exists(p.brief) ? c.green(path.join(config.outDir, 'brief.md')) : c.grey('none')],
  ]);

  if (set) {
    const by: Record<string, number> = {};
    for (const proposal of set.proposals) by[proposal.status] = (by[proposal.status] ?? 0) + 1;
    log.blank();
    table([
      ['proposals', String(set.proposals.length)],
      ['pending', String(by.pending ?? 0)],
      ['approved', String(by.approved ?? 0)],
      ['applied', String(by.applied ?? 0)],
      ['rejected', String(by.rejected ?? 0)],
    ]);
  }

  const agents = detectAgents(cwd);
  log.blank();
  log.info(`Agents detected: ${agents.length ? agents.map((a) => a.id).join(', ') : c.grey('none')}`);
}

/* -------------------------------------------------------------------- run */

async function cmdRun(cwd: string, flags: Flags): Promise<void> {
  await cmdPropose(cwd, { ...flags, _: ['propose'] });
  await cmdReview(cwd, { ...flags, _: ['review'], ui: true });
}

/* ------------------------------------------------------------------- help */

function cmdHelp(): void {
  console.log(`
${c.bold('marketing-loop')} ${c.grey('v' + VERSION)}

  Reads your code, works out what the product actually solves, rewrites the
  copy to sell that, and ships nothing until a human approves it.

${c.bold('Commands')}

  ${c.cyan('install')}            add the loop to every coding agent in this repo
    --list             show supported agents
    --all              install for all of them, detected or not
    --agents a,b       pick specific ones

  ${c.cyan('init')}               create marketing-loop.config.json
  ${c.cyan('scan')}               find and diagnose every user-facing string
  ${c.cyan('propose')}            generate rewrites + the agent brief
    --llm              also ask an API model (needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
    --max 30           cap the number of proposals
  ${c.cyan('brief')}              regenerate .marketing-loop/brief.md only
  ${c.cyan('import')}             validate agent-output.json into the active run
  ${c.cyan('review')}             write review.md for approval
    --ui               open the approval canvas in a browser instead
    --port 7788        canvas port
    --collect          read ticked decisions back out of review.md
  ${c.cyan('apply')}              write approved changes to your code
    --dry-run          show what would change
  ${c.cyan('revert')}             restore the last applied run
  ${c.cyan('status')}             where the loop currently stands
  ${c.cyan('run')}                propose, then open the canvas

${c.bold('Typical first run')}

  npx marketing-loop install
  npx marketing-loop init
  npx marketing-loop scan
  npx marketing-loop propose
  npx marketing-loop review --ui

${c.bold('Inside a coding agent')}

  Run ${c.cyan('propose')}, then point the agent at ${c.cyan('.marketing-loop/brief.md')}.
  The agent writes agent-output.json; import validates it, then a human approves it.
`);
}

/* ----------------------------------------------------------------- helpers */

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

function severityColor(severity: string): string {
  if (severity === 'high') return c.red('●');
  if (severity === 'medium') return c.yellow('●');
  return c.grey('●');
}

function open(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* the URL is printed above; opening a browser is a nicety, not a requirement */
  }
}

const DATA_README = `# Behavioural data

Drop exports here. The loop reads them on every \`scan\` and uses them to decide
which strings are worth rewriting first — a proposal aimed at a measured
drop-off is worth far more than one aimed at a hunch.

## What works

| file | what it should contain |
| --- | --- |
| \`*.csv\` / \`*.tsv\` | any export with a label column and a metric column |
| \`*.json\` | arrays of objects, or a \`{ results: [...] }\` / \`{ rows: [...] }\` wrapper |
| \`notes.md\` | plain sentences about what you have observed |

Filenames are used to identify the source, so \`ga4-landing.csv\`,
\`posthog-funnel.csv\`, \`amplitude-events.json\` and \`hotjar-scroll.csv\` all get
labelled correctly in the brief.

## Columns it understands

Header names are matched loosely, so most exports work untouched:

- **label** — \`event\`, \`event name\`, \`page\`, \`page path\`, \`step\`, \`cta\`, \`button\`, \`element\`
- **volume** — \`users\`, \`sessions\`, \`visitors\`, \`count\`, \`events\`
- **conversion** — \`conversions\`, \`clicks\`, \`signups\`, \`completions\`
- **rate** — \`conversion rate\`, \`ctr\`, \`engagement rate\`
- **loss** — \`bounce rate\`, \`exit rate\`, \`drop-off\`, \`abandonment\`
- **depth** — \`scroll depth\`, \`avg time\`

If a file is an ordered funnel with a users column and no explicit drop-off
column, drop-off is calculated for you.

## notes.md

The least sophisticated input here is often the most useful one. One line per
observation:

\`\`\`
Nobody scrolls past the pricing table on /pricing.
Support gets three "what does this actually do" emails a week.
The signup button gets clicked, then 40% bounce on the form.
\`\`\`

These go into the brief verbatim as human observations.

## Privacy

Nothing here is uploaded anywhere. The loop reads these files locally. If you
use \`--llm\`, aggregate figures may be included in the brief sent to that API —
so keep raw user-level exports out of this folder.
`;

main().catch((error: unknown) => {
  log.err(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
