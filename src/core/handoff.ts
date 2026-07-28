import type {
  CatalogueScope,
  HandoffEntry,
  Inventory,
  MarketingHandoff,
  ProposalSet,
} from '../types.js';
import { hashText, writeJson } from '../util/fsx.js';

/** Derive a portable list of unresolved source-catalogue keys for a consumer. */
export function deriveHandoff(
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): MarketingHandoff {
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  const unresolved: HandoffEntry[] = set.proposals
    .filter((proposal): proposal is typeof proposal & { status: HandoffEntry['status'] } =>
      proposal.status === 'pending' || proposal.status === 'approved',
    )
    .map((proposal) => {
      const item = items.get(proposal.copyId);
      if (!item) {
        throw new Error(`proposal ${proposal.id} cannot resolve to an active catalogue item`);
      }
      return {
        key: item.catalogueKey,
        file: item.file,
        sourceHash: hashText(item.text),
        status: proposal.status,
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  return {
    schemaVersion: 1,
    marketingRunId: set.runId,
    scopeDigest: scope.scopeDigest,
    messagesDir: scope.messagesDir,
    sourceLocale: scope.sourceLocale,
    layout: scope.layout,
    unresolved,
  };
}

/** Atomically replace the consumer handoff with the active review state. */
export function writeHandoff(
  file: string,
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): MarketingHandoff {
  const handoff = deriveHandoff(set, inventory, scope);
  writeJson(file, handoff);
  return handoff;
}
