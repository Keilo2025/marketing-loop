import type {
  CatalogueScope,
  HandoffEntry,
  ContentHandoffSelection,
  ContentSelection,
  Inventory,
  MarketingHandoff,
  ProposalSet,
} from '../types.js';
import { STATE_SCHEMA_VERSION } from '../types.js';
import { hashText, writeJson } from '../util/fsx.js';
import { isCatalogueTarget } from './catalogue.js';
import { resolveContentSelection } from './filter.js';
import { digestInventoryItems } from './scan.js';

/** Serialize Marketing's filter vocabulary into the strict Language contract. */
export function handoffSelection(
  selection: ContentSelection,
): ContentHandoffSelection {
  return {
    filter: {
      categories: [],
      groups: [],
      keys: [...selection.resolvedKeys],
    },
    requestedFilter: {
      categories: [...selection.filter.types],
      groups: [...selection.filter.groups],
      keys: [...selection.filter.keys],
    },
    resolvedKeys: [...selection.resolvedKeys],
    targetLocales: [...selection.targetLocales],
  };
}

/** Derive a portable list of unresolved source-catalogue keys for a consumer. */
export function deriveHandoff(
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): MarketingHandoff {
  assertHandoffIdentity(set, inventory, scope);
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  const selection = set.selection
    ? resolveContentSelection(
      inventory.items,
      set.selection.filter,
      set.selection.targetLocales,
    )
    : undefined;
  if (
    selection
    && JSON.stringify(selection.resolvedKeys) !== JSON.stringify(set.selection?.resolvedKeys)
  ) {
    throw new Error('Content Loop selection does not match the active inventory');
  }
  const selectedKeys = selection ? new Set(selection.resolvedKeys) : undefined;
  for (const proposal of set.proposals) {
    const item = items.get(proposal.copyId);
    if (!item) {
      throw new Error(`proposal ${proposal.id} cannot resolve to an active catalogue item`);
    }
    if (
      proposal.catalogueKey !== item.catalogueKey ||
      proposal.file !== item.file ||
      proposal.sourceLocale !== item.sourceLocale ||
      proposal.scopeDigest !== (item.scopeDigest ?? inventory.scopeDigest) ||
      proposal.line !== item.line ||
      proposal.kind !== item.kind ||
      proposal.before !== item.text
    ) {
      throw new Error(`proposal ${proposal.id} target does not match its active catalogue item`);
    }
    if (selectedKeys && !selectedKeys.has(proposal.catalogueKey)) {
      throw new Error(`proposal ${proposal.id} is outside the Content Loop selection`);
    }
  }
  const unresolved: HandoffEntry[] = set.proposals
    .filter((proposal): proposal is typeof proposal & { status: HandoffEntry['status'] } =>
      proposal.status === 'pending' || proposal.status === 'approved',
    )
    .map((proposal) => {
      const item = items.get(proposal.copyId)!;
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
    ...(selection ? { selection: handoffSelection(selection) } : {}),
    unresolved,
  };
}

function assertHandoffIdentity(
  set: ProposalSet,
  inventory: Inventory,
  scope: CatalogueScope,
): void {
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    inventory.schemaVersion !== STATE_SCHEMA_VERSION
  ) {
    throw new Error('marketing handoff requires schema v5 proposal and inventory state');
  }
  if (set.runId !== inventory.runId) {
    throw new Error('marketing handoff proposal runId does not match the inventory');
  }
  if (set.inventoryDigest !== inventory.inventoryDigest) {
    throw new Error('marketing handoff proposal inventory digest does not match the inventory');
  }
  if (
    set.scopeDigest !== inventory.scopeDigest ||
    inventory.scopeDigest !== scope.scopeDigest
  ) {
    throw new Error('marketing handoff scope digest does not match the active state and resolved catalogue');
  }
  if (
    set.sourceLocale !== inventory.sourceLocale ||
    inventory.sourceLocale !== scope.sourceLocale
  ) {
    throw new Error('marketing handoff source locale does not match the active state and resolved catalogue');
  }
  if (
    digestInventoryItems(
      inventory.items,
      inventory.scopeDigest,
      inventory.sourceLocale,
    ) !== inventory.inventoryDigest
  ) {
    throw new Error('marketing handoff inventory digest does not match its contents');
  }

  const itemIds = new Set<string>();
  for (const item of inventory.items) {
    if (itemIds.has(item.id)) {
      throw new Error(`marketing handoff inventory contains duplicate copy id ${item.id}`);
    }
    itemIds.add(item.id);
    if (
      item.sourceLocale !== inventory.sourceLocale ||
      (item.scopeDigest ?? inventory.scopeDigest) !== inventory.scopeDigest
    ) {
      throw new Error(`inventory item ${item.id} identity does not match the active inventory`);
    }
    if (!isCatalogueTarget(scope, item.file)) {
      throw new Error(`inventory item ${item.id} is outside the resolved source catalogue`);
    }
  }
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
