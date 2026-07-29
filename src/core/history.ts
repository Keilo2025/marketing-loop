import fs from 'node:fs';
import path from 'node:path';
import type {
  DecisionSet,
  Proposal,
  ProposalSet,
  ReviewHistory,
  ReviewHistoryEntry,
} from '../types.js';
import { exists, readJsonStrict } from '../util/fsx.js';

/**
 * Reconstruct durable reviewer feedback from archived runs.
 *
 * History is advisory: an incomplete legacy archive must not prevent a new
 * source-catalogue scan. Malformed runs are skipped, while valid decisions
 * from every other run remain available to the proposal engine and brief.
 */
export function loadReviewHistory(historyDir: string): ReviewHistory {
  if (!exists(historyDir)) return { entries: [] };

  let runNames: string[];
  try {
    runNames = fs.readdirSync(historyDir);
  } catch {
    return { entries: [] };
  }

  const entries: ReviewHistoryEntry[] = [];
  for (const runName of runNames.sort()) {
    const runDir = path.join(historyDir, runName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(runDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const proposalsPath = path.join(runDir, 'proposals.json');
    if (!exists(proposalsPath)) continue;

    let set: ProposalSet;
    try {
      set = readJsonStrict<ProposalSet>(proposalsPath);
    } catch {
      continue;
    }
    if (!Array.isArray(set.proposals)) continue;

    const decisions = readArchivedDecisions(path.join(runDir, 'decisions.json'));
    const byProposal = new Map(
      decisions.map((decision) => [decision.proposalId, decision]),
    );

    for (const proposal of set.proposals) {
      const recorded = byProposal.get(proposal.id);
      const decision = recorded?.decision
        ?? (proposal.status === 'approved' || proposal.status === 'applied'
          ? 'approved'
          : proposal.status === 'rejected'
            ? 'rejected'
            : undefined);
      if (!decision) continue;
      if (!isHistoricalProposal(proposal)) continue;

      const reason = cleanText(recorded?.reason ?? proposal.rejectionReason);
      entries.push({
        runId: typeof set.runId === 'string' && set.runId ? set.runId : runName,
        proposalId: proposal.id,
        copyId: proposal.copyId,
        catalogueKey: proposal.catalogueKey,
        before: proposal.before,
        proposed: proposal.after,
        finalText: cleanText(recorded?.finalText)
          ?? cleanText(proposal.edited)
          ?? proposal.after,
        decision,
        ...(reason ? { reason } : {}),
        decidedAt: cleanText(recorded?.decidedAt)
          ?? cleanText(set.generatedAt)
          ?? '',
        author: proposal.author,
      });
    }
  }

  entries.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  return { entries: entries.slice(0, 500) };
}

export function feedbackFor(
  history: ReviewHistory | undefined,
  proposal: Pick<Proposal, 'catalogueKey'> & { copyId?: string; id?: string },
): ReviewHistoryEntry[] {
  if (!history) return [];
  const copyId = proposal.copyId ?? proposal.id;
  return history.entries.filter((entry) =>
    entry.catalogueKey === proposal.catalogueKey
    || (!entry.catalogueKey && entry.copyId === copyId),
  );
}

function readArchivedDecisions(file: string): DecisionSet['decisions'] {
  if (!exists(file)) return [];
  try {
    const ledger = readJsonStrict<DecisionSet>(file);
    return Array.isArray(ledger.decisions) ? ledger.decisions : [];
  } catch {
    return [];
  }
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isHistoricalProposal(value: Proposal): boolean {
  return Boolean(
    value
    && typeof value.id === 'string'
    && typeof value.copyId === 'string'
    && typeof value.catalogueKey === 'string'
    && typeof value.before === 'string'
    && typeof value.after === 'string'
    && ['engine', 'agent', 'llm'].includes(value.author),
  );
}
