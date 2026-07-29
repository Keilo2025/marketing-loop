import type {
  AgentOutput,
  AgentProposal,
  Inventory,
  LoopConfig,
  Proposal,
  ProposalSet,
} from '../types.js';
import {
  ACTIVE_STATE_SCHEMA_ERROR,
  DEFAULT_SURFACES,
  STATE_SCHEMA_VERSION,
} from '../types.js';
import { shortHash } from '../util/fsx.js';
import { inferSurfaceFromKey } from './catalogue-extract.js';
import { applyGuardrails } from './guardrails.js';
import { PRINCIPLES } from './psychology.js';
import { linkSiblings } from './siblings.js';

export interface ImportRejection {
  index: number;
  copyId?: string;
  reason: string;
}

export interface ImportBlock {
  index: number;
  copyId: string;
  reasons: string[];
}

export interface ImportResult {
  set: ProposalSet;
  accepted: number;
  blocked: ImportBlock[];
  rejected: ImportRejection[];
}

export function parseAgentOutput(raw: string, file = 'agent-output.json'): AgentOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${reason}`);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${file}: expected an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== STATE_SCHEMA_VERSION) {
    if (object.schemaVersion === STATE_SCHEMA_VERSION - 1) {
      throw new Error(`Invalid ${file}: schema v4 may target code; schemaVersion must be 5`);
    }
    throw new Error(`Invalid ${file}: schemaVersion must be 5`);
  }
  if (typeof object.runId !== 'string' || !object.runId) {
    throw new Error(`Invalid ${file}: runId must be a non-empty string`);
  }
  if (typeof object.inventoryDigest !== 'string' || !object.inventoryDigest) {
    throw new Error(`Invalid ${file}: inventoryDigest must be a non-empty string`);
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    runId: object.runId,
    inventoryDigest: object.inventoryDigest,
    proposals: parseAgentProposals(object.proposals, file),
  };
}

export function parseAgentProposals(
  entries: unknown,
  file = 'agent-output.json',
): AgentProposal[] {
  if (!Array.isArray(entries)) {
    throw new Error(`Invalid ${file}: proposals must be an array`);
  }
  return entries.map((entry, index) => parseAgentProposal(entry, file, index));
}

function parseAgentProposal(entry: unknown, file: string, index: number): AgentProposal {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Invalid ${file}: proposals[${index}] must be an object`);
  }
  const value = entry as Record<string, unknown>;
  const required = (
    key: 'copyId' | 'after' | 'rationale' | 'problemSolved',
    max: number,
  ): string => {
    const candidate = value[key];
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > max) {
      throw new Error(
        `Invalid ${file}: proposals[${index}].${key} must be a non-empty string up to ${max} characters`,
      );
    }
    return candidate;
  };
  const strings = (key: 'alternatives' | 'principles' | 'evidence', maxItems: number, maxLength: number) => {
    const candidate = value[key];
    if (!Array.isArray(candidate) || candidate.length > maxItems) {
      throw new Error(`Invalid ${file}: proposals[${index}].${key} must contain at most ${maxItems} strings`);
    }
    if (!candidate.every((item) => typeof item === 'string' && item.length > 0 && item.length <= maxLength)) {
      throw new Error(`Invalid ${file}: proposals[${index}].${key} contains an invalid string`);
    }
    return candidate as string[];
  };

  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid ${file}: proposals[${index}].confidence must be between 0 and 1`);
  }

  return {
    copyId: required('copyId', 200),
    after: required('after', 1000),
    alternatives: strings('alternatives', 5, 1000),
    rationale: required('rationale', 4000),
    problemSolved: required('problemSolved', 2000),
    principles: strings('principles', 20, 100),
    evidence: strings('evidence', 20, 2000),
    confidence,
  };
}

export function importAgentOutput(
  set: ProposalSet,
  inventory: Inventory,
  output: AgentOutput,
  config: LoopConfig,
  author: 'agent' | 'llm' = 'agent',
): ImportResult {
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    inventory.schemaVersion !== STATE_SCHEMA_VERSION ||
    set.scopeDigest !== inventory.scopeDigest ||
    set.sourceLocale !== inventory.sourceLocale
  ) {
    throw new Error(ACTIVE_STATE_SCHEMA_ERROR);
  }
  const activeRun = set.runId ?? inventory.runId;
  const activeDigest = set.inventoryDigest ?? inventory.inventoryDigest;
  if (
    output.runId !== activeRun ||
    output.runId !== inventory.runId ||
    output.inventoryDigest !== activeDigest ||
    output.inventoryDigest !== inventory.inventoryDigest
  ) {
    throw new Error('agent output does not match the active run and inventory');
  }

  const knownPrinciples = new Set(PRINCIPLES.map((principle) => principle.id));
  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const incomingCopyIds = new Set(output.proposals.map((proposal) => proposal.copyId));
  const retained = set.proposals.filter(
    (proposal) => proposal.author !== author || !incomingCopyIds.has(proposal.copyId),
  );
  const accepted: Proposal[] = [];
  const blocked: ImportBlock[] = [];
  const rejected: ImportRejection[] = [];
  const seen = new Set<string>();
  const configuredSurfaces = new Set(config.surfaces ?? DEFAULT_SURFACES);
  const selectedKeys = set.selection
    ? new Set(set.selection.resolvedKeys)
    : undefined;

  for (const [index, incoming] of output.proposals.entries()) {
    if (seen.has(incoming.copyId)) {
      rejected.push({ index, copyId: incoming.copyId, reason: 'duplicate copyId in agent output' });
      continue;
    }
    seen.add(incoming.copyId);

    const item = itemById.get(incoming.copyId);
    if (!item) {
      rejected.push({ index, copyId: incoming.copyId, reason: 'copyId is not in the active inventory' });
      continue;
    }
    if (selectedKeys && !selectedKeys.has(item.catalogueKey)) {
      rejected.push({
        index,
        copyId: incoming.copyId,
        reason: `copyId ${incoming.copyId} is outside the active Content Loop selection`,
      });
      continue;
    }
    const canonicalSurface = inferSurfaceFromKey(item.catalogueKey);
    if (!configuredSurfaces.has(canonicalSurface)) {
      rejected.push({
        index,
        copyId: incoming.copyId,
        reason: `surface ${canonicalSurface} is not configured for marketing proposals`,
      });
      continue;
    }
    const invalidPrinciple = incoming.principles.find((principle) => !knownPrinciples.has(principle));
    if (invalidPrinciple) {
      rejected.push({
        index,
        copyId: incoming.copyId,
        reason: `unknown principle: ${invalidPrinciple}`,
      });
      continue;
    }
    if (retained.length + accepted.length >= config.maxProposals) {
      rejected.push({ index, copyId: incoming.copyId, reason: 'maxProposals limit reached' });
      continue;
    }

    const proposal: Proposal = {
      id: shortHash('proposal', activeRun, incoming.copyId, incoming.after, author),
      copyId: incoming.copyId,
      catalogueKey: item.catalogueKey,
      sourceLocale: item.sourceLocale,
      scopeDigest: item.scopeDigest ?? inventory.scopeDigest,
      file: item.file,
      line: item.line,
      kind: item.kind,
      before: item.text,
      after: incoming.after,
      alternatives: [...new Set(incoming.alternatives)].filter((value) => value !== incoming.after),
      rationale: incoming.rationale,
      problemSolved: incoming.problemSolved,
      principles: [...new Set(incoming.principles)],
      evidence: [...incoming.evidence],
      confidence: incoming.confidence,
      status: 'pending',
      author,
    };

    const guarded = applyGuardrails([proposal], config);
    if (guarded.blocked.length) {
      blocked.push({
        index,
        copyId: incoming.copyId,
        reasons: guarded.blocked[0]?.hits.map((hit) => `${hit.rule}: ${hit.message}`) ?? [],
      });
      continue;
    }
    accepted.push(guarded.kept[0] as Proposal);
  }

  return {
    set: {
      ...set,
      schemaVersion: STATE_SCHEMA_VERSION,
      runId: activeRun,
      inventoryDigest: activeDigest,
      proposals: linkSiblings([...retained, ...accepted]),
    },
    accepted: accepted.length,
    blocked,
    rejected,
  };
}
