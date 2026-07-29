import type {
  ContentFilter,
  ContentSelection,
  CopyItem,
} from '../types.js';

export const EMPTY_CONTENT_FILTER: ContentFilter = Object.freeze({
  schemaVersion: 1,
  types: [],
  groups: [],
  keys: [],
});

const TYPE_MATCHERS: Record<string, (item: CopyItem) => boolean> = {
  cta: (item) => item.kind === 'cta',
  headline: (item) => item.kind === 'headline',
  button: (item) => keyTokens(item.catalogueKey)
    .some((token) => ['button', 'btn', 'action', 'submit'].includes(token)),
  navigation: (item) => item.kind === 'nav',
  label: (item) => item.kind === 'label',
};

const CANONICAL_SELECTOR = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u;

export function normalizeContentFilter(
  input: Partial<ContentFilter> = {},
): ContentFilter {
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
    throw new Error('Content filter schemaVersion must be 1');
  }
  const types = strings('types', input.types).map((value) => value.toLowerCase());
  const groups = strings('groups', input.groups);
  const keys = strings('keys', input.keys);

  for (const type of types) {
    if (!TYPE_MATCHERS[type]) {
      throw new Error(`unsupported content type "${type}"`);
    }
  }
  for (const [field, values] of [['groups', groups], ['keys', keys]] as const) {
    const invalid = values.find((value) => !CANONICAL_SELECTOR.test(value));
    if (invalid) throw new Error(`Content filter ${field} contains invalid selector "${invalid}"`);
  }

  return {
    schemaVersion: 1,
    types: unique(types),
    groups: unique(groups),
    keys: unique(keys),
  };
}

export function matchesContentFilter(
  item: CopyItem,
  input: ContentFilter,
): boolean {
  const filter = normalizeContentFilter(input);
  const typeMatch = !filter.types.length
    || filter.types.some((type) => TYPE_MATCHERS[type]!(item));
  const groupMatch = !filter.groups.length
    || filter.groups.some((group) =>
      item.catalogueKey === group || item.catalogueKey.startsWith(`${group}.`));
  const keyMatch = !filter.keys.length || filter.keys.includes(item.catalogueKey);
  return typeMatch && groupMatch && keyMatch;
}

export function resolveContentSelection(
  items: CopyItem[],
  input: ContentFilter,
  targetLocales: string[] = [],
): ContentSelection {
  const filter = normalizeContentFilter(input);
  const sourceLocales = unique(items.map((item) => item.sourceLocale));
  if (sourceLocales.length > 1) {
    throw new Error('Content selection inventory contains more than one source locale');
  }
  const locales = unique(targetLocales.map((locale) => locale.trim()).filter(Boolean));
  if (sourceLocales[0] && locales.includes(sourceLocales[0])) {
    throw new Error(`target locales cannot include source locale ${sourceLocales[0]}`);
  }
  const resolvedKeys = unique(
    items
      .filter((item) => matchesContentFilter(item, filter))
      .map((item) => item.catalogueKey),
  );
  if (!resolvedKeys.length) {
    throw new Error('Content filter does not match any source-catalogue keys');
  }
  return { filter, resolvedKeys, targetLocales: locales };
}

function strings(
  field: keyof Pick<ContentFilter, 'types' | 'groups' | 'keys'>,
  value: string[] | undefined,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Content filter ${field} must be an array of non-empty strings`);
  }
  return value.map((entry) => entry.trim());
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function keyTokens(key: string): string[] {
  return key
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1.$2')
    .split(/[._-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}
