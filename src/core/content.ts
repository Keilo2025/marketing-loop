import { randomUUID } from 'node:crypto';
import type {
  ContentLanguageAdapter,
  ContentLanguageProgress,
  ContentLanguageSnapshot,
  ContentLoopState,
  ContentMarketingAdapter,
  ContentMarketingSnapshot,
  ContentSelection,
} from '../types.js';
import { exists, readJsonStrict, writeJson } from '../util/fsx.js';

export interface RunContentLoopInput {
  stateFile: string;
  selection: ContentSelection;
  marketing: ContentMarketingAdapter;
  language: ContentLanguageAdapter;
  executeLanguage: boolean;
  restart?: boolean;
  openReview?: boolean;
}

export function readContentLoopState(file: string): ContentLoopState | null {
  if (!exists(file)) return null;
  const value = readJsonStrict<unknown>(file);
  assertContentLoopState(value);
  return value;
}

export async function runContentLoop(
  input: RunContentLoopInput,
): Promise<ContentLoopState> {
  assertSelection(input.selection);
  let state = input.restart ? null : readContentLoopState(input.stateFile);

  // A state file still in phase 'marketing' means the previous process died
  // inside marketing.start() before any marketing run was recorded. There is
  // nothing to resume — start the marketing stage over rather than falling
  // through to translation with copy no human has reviewed.
  if (state?.phase === 'marketing') state = null;

  if (!state) {
    state = initialState(input.selection);
    persist(input.stateFile, state);
    try {
      const marketing = await input.marketing.start(input.selection);
      assertMarketingSelection(marketing, input.selection);
      state.marketing = marketing;
      state.marketingRunId = marketing.runId;
      state.phase = 'waiting-review';
      delete state.error;
      touch(input.stateFile, state);
      if (input.openReview) await input.marketing.openReview?.();
      return state;
    } catch (error) {
      return block(input.stateFile, state, message(error), false);
    }
  }

  if (JSON.stringify(state.selection) !== JSON.stringify(input.selection)) {
    throw new Error('Content Loop selection differs from the active run; use restart to change filters or locales');
  }
  if (state.phase === 'complete') return state;
  if (state.phase === 'blocked' && !state.retryable) return state;

  if (state.phase === 'waiting-review') {
    let marketing: ContentMarketingSnapshot;
    try {
      marketing = await input.marketing.inspect();
      assertMarketingSelection(marketing, input.selection);
    } catch (error) {
      return block(input.stateFile, state, message(error), false);
    }
    state.marketing = marketing;
    if (!marketing.explicitDecisions) {
      delete state.error;
      touch(input.stateFile, state);
      if (input.openReview) await input.marketing.openReview?.();
      return state;
    }

    try {
      marketing = await input.marketing.collectAndApply();
      assertMarketingSelection(marketing, input.selection);
    } catch (error) {
      return block(input.stateFile, state, message(error), false);
    }
    state.marketing = marketing;
    if (marketing.failed) {
      return block(
        input.stateFile,
        state,
        `${marketing.failed} marketing proposal(s) failed safe apply`,
        false,
      );
    }
    if (!marketing.handoffCompatible || marketing.unresolvedKeys.length) {
      return block(
        input.stateFile,
        state,
        'marketing handoff must be compatible and resolved before translation',
        false,
      );
    }
    state.phase = 'language';
    delete state.error;
    delete state.retryable;
    touch(input.stateFile, state);
  }

  if (state.phase === 'language-ready' && !input.executeLanguage) return state;

  const onProgress = (progress: ContentLanguageProgress[]): void => {
    const previous = state?.language;
    state!.phase = 'language';
    state!.language = {
      compatible: previous?.compatible ?? true,
      status: 'running',
      adoptedSourceKeys: previous?.adoptedSourceKeys ?? [],
      pending: progress.reduce((sum, row) => sum + row.pending, 0),
      applied: progress.reduce((sum, row) => sum + row.accepted, 0),
      needsHuman: progress.reduce((sum, row) => sum + row.needsHuman, 0),
      marketingBlocked: previous?.marketingBlocked ?? 0,
      progress,
    };
    touch(input.stateFile, state!);
  };

  let language: ContentLanguageSnapshot;
  try {
    language = await input.language.run({
      execute: input.executeLanguage,
      keys: [...input.selection.resolvedKeys],
      locales: [...input.selection.targetLocales],
      onProgress,
    });
  } catch (error) {
    return block(input.stateFile, state, message(error), true);
  }
  state.language = language;
  if (language.retryable) state.retryable = true;
  else delete state.retryable;
  if (language.error) state.error = language.error;
  else delete state.error;

  if (!language.compatible || language.marketingBlocked) {
    return block(
      input.stateFile,
      state,
      language.error ?? 'Language Loop rejected the marketing handoff',
      Boolean(language.retryable),
    );
  }
  if (language.status === 'ready') {
    state.phase = 'language-ready';
    touch(input.stateFile, state);
    return state;
  }
  if (language.status === 'needs-human') {
    state.phase = 'needs-human';
    touch(input.stateFile, state);
    return state;
  }
  if (language.status === 'blocked') {
    return block(
      input.stateFile,
      state,
      language.error ?? 'Language Loop paused before all selected languages were accepted',
      Boolean(language.retryable),
    );
  }
  if (language.status === 'complete') {
    const outstanding = outstandingLanguages(input.selection, language);
    if (outstanding.length) {
      return block(
        input.stateFile,
        state,
        `Language Loop reported complete with outstanding selected languages: ${outstanding.join(', ')}`,
        false,
      );
    }
    state.phase = 'complete';
    delete state.error;
    delete state.retryable;
    touch(input.stateFile, state);
    return state;
  }

  state.phase = 'language';
  touch(input.stateFile, state);
  return state;
}

