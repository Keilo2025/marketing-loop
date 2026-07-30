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
import { CONFIG_FILE, defaultConfig, hasDeprecatedScopeOptions, loadConfig, paths, saveConfig } from './config.js';
import { analyse, prioritiseDetailed } from './core/analyse.js';
import { applyProposals, revert } from './core/apply.js';
import { behaviorCopyIds, loadBehavior } from './core/behavior.js';
import { renderBrief } from './core/brief.js';
import { resolveCatalogueScope } from './core/catalogue.js';
import { createLanguageLoopAdapter } from './core/content-language.js';
import { readContentLoopState, runContentLoop } from './core/content.js';
import { buildMarketingContext } from './core/context.js';
import { serveCanvas } from './core/canvas.js';
import {
  normalizeContentFilter,
  resolveContentSelection,
} from './core/filter.js';
import { deriveHandoff, handoffSelection, writeHandoff } from './core/handoff.js';
import { loadReviewHistory } from './core/history.js';
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
import {
  assertMeasurementLedger,
  emptyMeasurementLedger,
  markVariantDeployed,
  recordBaseline,
  recordPostChange,
  registerVariant,
} from './core/measurement.js';
import { propose } from './core/propose.js';
import { renderReport } from './core/report.js';
import { applyDecisions, collectReview, foldDecisions, renderReview } from './core/review.js';
import {
  digestInventoryItems,
  scanResolvedCatalogue,
  summarise,
} from './core/scan.js';
import { collectDecisionSet, rotateActiveRun } from './core/state.js';
import { ACTIVE_STATE_SCHEMA_ERROR, DEFAULT_SURFACES, STATE_SCHEMA_VERSION } from './types.js';
import type {
  ApplyResult,
  BehaviorReport,
  ContentLoopState,
  ContentMarketingAdapter,
  ContentMarketingSnapshot,
  ContentSelection,
  CopyFinding,
  CopyItem,
  DecisionSet,
  Inventory,
  LoopConfig,
  MarketingContext,
  MeasurementDirection,
  MeasurementLedger,
  ProposalSet,
} from './types.js';
import { exists, readJsonStrict, writeJson, writeText } from './util/fsx.js';
import { c, log, table } from './util/log.js';

