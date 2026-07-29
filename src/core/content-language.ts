import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ContentLanguageAdapter,
  ContentLanguageProgress,
  ContentLanguageRunInput,
  ContentLanguageSnapshot,
} from '../types.js';

type AsyncFunction = (...args: unknown[]) => Promise<unknown>;
type AnyFunction = (...args: unknown[]) => unknown;

interface LanguageConfig {
  sourceLocale: string;
  locales: string[];
  ai: {
    translator: string;
    judge: string;
  };
}

interface LanguageTranslation {
  sourceHash?: string;
  status?: string;
}

interface LanguageEntry {
  sourceHash: string;
  translations: Record<string, LanguageTranslation>;
}

interface LanguageMemory {
  entries: Record<string, LanguageEntry>;
}

interface LanguageSummary {
  status: 'complete' | 'needs-human' | 'no-progress' | 'waiting-marketing';
  applied?: number;
  needsHuman?: number;
  marketingBlocked?: number;
}

interface LanguageHandoffState {
  compatible: boolean;
  unresolvedKeys: Set<string> | string[];
  error?: string;
}

interface LanguageModule {
  CONTENT_LOOP_API_VERSION?: unknown;
  requireConfig: AnyFunction;
  loadMemory: AnyFunction;
  saveMemory: AnyFunction;
  adoptCatalogEdits: AnyFunction;
  adoptSourceEdits: AnyFunction;
  inspectMarketingHandoff: AnyFunction;
  runTranslationLoop: AsyncFunction;
  ProviderRegistry?: new () => {
    registerTranslator(value: unknown): unknown;
    registerJudge(value: unknown): unknown;
    translator(id: string): { translate(input: unknown): Promise<unknown> };
    judge(id: string): { judge(input: unknown): Promise<unknown> };
  };
  GoogleTllmProvider?: new () => unknown;
  OpenAiJudgeProvider?: new () => unknown;
}