function initialState(selection: ContentSelection): ContentLoopState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    phase: 'marketing',
    contentRunId: randomUUID(),
    startedAt: now,
    updatedAt: now,
    selection: structuredClone(selection),
    marketing: {
      runId: '',
      selectedKeys: [...selection.resolvedKeys],
      proposals: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      applied: 0,
      failed: 0,
      explicitDecisions: 0,
      handoffCompatible: false,
      unresolvedKeys: [],
    },
  };
}

function outstandingLanguages(
  selection: ContentSelection,
  language: ContentLanguageSnapshot,
): string[] {
  const byLocale = new Map(language.progress.map((row) => [row.locale, row]));
  return selection.targetLocales.filter((locale) => {
    const row = byLocale.get(locale);
    return (
      !row
      || row.total !== selection.resolvedKeys.length
      || row.accepted !== row.total
      || row.pending !== 0
      || row.rework !== 0
      || row.needsHuman !== 0
    );
  });
}

function assertSelection(selection: ContentSelection): void {
  if (!selection.resolvedKeys.length) throw new Error('Content Loop needs at least one selected key');
  if (!selection.targetLocales.length) throw new Error('Content Loop needs at least one target locale');
  if (
    new Set(selection.resolvedKeys).size !== selection.resolvedKeys.length
    || new Set(selection.targetLocales).size !== selection.targetLocales.length
  ) {
    throw new Error('Content Loop selection keys and locales must be unique');
  }
}

function assertMarketingSelection(
  snapshot: ContentMarketingSnapshot,
  selection: ContentSelection,
): void {
  if (JSON.stringify(snapshot.selectedKeys) !== JSON.stringify(selection.resolvedKeys)) {
    throw new Error('marketing adapter selected keys do not match the active Content Loop selection');
  }
}

function assertContentLoopState(value: unknown): asserts value is ContentLoopState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Content Loop state must be an object');
  }
  const state = value as Partial<ContentLoopState>;
  if (state.schemaVersion !== 1) throw new Error('Content Loop state schemaVersion must be 1');
  if (
    typeof state.phase !== 'string'
    || !['marketing', 'waiting-review', 'language-ready', 'language', 'complete', 'needs-human', 'blocked'].includes(state.phase)
  ) {
    throw new Error('Content Loop state has an invalid phase');
  }
  if (!state.selection || !state.marketing) {
    throw new Error('Content Loop state is missing selection or marketing status');
  }
  assertSelection(state.selection);
}

function block(
  file: string,
  state: ContentLoopState,
  error: string,
  retryable: boolean,
): ContentLoopState {
  state.phase = 'blocked';
  state.error = error;
  if (retryable) state.retryable = true;
  else delete state.retryable;
  touch(file, state);
  return state;
}

function touch(file: string, state: ContentLoopState): void {
  state.updatedAt = new Date().toISOString();
  persist(file, state);
}

function persist(file: string, state: ContentLoopState): void {
  writeJson(file, state);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