const VERSION = '0.5.0';

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
  if (flags.version) return void console.log(VERSION);
  const command = flags._[0] ?? 'help';
  const cwd = typeof flags.cwd === 'string' ? path.resolve(flags.cwd) : process.cwd();

  switch (command) {
    case 'init': return cmdInit(cwd, flags);
    case 'scan': return cmdScan(cwd, flags);
    case 'propose': await cmdPropose(cwd, flags); return;
    case 'brief': return cmdBrief(cwd);
    case 'import': return cmdImport(cwd);
    case 'review': return cmdReview(cwd, flags);
    case 'apply': cmdApply(cwd, flags); return;
    case 'revert': return cmdRevert(cwd);
    case 'measure': return cmdMeasure(cwd, flags);
    case 'install': return cmdInstall(cwd, flags);
    case 'uninstall': return cmdUninstall(cwd, flags);
    case 'status': return cmdStatus(cwd);
    case 'content': return cmdContent(cwd, flags);
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

  const config = { ...defaultConfig };
  saveConfig(cwd, config);

  const dataDir = path.join(cwd, config.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const readme = path.join(dataDir, 'README.md');
  if (!exists(readme)) writeText(readme, DATA_README);

  log.ok(`Created ${c.bold(CONFIG_FILE)}`);
  log.ok(`Created ${c.bold(config.dataDir + '/')} — drop analytics exports here`);
  try {
    const scope = resolveCatalogueScope(cwd, config);
    log.ok(`Source catalogue: ${c.bold(scope.messagesDir)} · ${scope.sourceLocale} · ${scope.layout}`);
    log.dim(`Authoritative scope: ${exists(path.join(cwd, 'language-loop.config.json')) ? 'language-loop.config.json' : 'marketing-loop.config.json/defaults'}`);
  } catch (error) {
    log.warn(`Source catalogue not ready: ${String(error instanceof Error ? error.message : error)}`);
    log.dim('Create the source catalogue first, or run language-loop extract when language-loop is available.');
  }
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
  context: MarketingContext;
  catalogueFiles: string[];
  findings: CopyFinding[];
  behavior: BehaviorReport;
  ranked: CopyItem[];
  outOfScope: Record<string, number>;
}

function runScan(cwd: string): ScanArtefacts {
  warnDeprecatedScopeOptions(cwd);
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const scope = resolveCatalogueScope(cwd, config);
  const scan = scanResolvedCatalogue(cwd, scope);
  const { items } = scan;
  const generatedAt = new Date().toISOString();
  const inventory: Inventory = {
    schemaVersion: STATE_SCHEMA_VERSION,
    scopeDigest: scan.scopeDigest,
    sourceLocale: scan.sourceLocale,
    runId: scan.runId,
    inventoryDigest: scan.inventoryDigest,
    generatedAt,
    repositoryRoot: cwd,
    filesScanned: scan.filesScanned,
    filesWithCopy: scan.filesWithCopy,
    truncated: scan.truncated,
    items,
  };
  const context = buildMarketingContext(scope, items, config);
  const behavior = loadBehavior(p.data, items, config.benchmarks);
  const findings = analyse(items, context, config);
  const { ranked, outOfScope } = prioritiseDetailed(
    items,
    findings,
    behaviorCopyIds(behavior),
    config.surfaces ?? DEFAULT_SURFACES,
  );
  const emptySet: ProposalSet = {
    schemaVersion: STATE_SCHEMA_VERSION,
    scopeDigest: inventory.scopeDigest,
    sourceLocale: inventory.sourceLocale,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    generatedAt,
    product: context.currentTagline ?? 'source catalogue',
    proposals: [],
  };
  const emptyHandoff = deriveHandoff(emptySet, inventory, scope);

  // Do not disturb the active freeze contract until every new scan artefact
  // and its identity-safe empty handoff have been constructed successfully.
  rotateActiveRun(p.out);
  writeJson(p.inventory, inventory);
  // Deprecated filename retained for one release for external consumers.
  writeJson(p.product, context);
  writeJson(p.findings, findings);
  writeJson(p.behavior, behavior);
  writeJson(p.handoff, emptyHandoff);

  return {
    inventory,
    items,
    context,
    catalogueFiles: scope.files,
    findings,
    behavior,
    ranked,
    outOfScope,
  };
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

  const { items, context, catalogueFiles, findings, behavior, ranked, outOfScope } = runScan(cwd);
  const counts = summarise(items);

  log.blank();
  log.title('Source catalogue');
  table([
    ['strings found', String(items.length)],
    ['by kind', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(' · ')],
    ['source locale', context.sourceLocale],
    ['catalogue files', catalogueFiles.join(', ') || '—'],
    ['namespaces', context.namespaces.join(', ') || '—'],
    ['findings', `${findings.length} across ${new Set(findings.map((f) => f.copyId)).size} strings`],
    ['worth rewriting', String(ranked.length)],
    ['behavior sources', behavior.sourceFiles.length ? behavior.sourceFiles.join(', ') : c.yellow(`none — drop exports in ${config.dataDir}/`)],
  ]);

  log.blank();
  log.title('Inspected source files');
  for (const file of catalogueFiles) log.info(`  ${file}`);

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

async function cmdPropose(
  cwd: string,
  flags: Flags,
  selection?: ContentSelection,
): Promise<{ set: ProposalSet; inventory: Inventory }> {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);

  if (typeof flags.max === 'string') config.maxProposals = Number(flags.max) || config.maxProposals;

  log.step('Scanning…');
  const { inventory, items, context, findings, behavior, ranked, outOfScope } = runScan(cwd);
  const history = loadReviewHistory(p.history);

  log.step('Proposing…');
  const result = propose({
    items,
    findings,
    context,
    behavior,
    config,
    ranked,
    history,
    selection,
  });

  const { kept, blocked } = applyGuardrails(result.proposals, config);
  let set: ProposalSet = {
    schemaVersion: STATE_SCHEMA_VERSION,
    scopeDigest: inventory.scopeDigest,
    sourceLocale: inventory.sourceLocale,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    generatedAt: new Date().toISOString(),
    product: context.currentTagline ?? 'source catalogue',
    ...(selection ? { selection } : {}),
    proposals: linkSiblings(kept),
  };
  const brief = renderBrief({
    context,
    items,
    findings,
    behavior,
    config,
    proposed: result,
    outDir: config.outDir,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    history,
    selection,
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
          schemaVersion: STATE_SCHEMA_VERSION,
          runId: inventory.runId,
          inventoryDigest: inventory.inventoryDigest,
          proposals: generated,
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

  persistProposalState(cwd, config, set, inventory);
  writeText(p.brief, brief);

  log.blank();
  const linked = set.proposals;
  const groups = siblingGroups(linked);

  log.ok(`${linked.length} proposals ready`);
  reportOutOfScope(outOfScope, config);

  if (groups.length) {
    const duplicated = groups.reduce((n, g) => n + g.members.length, 0);
    log.info(
      `${duplicated} of them are ${groups.length} change${groups.length === 1 ? '' : 's'} repeated across files. ` +
        'Approve one and the review offers to carry the rest.',
    );
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
  return { set, inventory };
}

function cmdBrief(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { inventory, items, context, findings, behavior, ranked } = runScan(cwd);
  const history = loadReviewHistory(p.history);
  const result = propose({ items, findings, context, behavior, config, ranked, history });
  const { kept } = applyGuardrails(result.proposals, config);
  const set: ProposalSet = {
    schemaVersion: STATE_SCHEMA_VERSION,
    scopeDigest: inventory.scopeDigest,
    sourceLocale: inventory.sourceLocale,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    generatedAt: new Date().toISOString(),
    product: context.currentTagline ?? 'source catalogue',
    proposals: linkSiblings(kept),
  };
  persistProposalState(cwd, config, set, inventory);
  writeText(p.brief, renderBrief({
    context,
    items,
    findings,
    behavior,
    config,
    proposed: result,
    outDir: config.outDir,
    runId: inventory.runId,
    inventoryDigest: inventory.inventoryDigest,
    history,
  }));
  log.ok(`Brief written to ${path.relative(cwd, p.brief)}`);
}

function cmdImport(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { set, inventory } = readActiveState(cwd, config, p);
  if (!exists(p.agentOutput)) {
    throw new Error(`${path.relative(cwd, p.agentOutput)} not found`);
  }
  const output = parseAgentOutput(fs.readFileSync(p.agentOutput, 'utf8'), p.agentOutput);
  const imported = importAgentOutput(set, inventory, output, config);
  persistProposalState(cwd, config, imported.set, inventory);
  log.ok(`${imported.accepted} agent proposal${imported.accepted === 1 ? '' : 's'} imported`);
  for (const rejected of imported.rejected) log.warn(`${rejected.copyId ?? `entry ${rejected.index}`} — ${rejected.reason}`);
  for (const blocked of imported.blocked) log.warn(`${blocked.copyId} — ${blocked.reasons.join('; ')}`);
}

function readActiveState(cwd: string, config: LoopConfig, p: ReturnType<typeof paths>): {
  set: ProposalSet;
  inventory: Inventory;
} {
  if (!exists(p.proposals)) throw new Error('No proposals found. Run `marketing-loop propose` first.');
  if (!exists(p.inventory)) throw new Error('No inventory found. Run `marketing-loop scan` first.');
  const set = readJsonStrict<ProposalSet>(p.proposals);
  const inventory = readJsonStrict<Inventory>(p.inventory);
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    inventory.schemaVersion !== STATE_SCHEMA_VERSION ||
    !Array.isArray(set.proposals) ||
    !Array.isArray(inventory.items)
  ) {
    throw new Error(ACTIVE_STATE_SCHEMA_ERROR);
  }
  if (
    set.runId !== inventory.runId ||
    set.inventoryDigest !== inventory.inventoryDigest ||
    set.scopeDigest !== inventory.scopeDigest ||
    set.sourceLocale !== inventory.sourceLocale ||
    digestInventoryItems(inventory.items, inventory.scopeDigest, inventory.sourceLocale) !== inventory.inventoryDigest
  ) {
    throw new Error('Active proposal and inventory state do not match. Run `marketing-loop propose` again.');
  }
  const scope = resolveCatalogueScope(cwd, config);
  if (
    inventory.scopeDigest !== scope.scopeDigest ||
    inventory.sourceLocale !== scope.sourceLocale
  ) {
    throw new Error('Active marketing state does not match the configured source catalogue. Run `marketing-loop propose` again.');
  }
  return { set, inventory };
}

function persistProposalState(
  cwd: string,
  config: LoopConfig,
  set: ProposalSet,
  inventory: Inventory,
): void {
  const p = paths(cwd, config);
  writeJson(p.proposals, set);
  writeHandoff(p.handoff, set, inventory, resolveCatalogueScope(cwd, config));
}

/* ----------------------------------------------------------------- review */

async function cmdReview(cwd: string, flags: Flags): Promise<void> {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  let { set, inventory } = readActiveState(cwd, config, p);

  if (exists(p.agentOutput)) {
    const output = parseAgentOutput(fs.readFileSync(p.agentOutput, 'utf8'), p.agentOutput);
    const imported = importAgentOutput(set, inventory, output, config);
    set = imported.set;
    persistProposalState(cwd, config, set, inventory);
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
    writeJson(p.decisions, decisions);
    persistProposalState(cwd, config, updated, inventory);

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
      onStateChanged: (changed, activeInventory) => {
        writeHandoff(p.handoff, changed, activeInventory, resolveCatalogueScope(cwd, config));
      },
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

function cmdApply(cwd: string, flags: Flags): ApplyResult[] {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const { set, inventory } = readActiveState(cwd, config, p);
  let decisions: DecisionSet;

  // A review.md left on disk with ticks in it is the human's latest word.
  if (exists(p.review) && !flags['use-decisions']) {
    const markdown = fs.readFileSync(p.review, 'utf8');
    const collected = collectReview(markdown);
    decisions = collectDecisionSet(set, markdown);
    set.proposals = applyDecisions(set, collected).proposals;
    writeJson(p.decisions, decisions);
    persistProposalState(cwd, config, set, inventory);
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
    return [];
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
    persistProposalState(cwd, config, set, inventory);
    writeJson(p.applied, results);
    writeText(p.report, renderReport(set, results));
    if (bad.length) process.exitCode = 1;
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
  return results;
}

function cmdRevert(cwd: string): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const restored = revert(cwd, config, p.backups);
  if (!restored.length) {
    log.warn('No backups to restore.');
    return;
  }
  log.ok(`Restored ${restored.length} file${restored.length === 1 ? '' : 's'}`);
  for (const file of restored) log.dim(`  ${file}`);
}

/* --------------------------------------------------------------- measure */

function cmdMeasure(cwd: string, flags: Flags): void {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const action = flags._[1] ?? 'status';
  const ledger = readMeasurementLedger(p.measurements);

  if (action === 'baseline') {
    const metric = requiredFlag(flags, 'metric');
    const direction = optionalDirection(flags.direction, metric);
    const baseline = recordBaseline(ledger, {
      subject: requiredFlag(flags, 'subject'),
      metric,
      value: requiredNumberFlag(flags, 'value'),
      unit: optionalUnit(flags.unit),
      sampleSize: optionalIntegerFlag(flags, 'sample-size'),
      measuredAt: optionalTimestamp(flags.at),
      source: requiredFlag(flags, 'source'),
      direction,
    });
    writeJson(p.measurements, ledger);
    log.ok(`Baseline ${baseline.id} recorded for ${baseline.subject}`);
    return;
  }

  if (action === 'variant') {
    const { set } = readActiveState(cwd, config, p);
    const proposalId = requiredFlag(flags, 'proposal');
    const proposal = set.proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal) throw new Error(`proposal ${proposalId} does not exist in the active run`);
    if (proposal.status !== 'applied') {
      throw new Error(`proposal ${proposalId} must be applied before it can become a measured variant`);
    }
    const variant = registerVariant(ledger, {
      baselineId: requiredFlag(flags, 'baseline'),
      runId: set.runId,
      proposalId: proposal.id,
      catalogueKey: proposal.catalogueKey,
      before: proposal.before,
      after: proposal.edited ?? proposal.after,
      createdAt: optionalTimestamp(flags.at),
    });
    writeJson(p.measurements, ledger);
    log.ok(`Variant ${variant.id} bound to ${proposal.catalogueKey}`);
    return;
  }

  if (action === 'deploy') {
    const variantId = requiredFlag(flags, 'variant');
    const deployment = markVariantDeployed(ledger, variantId, {
      markedAt: optionalTimestamp(flags.at),
      environment: requiredFlag(flags, 'environment'),
      marker: requiredFlag(flags, 'marker'),
    });
    writeJson(p.measurements, ledger);
    log.ok(`Deployment marked for ${variantId} at ${deployment.markedAt}`);
    return;
  }

  if (action === 'result') {
    const variantId = requiredFlag(flags, 'variant');
    const result = recordPostChange(ledger, variantId, {
      value: requiredNumberFlag(flags, 'value'),
      sampleSize: optionalIntegerFlag(flags, 'sample-size'),
      measuredAt: optionalTimestamp(flags.at),
      source: requiredFlag(flags, 'source'),
      minimumRelativeUplift: optionalNumberFlag(flags, 'minimum-uplift', 5),
      minimumSampleSize: optionalIntegerFlag(flags, 'minimum-sample') ?? 100,
    });
    writeJson(p.measurements, ledger);
    log.ok(`Uplift decision for ${variantId}: ${result.decision}`);
    log.info(`  ${result.decisionReason}`);
    return;
  }

  if (action !== 'status') {
    throw new Error('measure action must be baseline, variant, deploy, result, or status');
  }

  log.title('measurement status');
  table([
    ['baselines', String(ledger.baselines.length)],
    ['variants', String(ledger.variants.length)],
    ['deployed', String(ledger.variants.filter((variant) => variant.deployment).length)],
    ['with results', String(ledger.variants.filter((variant) => variant.results.length).length)],
  ]);
  for (const variant of ledger.variants) {
    const latest = variant.results.at(-1);
    log.info(
      `  ${variant.id} · ${variant.catalogueKey} · ` +
      `${latest?.decision ?? (variant.deployment ? 'measuring' : 'not deployed')}`,
    );
  }
}

function readMeasurementLedger(file: string): MeasurementLedger {
  if (!exists(file)) return emptyMeasurementLedger();
  const ledger = readJsonStrict<unknown>(file);
  assertMeasurementLedger(ledger);
  return ledger;
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
  warnDeprecatedScopeOptions(cwd);
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const set = exists(p.proposals) ? readJsonStrict<ProposalSet>(p.proposals) : null;
  const handoff = exists(p.handoff) ? readJsonStrict<{ unresolved?: unknown[] }>(p.handoff) : null;
  const measurements = readMeasurementLedger(p.measurements);
  let scope: ReturnType<typeof resolveCatalogueScope> | null = null;
  try { scope = resolveCatalogueScope(cwd, config); } catch { /* status remains useful before extraction */ }

  log.title('marketing-loop status');
  table([
    ['config', exists(path.join(cwd, CONFIG_FILE)) ? c.green('yes') : c.yellow('using defaults — run init')],
    ['data', exists(p.data) ? c.green(config.dataDir + '/') : c.yellow('none')],
    ['inventory', exists(p.inventory) ? c.green('yes') : c.grey('not scanned')],
    ['brief', exists(p.brief) ? c.green(path.join(config.outDir, 'brief.md')) : c.grey('none')],
    ['source locale', scope?.sourceLocale ?? c.yellow('unresolved')],
    ['catalogue directory', scope?.messagesDir ?? c.yellow('unresolved')],
    ['catalogue layout', scope?.layout ?? c.yellow('unresolved')],
    ['unresolved handoff', String(handoff?.unresolved?.length ?? 0)],
    ['measurement variants', String(measurements.variants.length)],
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

/* --------------------------------------------------------------- content */

async function cmdContent(cwd: string, flags: Flags): Promise<void> {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const action = flags._[1];
  const active = readContentLoopState(p.contentLoop);

  if (action === 'status') {
    if (!active) {
      log.warn('No Content Loop run exists yet.');
      log.info(`Start one with ${c.cyan('npx marketing-loop content')}`);
      return;
    }
    renderContentStatus(active, Boolean(flags.json));
    return;
  }

  if (action && action !== 'plan') {
    throw new Error(`Unknown content action "${action}". Use content, content plan, or content status.`);
  }

  let selection: ContentSelection;
  if (active && !flags.restart) {
    selection = active.selection;
    assertRequestedSelectionUnchanged(flags, selection);
  } else {
    selection = previewContentSelection(cwd, flags);
  }

  if (action === 'plan') {
    renderContentPlan(selection, Boolean(flags.json));
    return;
  }

  const languageModule = languageModulePath(flags);
  const state = await runContentLoop({
    stateFile: p.contentLoop,
    selection,
    marketing: createMarketingAdapter(cwd, flags),
    language: createLanguageLoopAdapter({
      cwd,
      ...(languageModule ? { modulePath: languageModule } : {}),
    }),
    executeLanguage: Boolean(flags.llm),
    restart: Boolean(flags.restart),
    openReview: Boolean(flags.ui),
  });
  renderContentStatus(state, Boolean(flags.json));

  if (state.phase === 'waiting-review') {
    log.info(`Next: review ${c.cyan(path.join(config.outDir, 'review.md'))}, then run ${c.cyan('npx marketing-loop content')} again.`);
  } else if (state.phase === 'language-ready') {
    log.info(`Next: ${c.cyan('npx marketing-loop content --llm')} to translate until every selected language is accepted.`);
  } else if (state.phase === 'blocked') {
    if (state.retryable) {
      log.warn('The pause is retryable. Run the same Content Loop command again when the provider is available.');
    }
    process.exitCode = 2;
  } else if (state.phase === 'needs-human') {
    log.warn('A selected translation needs an explicit human decision before Content Loop can complete.');
    process.exitCode = 2;
  }
}

function createMarketingAdapter(cwd: string, flags: Flags): ContentMarketingAdapter {
  return {
    start: async (selection) => {
      const config = loadConfig(cwd);
      const p = paths(cwd, config);
      const { set, inventory } = await cmdPropose(
        cwd,
        { ...flags, _: ['propose'] },
        selection,
      );
      writeText(p.review, renderReview(set));
      return marketingSnapshot(cwd, set, inventory, set.proposals.length ? 0 : 1);
    },
    inspect: async () => {
      const config = loadConfig(cwd);
      const p = paths(cwd, config);
      const { set, inventory } = readActiveState(cwd, config, p);
      return marketingSnapshot(cwd, set, inventory, explicitDecisionCount(p, set));
    },
    collectAndApply: async () => {
      const config = loadConfig(cwd);
      const p = paths(cwd, config);
      let active = readActiveState(cwd, config, p);
      if (!active.set.proposals.length) return marketingSnapshot(cwd, active.set, active.inventory, 1);

      const reviewDecisions = exists(p.review)
        ? collectReview(fs.readFileSync(p.review, 'utf8'))
        : [];
      const reviewExplicit = reviewDecisions.filter((decision) => decision.explicit !== false).length;
      if (reviewExplicit) {
        await cmdReview(cwd, { _: ['review'], collect: true });
      } else if (!exists(p.decisions)) {
        throw new Error('Content Loop is waiting for an explicit marketing review decision');
      }

      active = readActiveState(cwd, config, p);
      let results: ApplyResult[] = [];
      if (active.set.proposals.some((proposal) => proposal.status === 'approved')) {
        results = cmdApply(cwd, { _: ['apply'], 'use-decisions': true });
      }
      active = readActiveState(cwd, config, p);
      return marketingSnapshot(
        cwd,
        active.set,
        active.inventory,
        explicitDecisionCount(p, active.set),
        results,
      );
    },
    openReview: async () => {
      const config = loadConfig(cwd);
      const p = paths(cwd, config);
      const { set } = readActiveState(cwd, config, p);
      if (set.proposals.length) {
        await cmdReview(cwd, {
          _: ['review'],
          ui: true,
          ...(flags.port ? { port: flags.port } : {}),
        });
      }
    },
  };
}

function marketingSnapshot(
  cwd: string,
  set: ProposalSet,
  inventory: Inventory,
  explicitDecisions: number,
  results: ApplyResult[] = [],
): ContentMarketingSnapshot {
  const config = loadConfig(cwd);
  const p = paths(cwd, config);
  const handoff = readJsonStrict<{
    schemaVersion?: unknown;
    selection?: unknown;
    unresolved?: { key?: unknown }[];
  }>(p.handoff);
  const byStatus = (status: ProposalSet['proposals'][number]['status']): number =>
    set.proposals.filter((proposal) => proposal.status === status).length;
  const handoffCompatible = (
    handoff.schemaVersion === 1
    && JSON.stringify(handoff.selection) === JSON.stringify(
      set.selection ? handoffSelection(set.selection) : undefined,
    )
  );
  return {
    runId: inventory.runId,
    selectedKeys: [...(set.selection?.resolvedKeys ?? [])],
    proposals: set.proposals.length,
    pending: byStatus('pending'),
    approved: byStatus('approved'),
    rejected: byStatus('rejected'),
    applied: byStatus('applied'),
    failed: Math.max(byStatus('failed'), results.filter((result) => !result.ok).length),
    explicitDecisions,
    handoffCompatible,
    unresolvedKeys: Array.isArray(handoff.unresolved)
      ? handoff.unresolved
        .map((entry) => entry.key)
        .filter((key): key is string => typeof key === 'string')
      : [],
  };
}

function explicitDecisionCount(
  p: ReturnType<typeof paths>,
  set: ProposalSet,
): number {
  if (!set.proposals.length) return 1;
  let markdown = 0;
  if (exists(p.review)) {
    markdown = collectReview(fs.readFileSync(p.review, 'utf8'))
      .filter((decision) => decision.explicit !== false)
      .length;
  }
  let ledger = 0;
  if (exists(p.decisions)) {
    const decisions = readJsonStrict<DecisionSet>(p.decisions);
    ledger = Array.isArray(decisions.decisions) ? decisions.decisions.length : 0;
  }
  return Math.max(markdown, ledger);
}

function previewContentSelection(cwd: string, flags: Flags): ContentSelection {
  const config = loadConfig(cwd);
  const scope = resolveCatalogueScope(cwd, config);
  const scan = scanResolvedCatalogue(cwd, scope);
  const filter = normalizeContentFilter({
    types: commaList(flags.types),
    groups: [...commaList(flags.groups), ...commaList(flags.categories)],
    keys: commaList(flags.keys),
  });
  return resolveContentSelection(scan.items, filter, targetLocales(cwd, flags));
}

function targetLocales(cwd: string, flags: Flags): string[] {
  const file = path.join(cwd, 'language-loop.config.json');
  if (!exists(file)) {
    throw new Error(
      'Content Loop needs language-loop.config.json to resolve every target language. '
      + 'Run Language Loop setup/extraction first.',
    );
  }
  const raw = readJsonStrict<{
    sourceLocale?: unknown;
    locales?: unknown;
  }>(file);
  if (
    typeof raw.sourceLocale !== 'string'
    || !Array.isArray(raw.locales)
    || !raw.locales.every((locale) => typeof locale === 'string')
  ) {
    throw new Error('language-loop.config.json must declare sourceLocale and locales');
  }
  const configured = raw.locales.filter((locale) => locale !== raw.sourceLocale);
  if (!configured.length) {
    throw new Error('Language Loop has no configured target languages for Content Loop');
  }
  const requested = commaList(flags.locales);
  if (!requested.length) return configured;
  const unknown = requested.filter((locale) => !configured.includes(locale));
  if (unknown.length) {
    throw new Error(`Target languages are not configured in Language Loop: ${unknown.join(', ')}`);
  }
  return requested;
}

function assertRequestedSelectionUnchanged(
  flags: Flags,
  active: ContentSelection,
): void {
  if (selectionFlagsPresent(flags)) {
    const requested = normalizeContentFilter({
      types: commaList(flags.types),
      groups: [...commaList(flags.groups), ...commaList(flags.categories)],
      keys: commaList(flags.keys),
    });
    if (JSON.stringify(requested) !== JSON.stringify(active.filter)) {
      throw new Error('Content Loop filters differ from the active run; use --restart to change them');
    }
  }
  const locales = commaList(flags.locales);
  if (locales.length && JSON.stringify([...locales].sort()) !== JSON.stringify(active.targetLocales)) {
    throw new Error('Content Loop target languages differ from the active run; use --restart to change them');
  }
}

function selectionFlagsPresent(flags: Flags): boolean {
  return ['types', 'groups', 'categories', 'keys'].some((key) => flags[key] !== undefined);
}

function languageModulePath(flags: Flags): string | undefined {
  if (typeof flags['language-module'] === 'string') return flags['language-module'];
  if (process.env.LANGUAGE_LOOP_MODULE) return process.env.LANGUAGE_LOOP_MODULE;
  if (process.env.LANGUAGE_LOOP_REPO) {
    return path.join(process.env.LANGUAGE_LOOP_REPO, 'dist', 'index.js');
  }
  return undefined;
}

function commaList(value: string | boolean | string[] | undefined): string[] {
  if (value === undefined || value === false) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((candidate) => typeof candidate === 'string' ? candidate.split(',') : [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

function renderContentPlan(selection: ContentSelection, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(selection, null, 2));
    return;
  }
  log.title('Content Loop plan');
  table([
    ['types', selection.filter.types.join(', ') || 'all'],
    ['groups/categories', selection.filter.groups.join(', ') || 'all'],
    ['explicit keys', selection.filter.keys.join(', ') || 'all'],
    ['selected messages', String(selection.resolvedKeys.length)],
    ['target languages', selection.targetLocales.join(', ')],
  ]);
  log.blank();
  for (const key of selection.resolvedKeys) log.dim(`  ${key}`);
}

function renderContentStatus(state: ContentLoopState, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  log.title('Content Loop status');
  table([
    ['phase', state.phase],
    ['content run', state.contentRunId],
    ['marketing run', state.marketingRunId ?? 'not started'],
    ['types', state.selection.filter.types.join(', ') || 'all'],
    ['groups/categories', state.selection.filter.groups.join(', ') || 'all'],
    ['explicit keys', state.selection.filter.keys.join(', ') || 'all'],
    ['selected messages', String(state.selection.resolvedKeys.length)],
    ['target languages', state.selection.targetLocales.join(', ')],
    ['marketing proposals', String(state.marketing.proposals)],
    ['marketing pending', String(state.marketing.pending)],
    ['marketing applied', String(state.marketing.applied)],
  ]);
  if (state.language) {
    log.blank();
    log.title('Translation progress');
    table(state.language.progress.map((row) => [
      row.locale,
      `${row.accepted}/${row.total} accepted · ${row.pending} pending · ${row.rework} rework · ${row.needsHuman} human`,
    ]));
  }
  if (state.error) {
    log.blank();
    log.warn(state.error);
  }
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

  Reads the configured source catalogue, diagnoses copy, and ships nothing
  until a human approves it.
  Reads and writes only source-catalogue messages; never accesses application code or target locales.

${c.bold('Commands')}

  ${c.cyan('install')}            add the loop to every coding agent in this repo
    --list             show supported agents
    --all              install for all of them, detected or not
    --agents a,b       pick specific ones

  ${c.cyan('init')}               create marketing-loop.config.json
  ${c.cyan('scan')}               inspect every configured source catalogue message
  ${c.cyan('propose')}            generate rewrites + the agent brief
    --llm              also ask an API model (needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
    --max 30           cap the number of proposals
  ${c.cyan('brief')}              regenerate .marketing-loop/brief.md only
  ${c.cyan('import')}             validate agent-output.json into the active run
  ${c.cyan('review')}             write review.md for approval
    --ui               open the approval canvas in a browser instead
    --port 7788        canvas port
    --collect          read ticked decisions back out of review.md
  ${c.cyan('apply')}              write approved changes to the source catalogue
    --dry-run          show what would change
  ${c.cyan('revert')}             restore the last applied run
  ${c.cyan('measure')}            close the loop with baseline → variant → deploy → result
    baseline           record the pre-change metric and source
    variant            bind an applied proposal to a baseline
    deploy             mark when and where the variant shipped
    result             compare the post-change metric and record keep/revert/inconclusive
    status             show active measurement ledgers
  ${c.cyan('status')}             where the loop currently stands
  ${c.cyan('content')}            one resumable marketing → translation Content Loop
    plan               preview the exact message and language selection
    status             show durable stage and per-language progress
    --types cta,...     include only CTAs, headlines, buttons, navigation, or labels
    --groups hero,...   include canonical message groups/categories
    --keys a.b,...      include exact canonical catalogue keys
    --locales de,fr     use this configured target-language subset (default: all)
    --ui                open the mandatory marketing review canvas
    --llm               translate/retry until the judge accepts every selected language
    --restart           start a new Content run and change its selection
  ${c.cyan('run')}                propose, then open the canvas

${c.bold('Typical first run')}

  npx marketing-loop install
  npx marketing-loop init
  npx marketing-loop scan
  npx marketing-loop content --ui

${c.bold('Inside a coding agent')}

  Run ${c.cyan('propose')}, then point the agent at ${c.cyan('.marketing-loop/brief.md')}.
  The agent writes agent-output.json; import validates it, then a human approves it.
`);
}

function warnDeprecatedScopeOptions(cwd: string): void {
  if (hasDeprecatedScopeOptions(cwd)) {
    log.warn('marketing-loop 0.5 ignores "include" and "protectedFiles"; source catalogue scope is enforced.');
  }
}

/* ----------------------------------------------------------------- helpers */

function requiredFlag(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`--${key} is required`);
  }
  return value.trim();
}

function requiredNumberFlag(flags: Flags, key: string): number {
  const value = Number(requiredFlag(flags, key));
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
}

function optionalNumberFlag(flags: Flags, key: string, fallback: number): number {
  if (flags[key] === undefined) return fallback;
  return requiredNumberFlag(flags, key);
}

function optionalIntegerFlag(flags: Flags, key: string): number | undefined {
  if (flags[key] === undefined) return undefined;
  const value = requiredNumberFlag(flags, key);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return value;
}

function optionalTimestamp(value: string | boolean | string[] | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('--at must be an ISO timestamp');
  }
  return new Date(value).toISOString();
}

function optionalUnit(value: string | boolean | string[] | undefined): '%' | 'count' | 'seconds' | 'ratio' {
  const unit = value === undefined ? '%' : value;
  if (unit !== '%' && unit !== 'count' && unit !== 'seconds' && unit !== 'ratio') {
    throw new Error('--unit must be %, count, seconds, or ratio');
  }
  return unit;
}

function optionalDirection(
  value: string | boolean | string[] | undefined,
  metric: string,
): MeasurementDirection {
  if (value === 'increase' || value === 'decrease') return value;
  if (value !== undefined) throw new Error('--direction must be increase or decrease');
  return /bounce|dropoff|drop_off|exit|abandon|latency|duration|time_to/i.test(metric)
    ? 'decrease'
    : 'increase';
}

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

## Benchmarks

Configure project-specific thresholds in \`marketing-loop.config.json\` under
\`benchmarks\`. Each metric needs both a numeric \`value\` and a human-readable
\`source\`, for example \`"GA4 signup funnel, trailing 28 days"\`. Unconfigured
metrics use defaults explicitly labelled as marketing-loop heuristics in the
generated evidence.

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