export interface LanguageLoopAdapterOptions {
  cwd: string;
  /** Useful for hosts that already loaded Language Loop, and for deterministic tests. */
  module?: Record<string, unknown>;
  /** Absolute/relative ESM entry point. Defaults to the installed `language-loop` package. */
  modulePath?: string;
  translator?: (...args: unknown[]) => Promise<unknown>;
  judge?: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Dynamically adapts the existing Language Loop engine without making it part
 * of Marketing Loop's compile-time dependency graph.
 */
export function createLanguageLoopAdapter(
  options: LanguageLoopAdapterOptions,
): ContentLanguageAdapter {
  return {
    run: async (input) => runWithLanguageLoop(options, input),
  };
}

/** Eagerly resolve and validate Language Loop for hosts that want a startup gate. */
export async function loadLanguageLoopAdapter(
  options: LanguageLoopAdapterOptions,
): Promise<ContentLanguageAdapter> {
  const language = await loadLanguageModule(options);
  return createLanguageLoopAdapter({
    ...options,
    module: language as unknown as Record<string, unknown>,
  });
}

async function runWithLanguageLoop(
  options: LanguageLoopAdapterOptions,
  input: ContentLanguageRunInput,
): Promise<ContentLanguageSnapshot> {
  let memory: LanguageMemory | undefined;
  let compatible = true;
  let adoptedSourceKeys: string[] = [];
  let marketingBlocked = 0;

  try {
    const language = await loadLanguageModule(options);
    const config = asConfig(language.requireConfig(options.cwd));
    memory = asMemory(language.loadMemory(options.cwd, config.sourceLocale));
    validateSelection(input, config, memory);

    const allKeys = Object.keys(memory.entries).sort();
    const filtered = !sameMembers(input.keys, allKeys);
    if (filtered && language.CONTENT_LOOP_API_VERSION !== 1) {
      throw new Error(
        'Filtered Content Loop requires Language Loop CONTENT_LOOP_API_VERSION = 1; '
        + 'the installed consumer cannot guarantee key-scoped translation.',
      );
    }

    language.adoptCatalogEdits(options.cwd, memory, config);
    adoptedSourceKeys = stringArray(
      language.adoptSourceEdits(options.cwd, memory, config),
      'Language Loop adoptSourceEdits result',
    ).filter((key) => input.keys.includes(key));
    language.saveMemory(options.cwd, memory);

    const handoff = asHandoff(
      language.inspectMarketingHandoff(options.cwd, config, memory),
    );
    compatible = handoff.compatible;
    const unresolved = [...handoff.unresolvedKeys].filter((key) => input.keys.includes(key));
    marketingBlocked = unresolved.length;
    if (!compatible || marketingBlocked) {
      return snapshot(memory, input, {
        compatible,
        status: 'blocked',
        adoptedSourceKeys,
        marketingBlocked,
        error: handoff.error
          ?? `${marketingBlocked} selected key(s) are still waiting for marketing approval`,
      });
    }

    const before = progressFor(memory, input.keys, input.locales);
    input.onProgress?.(before);
    if (!input.execute) {
      return snapshot(memory, input, {
        compatible: true,
        status: allAccepted(before) ? 'complete' : 'ready',
        adoptedSourceKeys,
        marketingBlocked: 0,
      });
    }

    const providers = providersFor(language, config, options);
    const translator = async (...args: unknown[]): Promise<unknown> => {
      const batch = record(args[0], 'Language Loop translation batch');
      input.onProgress?.(progressFor(
        memory!,
        input.keys,
        input.locales,
        batchLocale(batch),
        batchSize(batch),
      ));
      return providers.translator(...args);
    };
    const judge = async (...args: unknown[]): Promise<unknown> => providers.judge(...args);
    let summary: LanguageSummary;
    try {
      summary = asSummary(await language.runTranslationLoop({
        cwd: options.cwd,
        memory,
        config,
        keys: [...input.keys],
        locales: [...input.locales],
        translator,
        judge,
      } as never));
    } catch (error) {
      const errorText = message(error);
      const result = snapshot(memory, input, {
        compatible: true,
        status: 'blocked',
        adoptedSourceKeys,
        marketingBlocked: 0,
        error: errorText,
        retryable: transient(errorText),
      });
      input.onProgress?.(result.progress);
      return result;
    }

    // The runner writes memory after each accepted batch. Reloading makes the
    // durable engine state, rather than an optimistic summary, authoritative.
    memory = asMemory(language.loadMemory(options.cwd, config.sourceLocale));
    const progress = progressFor(memory, input.keys, input.locales);
    input.onProgress?.(progress);
    const outstanding = progress.filter((row) => !rowAccepted(row));
    const common = {
      compatible: true,
      adoptedSourceKeys,
      marketingBlocked: Number(summary.marketingBlocked ?? 0),
    };
    if (summary.status === 'needs-human' || progress.some((row) => row.needsHuman)) {
      return snapshot(memory, input, {
        ...common,
        status: 'needs-human',
        error: 'One or more selected translations exhausted automated judge attempts',
      });
    }
    if (summary.status === 'waiting-marketing' || common.marketingBlocked) {
      return snapshot(memory, input, {
        ...common,
        status: 'blocked',
        error: 'Selected translations are waiting for marketing approval',
      });
    }
    if (summary.status === 'no-progress') {
      return snapshot(memory, input, {
        ...common,
        status: 'blocked',
        error: 'Language Loop made no progress before every selected language was accepted',
      });
    }
    if (summary.status === 'complete' && outstanding.length) {
      return snapshot(memory, input, {
        ...common,
        status: 'blocked',
        error: `Language Loop reported complete with outstanding selected languages: ${
          outstanding.map((row) => row.locale).join(', ')
        }`,
      });
    }
    return snapshot(memory, input, {
      ...common,
      status: outstanding.length ? 'running' : 'complete',
    });
  } catch (error) {
    const errorText = message(error);
    return snapshot(memory, input, {
      compatible,
      status: 'blocked',
      adoptedSourceKeys,
      marketingBlocked,
      error: errorText,
      retryable: transient(errorText),
    });
  }
}

async function loadLanguageModule(
  options: LanguageLoopAdapterOptions,
): Promise<LanguageModule> {
  const loaded = options.module ?? await import(moduleSpecifier(options.modulePath));
  const value = record(loaded, 'Language Loop module');
  for (const name of [
    'requireConfig',
    'loadMemory',
    'saveMemory',
    'adoptCatalogEdits',
    'adoptSourceEdits',
    'inspectMarketingHandoff',
    'runTranslationLoop',
  ] as const) {
    if (typeof value[name] !== 'function') {
      throw new Error(`Language Loop module is missing required export ${name}`);
    }
  }
  return value as unknown as LanguageModule;
}

function moduleSpecifier(modulePath?: string): string {
  if (!modulePath) return 'language-loop';
  if (modulePath.startsWith('file:')) return modulePath;
  return pathToFileURL(path.resolve(modulePath)).href;
}

function providersFor(
  language: LanguageModule,
  config: LanguageConfig,
  options: LanguageLoopAdapterOptions,
): {
  translator: (...args: unknown[]) => Promise<unknown>;
  judge: (...args: unknown[]) => Promise<unknown>;
} {
  if (options.translator && options.judge) {
    return { translator: options.translator, judge: options.judge };
  }
  if (
    !language.ProviderRegistry
    || !language.GoogleTllmProvider
    || !language.OpenAiJudgeProvider
  ) {
    throw new Error('Language Loop provider exports are unavailable');
  }
  const registry = new language.ProviderRegistry();
  registry.registerTranslator(new language.GoogleTllmProvider());
  registry.registerJudge(new language.OpenAiJudgeProvider());
  const translator = registry.translator(config.ai.translator);
  const judge = registry.judge(config.ai.judge);
  return {
    translator: (...args) => translator.translate({
      batch: args[0],
      contexts: args[1],
      config,
    }),
    judge: (...args) => judge.judge({
      batch: args[0],
      translations: args[1],
      units: args[2],
      contexts: args[3],
      config,
    }),
  };
}

function snapshot(
  memory: LanguageMemory | undefined,
  input: ContentLanguageRunInput,
  fields: Omit<
    ContentLanguageSnapshot,
    'pending' | 'applied' | 'needsHuman' | 'progress'
  >,
): ContentLanguageSnapshot {
  const progress = memory
    ? progressFor(memory, input.keys, input.locales)
    : input.locales.map((locale) => ({
      locale,
      total: input.keys.length,
      accepted: 0,
      pending: input.keys.length,
      rework: 0,
      needsHuman: 0,
    }));
  return {
    ...fields,
    pending: progress.reduce((sum, row) => sum + row.pending + row.rework, 0),
    applied: progress.reduce((sum, row) => sum + row.accepted, 0),
    needsHuman: progress.reduce((sum, row) => sum + row.needsHuman, 0),
    progress,
  };
}

function progressFor(
  memory: LanguageMemory,
  keys: string[],
  locales: string[],
  activeLocale?: string,
  activeBatch?: number,
): ContentLanguageProgress[] {
  return locales.map((locale) => {
    const row: ContentLanguageProgress = {
      locale,
      total: keys.length,
      accepted: 0,
      pending: 0,
      rework: 0,
      needsHuman: 0,
    };
    for (const key of keys) {
      const entry = memory.entries[key];
      const translation = entry?.translations[locale];
      if (
        translation
        && translation.sourceHash === entry?.sourceHash
        && (translation.status === 'approved' || translation.status === 'manual')
      ) {
        row.accepted++;
      } else if (
        translation
        && translation.sourceHash === entry?.sourceHash
        && translation.status === 'needs-human'
      ) {
        row.needsHuman++;
      } else if (
        translation
        && translation.sourceHash === entry?.sourceHash
        && translation.status === 'rework'
      ) {
        row.rework++;
      } else {
        row.pending++;
      }
    }
    if (locale === activeLocale && activeBatch) row.activeBatch = activeBatch;
    return row;
  });
}

function validateSelection(
  input: ContentLanguageRunInput,
  config: LanguageConfig,
  memory: LanguageMemory,
): void {
  if (!input.keys.length) throw new Error('Content Loop selected no translation keys');
  if (!input.locales.length) throw new Error('Content Loop selected no target languages');
  const missingKeys = input.keys.filter((key) => !memory.entries[key]);
  if (missingKeys.length) {
    throw new Error(`Selected Content Loop keys are missing from Language Loop memory: ${missingKeys.join(', ')}`);
  }
  const invalidLocales = input.locales.filter(
    (locale) => locale === config.sourceLocale || !config.locales.includes(locale),
  );
  if (invalidLocales.length) {
    throw new Error(`Selected target languages are not configured in Language Loop: ${invalidLocales.join(', ')}`);
  }
}

function asConfig(value: unknown): LanguageConfig {
  const config = record(value, 'Language Loop config');
  if (
    typeof config.sourceLocale !== 'string'
    || !Array.isArray(config.locales)
    || !config.locales.every((locale) => typeof locale === 'string')
  ) {
    throw new Error('Language Loop config must declare sourceLocale and locales');
  }
  const ai = record(config.ai, 'Language Loop config.ai');
  if (typeof ai.translator !== 'string' || typeof ai.judge !== 'string') {
    throw new Error('Language Loop config.ai must declare translator and judge');
  }
  return config as unknown as LanguageConfig;
}

function asMemory(value: unknown): LanguageMemory {
  const memory = record(value, 'Language Loop memory');
  const entries = record(memory.entries, 'Language Loop memory.entries');
  for (const [key, candidate] of Object.entries(entries)) {
    const entry = record(candidate, `Language Loop memory entry ${key}`);
    if (typeof entry.sourceHash !== 'string') {
      throw new Error(`Language Loop memory entry ${key} has no sourceHash`);
    }
    record(entry.translations, `Language Loop memory entry ${key}.translations`);
  }
  return memory as unknown as LanguageMemory;
}

function asHandoff(value: unknown): LanguageHandoffState {
  const handoff = record(value, 'Language Loop marketing handoff state');
  if (typeof handoff.compatible !== 'boolean') {
    throw new Error('Language Loop marketing handoff state has no compatible flag');
  }
  const unresolvedKeys = handoff.unresolvedKeys;
  if (
    !(unresolvedKeys instanceof Set)
    && !(Array.isArray(unresolvedKeys) && unresolvedKeys.every((key) => typeof key === 'string'))
  ) {
    throw new Error('Language Loop marketing handoff state has invalid unresolvedKeys');
  }
  return handoff as unknown as LanguageHandoffState;
}

function asSummary(value: unknown): LanguageSummary {
  const summary = record(value, 'Language Loop run summary');
  if (
    summary.status !== 'complete'
    && summary.status !== 'needs-human'
    && summary.status !== 'no-progress'
    && summary.status !== 'waiting-marketing'
  ) {
    throw new Error('Language Loop run summary has an invalid status');
  }
  return summary as unknown as LanguageSummary;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function batchLocale(batch: Record<string, unknown>): string | undefined {
  const units = batch.units;
  if (!Array.isArray(units) || !units.length) return undefined;
  const first = record(units[0], 'Language Loop batch unit');
  return typeof first.locale === 'string' ? first.locale : undefined;
}

function batchSize(batch: Record<string, unknown>): number | undefined {
  return Array.isArray(batch.units) ? batch.units.length : undefined;
}

function allAccepted(progress: ContentLanguageProgress[]): boolean {
  return progress.every(rowAccepted);
}

function rowAccepted(row: ContentLanguageProgress): boolean {
  return (
    row.total === row.accepted
    && row.pending === 0
    && row.rework === 0
    && row.needsHuman === 0
  );
}

function sameMembers(left: string[], right: string[]): boolean {
  return (
    left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function transient(error: string): boolean {
  return /rate.?limit|too many requests|temporar|timeout|timed out|unavailable|overloaded|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
