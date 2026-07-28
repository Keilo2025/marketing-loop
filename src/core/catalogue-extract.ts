import type { CatalogueScope, CopyItem, CopyKind, Surface } from '../types.js';
import { catalogueKeyForFile } from './catalogue.js';
import { hashText, shortHash } from '../util/fsx.js';

interface ParsedString {
  path: string[];
  value: string;
  raw: string;
  start: number;
  end: number;
}

const tokens = (key: string): string[] =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[._\s-]+/).filter(Boolean);

export function inferKindFromKey(key: string): CopyKind {
  const keyTokens = tokens(key);
  const parts = new Set(keyTokens);
  if (hasAny(parts, ['error', 'invalid', 'failed', 'failure', 'fail'])) return 'error';
  if (
    hasAny(parts, ['empty', 'zero', 'noresults', 'notfound'])
    || hasSequence(keyTokens, ['no', 'results'])
    || hasSequence(keyTokens, ['not', 'found'])
  ) return 'empty-state';
  if (hasAny(parts, ['cta', 'button', 'submit', 'action'])) return 'cta';
  if (hasAny(parts, ['subhead', 'subtitle', 'tagline', 'slogan', 'lead'])) return 'subhead';
  if (hasAny(parts, ['headline', 'heading', 'hero', 'title'])) return 'headline';
  if (hasAny(parts, ['price', 'pricing', 'plan', 'tier'])) return 'pricing';
  if (hasAny(parts, ['label', 'placeholder', 'hint', 'help', 'tooltip'])) return 'label';
  if (hasAny(parts, ['body', 'copy', 'message', 'description', 'text'])) return 'body';
  return 'unknown';
}

export function inferSurfaceFromKey(key: string): Surface {
  const parts = new Set(tokens(key));
  if (hasAny(parts, ['legal', 'terms', 'privacy', 'cookie', 'refund', 'policy'])) return 'legal';
  if (hasAny(parts, ['landing', 'marketing', 'home', 'hero', 'pricing', 'signup', 'onboarding'])) return 'landing';
  if (hasAny(parts, ['email', 'mail', 'newsletter'])) return 'email';
  if (hasAny(parts, ['store', 'appstore', 'playstore'])) return 'store';
  return 'app';
}

export function extractCatalogueFile(
  file: string,
  content: string,
  scope: CatalogueScope,
): CopyItem[] {
  try {
    JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${reason}`);
  }

  const parsed = parseCatalogueStrings(content);
  const fileHash = hashText(content);
  return parsed.map((entry) => {
    const catalogueKey = catalogueKeyForFile(scope, file, entry.path);
    return {
      id: shortHash(file, catalogueKey),
      catalogueKey,
      sourceLocale: scope.sourceLocale,
      scopeDigest: scope.scopeDigest,
      file,
      fileHash,
      line: lineOf(content, entry.start),
      text: entry.value,
      kind: inferKindFromKey(catalogueKey),
      surface: inferSurfaceFromKey(catalogueKey),
      context: [`catalogue:${catalogueKey}`],
      length: entry.value.length,
      source: {
        raw: entry.raw,
        start: entry.start,
        end: entry.end,
        representation: 'json-string',
        applicable: true,
      },
    };
  });
}

function hasAny(parts: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => parts.has(candidate));
}

function hasSequence(parts: string[], sequence: string[]): boolean {
  return parts.some((_token, start) =>
    start <= parts.length - sequence.length
    && sequence.every((token, offset) => parts[start + offset] === token),
  );
}

function parseCatalogueStrings(content: string): ParsedString[] {
  const strings: ParsedString[] = [];
  let cursor = 0;

  const whitespace = () => {
    while (/\s/.test(content[cursor] ?? '')) cursor++;
  };

  const readString = (quoteStart: number): {
    value: string;
    raw: string;
    start: number;
    end: number;
    next: number;
  } => {
    let index = quoteStart + 1;
    let escaped = false;
    while (index < content.length) {
      const char = content[index]!;
      if (!escaped && char === '"') {
        const raw = content.slice(quoteStart + 1, index);
        return {
          value: JSON.parse(`"${raw}"`) as string,
          raw,
          start: quoteStart + 1,
          end: index,
          next: index + 1,
        };
      }
      escaped = !escaped && char === '\\';
      if (char !== '\\') escaped = false;
      index++;
    }
    throw new Error('unterminated JSON string');
  };

  const skipPrimitive = () => {
    while (cursor < content.length && !/[\s,}\]]/.test(content[cursor]!)) cursor++;
  };

  const parseValue = (path: string[], emit: boolean): void => {
    whitespace();
    const char = content[cursor];
    if (char === '{') {
      parseObject(path, emit);
      return;
    }
    if (char === '[') {
      parseArray(path);
      return;
    }
    if (char === '"') {
      const parsed = readString(cursor);
      cursor = parsed.next;
      if (emit) strings.push({ path, ...parsed });
      return;
    }
    skipPrimitive();
  };

  const parseObject = (path: string[], emit: boolean): void => {
    cursor++;
    whitespace();
    if (content[cursor] === '}') {
      cursor++;
      return;
    }
    while (cursor < content.length) {
      whitespace();
      if (content[cursor] !== '"') throw new Error('invalid JSON object key');
      const property = readString(cursor);
      cursor = property.next;
      whitespace();
      if (content[cursor] !== ':') throw new Error('invalid JSON object separator');
      cursor++;
      parseValue([...path, property.value], emit);
      whitespace();
      if (content[cursor] === '}') {
        cursor++;
        return;
      }
      if (content[cursor] !== ',') throw new Error('invalid JSON object delimiter');
      cursor++;
    }
  };

  const parseArray = (path: string[]): void => {
    cursor++;
    whitespace();
    if (content[cursor] === ']') {
      cursor++;
      return;
    }
    while (cursor < content.length) {
      parseValue(path, false);
      whitespace();
      if (content[cursor] === ']') {
        cursor++;
        return;
      }
      if (content[cursor] !== ',') throw new Error('invalid JSON array delimiter');
      cursor++;
    }
  };

  whitespace();
  if (content[cursor] === '{') {
    parseObject([], true);
  } else {
    parseValue([], false);
  }
  whitespace();
  if (cursor !== content.length) throw new Error('invalid JSON trailing content');
  return strings;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position++) {
    if (content.charCodeAt(position) === 10) line++;
  }
  return line;
}
