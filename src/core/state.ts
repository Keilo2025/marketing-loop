import fs from 'node:fs';
import path from 'node:path';
import type {
  DecisionSet,
  Proposal,
  ProposalDecision,
  ProposalSet,
} from '../types.js';
import { ACTIVE_STATE_SCHEMA_ERROR, STATE_SCHEMA_VERSION } from '../types.js';
import { exists, hashText, readJsonStrict, writeText } from '../util/fsx.js';
import { collectReview, type Decision } from './review.js';

const RUN_FILES = [
  'inventory.json',
  'product.json',
  'findings.json',
  'behavior.json',
  'brief.md',
  'agent-output.json',
  'proposals.json',
  'handoff.json',
  'review.md',
  'decisions.json',
  'applied.json',
  'report.md',
];

export function isSafeRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

/** Archive the active run before a new scan replaces its state files. */
export function archiveActiveRun(outDir: string): string | null {
  const inventoryPath = path.join(outDir, 'inventory.json');
  if (!exists(inventoryPath)) return null;
  const inventory = readJsonStrict<{ runId?: unknown }>(inventoryPath);
  const runId = inventory.runId === undefined
    ? `legacy-${Date.now()}`
    : inventory.runId;
  if (!isSafeRunId(runId)) {
    throw new Error('cannot archive active run: inventory has an unsafe runId');
  }
  const destination = path.join(outDir, 'history', runId);
  for (const name of RUN_FILES) {
    const source = path.join(outDir, name);
    if (!exists(source)) continue;
    writeText(path.join(destination, name), fs.readFileSync(source, 'utf8'));
  }
  return destination;
}

/** Rotate all active state only after it has been copied to run history. */
export function rotateActiveRun(outDir: string): string | null {
  const destination = archiveActiveRun(outDir);
  if (!destination) return null;
  for (const name of RUN_FILES) {
    const active = path.join(outDir, name);
    if (exists(active)) fs.rmSync(active);
  }
  return destination;
}

/**
 * Hash everything the reviewer was asked to approve, plus the exact final
 * text. Mutable workflow fields are deliberately excluded.
 */
export function proposalDigest(proposal: Proposal, finalText: string): string {
  return hashText(JSON.stringify({
    id: proposal.id,
    copyId: proposal.copyId,
    catalogueKey: proposal.catalogueKey,
    sourceLocale: proposal.sourceLocale,
    scopeDigest: proposal.scopeDigest,
    file: proposal.file,
    line: proposal.line,
    kind: proposal.kind,
    before: proposal.before,
    after: proposal.after,
    alternatives: proposal.alternatives,
    rationale: proposal.rationale,
    problemSolved: proposal.problemSolved,
    principles: proposal.principles,
    evidence: proposal.evidence,
    confidence: proposal.confidence,
    author: proposal.author,
    siblings: proposal.siblings ?? [],
    localeWarning: proposal.localeWarning ?? '',
    warnings: proposal.warnings ?? [],
    finalText,
  }));
}

export function collectDecisionSet(set: ProposalSet, markdown: string): DecisionSet {
  requireIdentity(set);
  const marker = /<!--\s*marketing-loop-run:([^:\s]+):([^:\s]+)\s*-->/.exec(markdown);
  if (
    !marker ||
    marker[1] !== set.runId ||
    marker[2] !== set.inventoryDigest
  ) {
    throw new Error('review file belongs to a different run or inventory; regenerate it before approving');
  }
  return decisionSetFrom(set, collectReview(markdown), 'markdown');
}

export function decisionSetFrom(
  set: ProposalSet,
  decisions: Decision[],
  source: ProposalDecision['source'],
): DecisionSet {
  requireIdentity(set);
  const expanded = expandDecisions(set, decisions);
  const recorded: ProposalDecision[] = [];

  for (const proposal of set.proposals) {
    const decision = expanded.get(proposal.id);
    if (!decision) continue;
    const finalText = decision.approved
      ? (decision.finalText?.trim() || proposal.after)
      : proposal.after;
    recorded.push({
      proposalId: proposal.id,
      proposalDigest: proposalDigest(proposal, finalText),
      decision: decision.approved ? 'approved' : 'rejected',
      finalText,
      source,
      decidedAt: new Date().toISOString(),
    });
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    scopeDigest: set.scopeDigest,
    sourceLocale: set.sourceLocale,
    runId: set.runId,
    inventoryDigest: set.inventoryDigest,
    decisions: recorded,
  };
}

/**
 * Returns every reason the ledger is not valid for the active proposal set.
 * The apply stage fails the entire batch when this list is non-empty.
 */
export function validateDecisionSet(set: ProposalSet, ledger: DecisionSet): string[] {
  const errors: string[] = [];
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    ledger.schemaVersion !== STATE_SCHEMA_VERSION ||
    ledger.scopeDigest !== set.scopeDigest ||
    ledger.sourceLocale !== set.sourceLocale
  ) errors.push(ACTIVE_STATE_SCHEMA_ERROR);
  if (!set.runId || ledger.runId !== set.runId) errors.push('decision runId does not match the active run');
  if (!set.inventoryDigest || ledger.inventoryDigest !== set.inventoryDigest) {
    errors.push('decision inventory digest does not match the active inventory');
  }

  const proposals = new Map(set.proposals.map((proposal) => [proposal.id, proposal]));
  const seen = new Set<string>();
  for (const decision of ledger.decisions) {
    if (seen.has(decision.proposalId)) {
      errors.push(`duplicate decision for proposal ${decision.proposalId}`);
      continue;
    }
    seen.add(decision.proposalId);
    const proposal = proposals.get(decision.proposalId);
    if (!proposal) {
      errors.push(`decision references unknown proposal ${decision.proposalId}`);
      continue;
    }
    if (decision.proposalDigest !== proposalDigest(proposal, decision.finalText)) {
      errors.push(`proposal digest mismatch for ${decision.proposalId}`);
    }
  }
  return errors;
}

function requireIdentity(
  set: ProposalSet,
): void {
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    !set.scopeDigest ||
    !set.sourceLocale ||
    !set.runId ||
    !set.inventoryDigest
  ) {
    throw new Error(ACTIVE_STATE_SCHEMA_ERROR);
  }
  if (!set.runId || !set.inventoryDigest) {
    throw new Error('proposal set is missing its run identity');
  }
}

function expandDecisions(
  set: ProposalSet,
  decisions: Decision[],
): Map<string, { approved: boolean; finalText?: string }> {
  const byId = new Map(decisions.map((decision) => [decision.proposalId, decision]));
  const explicit = new Set(
    decisions.filter((decision) => decision.explicit !== false).map((decision) => decision.proposalId),
  );
  const carried = new Map<string, { approved: boolean; finalText?: string }>();

  for (const decision of decisions) {
    if (!decision.fanOut) continue;
    const lead = set.proposals.find((proposal) => proposal.id === decision.proposalId);
    for (const siblingId of lead?.siblings ?? []) {
      if (explicit.has(siblingId) || carried.has(siblingId)) continue;
      carried.set(siblingId, {
        approved: decision.approved,
        finalText: decision.finalText,
      });
    }
  }

  const expanded = new Map<string, { approved: boolean; finalText?: string }>();
  for (const proposal of set.proposals) {
    const carriedDecision = carried.get(proposal.id);
    const direct = carriedDecision ? undefined : byId.get(proposal.id);
    const decision = direct ?? carriedDecision;
    if (decision) expanded.set(proposal.id, decision);
  }
  return expanded;
}
