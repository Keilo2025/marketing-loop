import fs from 'node:fs';
import path from 'node:path';
import type { CatalogueConfig, CatalogueScope, LoopConfig } from '../types.js';
import { hashText, readJsonStrict } from '../util/fsx.js';

const LANGUAGE_CONFIG_FILE = 'language-loop.config.json';
const FALLBACK_CATALOGUE: CatalogueConfig = {
  messagesDir: 'messages',
  sourceLocale: 'en',
  layout: 'single-file',
};

function cleanRelative(field: string, value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`${field} must be a repository-relative path without traversal`);
  }
  return normalized;
}

function scopeIdentity(scope: Omit<CatalogueScope, 'scopeDigest'>): string {
  return JSON.stringify({
    messagesDir: scope.messagesDir,
    sourceLocale: scope.sourceLocale,
    layout: scope.layout,
    files: [...scope.files].sort(),
  });
}

function catalogueConfig(raw: unknown, file: string): CatalogueConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid ${file}: configuration must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const stringField = (field: 'messagesDir' | 'sourceLocale'): string => {
    const candidate = value[field];
    if (typeof candidate !== 'string') {
      throw new Error(`Invalid ${file}: ${field} must be a string`);
    }
    return cleanRelative(field, candidate);
  };
  const layout = value.layout;
  if (layout !== 'single-file' && layout !== 'namespaced' && layout !== 'custom') {
    throw new Error(`Invalid ${file}: layout must be single-file, namespaced, or custom`);
  }
  return {
    messagesDir: stringField('messagesDir'),
    sourceLocale: stringField('sourceLocale'),
    layout,
  };
}

function languageCatalogue(cwd: string): CatalogueConfig | undefined {
  const file = path.join(cwd, LANGUAGE_CONFIG_FILE);
  if (!fs.existsSync(file)) return undefined;
  return catalogueConfig(readJsonStrict<unknown>(file), LANGUAGE_CONFIG_FILE);
}

function normalizedCatalogue(config: CatalogueConfig): CatalogueConfig {
  return {
    messagesDir: cleanRelative('messagesDir', config.messagesDir),
    sourceLocale: cleanRelative('sourceLocale', config.sourceLocale),
    layout: config.layout,
  };
}

function assertAgrees(marketing: CatalogueConfig, language: CatalogueConfig): void {
  for (const field of ['messagesDir', 'sourceLocale', 'layout'] as const) {
    if (marketing[field] !== language[field]) {
      throw new Error(`marketing-loop and language-loop disagree on ${field}`);
    }
  }
}

function lstatSegment(cwd: string, relative: string, missingPath: string): fs.Stats {
  const absolute = path.join(cwd, relative);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${missingPath} does not exist`);
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${relative} must not be a symbolic link`);
  }
  return stat;
}

function assertPathSegments(cwd: string, relative: string): fs.Stats {
  const parts = relative.split('/');
  let current = '';
  let stat: fs.Stats | undefined;
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    stat = lstatSegment(cwd, current, relative);
  }
  return stat!;
}

function sourceDirectory(cwd: string, config: CatalogueConfig): string {
  const relative = `${config.messagesDir}/${config.sourceLocale}`;
  const stat = assertPathSegments(cwd, relative);
  if (!stat.isDirectory()) {
    throw new Error(`${relative} must be a directory for a namespaced source catalogue`);
  }
  return relative;
}

function sourceFiles(cwd: string, config: CatalogueConfig): string[] {
  if (config.layout !== 'namespaced') {
    const file = `${config.messagesDir}/${config.sourceLocale}.json`;
    const stat = assertPathSegments(cwd, file);
    if (!stat.isFile()) throw new Error(`${file} must be a file`);
    return [file];
  }

  const directory = sourceDirectory(cwd, config);
  const files = fs.readdirSync(path.join(cwd, directory), { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.json'))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
  for (const file of files) {
    const stat = assertPathSegments(cwd, file);
    if (!stat.isFile()) throw new Error(`${file} must be a regular file`);
  }
  if (files.length === 0) {
    throw new Error(`namespaced source catalogue at ${directory} is empty`);
  }
  return files;
}

export function resolveCatalogueScope(cwd: string, config: LoopConfig): CatalogueScope {
  const language = languageCatalogue(cwd);
  const marketing = config.catalogue === undefined ? undefined : normalizedCatalogue(config.catalogue);
  if (language && marketing) assertAgrees(marketing, language);
  const catalogue = language ?? marketing ?? FALLBACK_CATALOGUE;
  const normalized = normalizedCatalogue(catalogue);
  const files = sourceFiles(cwd, normalized);
  const scope = { ...normalized, files };
  return { ...scope, scopeDigest: hashText(scopeIdentity(scope)) };
}

export function isCatalogueTarget(scope: CatalogueScope, file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return scope.files.includes(normalized);
}

export function catalogueKeyForFile(scope: CatalogueScope, file: string, jsonPath: string[]): string {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const key = [...jsonPath];
  if (scope.layout === 'namespaced') {
    const prefix = `${scope.messagesDir}/${scope.sourceLocale}/`;
    const namespace = normalized.startsWith(prefix) ? normalized.slice(prefix.length).replace(/\.json$/, '') : '';
    if (namespace) key.unshift(namespace);
  }
  return key.join('.');
}
