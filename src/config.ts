import path from 'node:path';
import { DEFAULT_SURFACES, type LoopConfig } from './types.js';
import { exists, readJsonStrict, writeJson } from './util/fsx.js';

export const CONFIG_FILE = 'marketing-loop.config.json';

export const defaultConfig: LoopConfig = {
  include: ['src', 'app', 'pages', 'components', 'lib', 'public', 'content', 'locales', 'www', 'web', 'site', '.'],
  exclude: [
    'node_modules',
    '.git',
    'dist',
    'build',
    'test',
    'tests',
    '__tests__',
    '.spec.',
    '.test.',
    '.stories.',
    'e2e',
    'fixtures',
    'migrations',
    '.d.ts',
  ],
  dataDir: 'marketing-data',
  outDir: '.marketing-loop',
  voice: {
    tone: 'plain, confident, specific — no hype, no exclamation marks',
    person: 'second',
    readingLevel: 'grade 7',
    banned: [
      'revolutionary',
      'seamless',
      'game-changing',
      'cutting-edge',
      'best-in-class',
      'unlock',
      'supercharge',
      'leverage',
      'synergy',
      'delve',
      'elevate',
      'empower',
    ],
    required: [],
  },
  audience: '',
  allowedClaims: [],
  maxProposals: 60,
  surfaces: [...DEFAULT_SURFACES],
  disabledPrinciples: [],
  protectedFiles: ['LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json'],
};

export function loadConfig(cwd: string): LoopConfig {
  const file = path.join(cwd, CONFIG_FILE);
  if (!exists(file)) return { ...defaultConfig };
  const raw = readJsonStrict<unknown>(file);
  return validateConfig(raw, file);
}

export function validateConfig(raw: unknown, file = CONFIG_FILE): LoopConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid ${file}: configuration must be an object`);
  }
  const value = raw as Record<string, unknown>;

  const stringArray = (key: string, fallback: string[]): string[] => {
    const candidate = value[key];
    if (candidate === undefined) return [...fallback];
    if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === 'string')) {
      throw new Error(`Invalid ${file}: ${key} must be an array of strings`);
    }
    return [...candidate];
  };

  const relativePath = (key: 'dataDir' | 'outDir', fallback: string): string => {
    const candidate = value[key] ?? fallback;
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error(`Invalid ${file}: ${key} must be a non-empty relative path`);
    }
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.isAbsolute(candidate) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`Invalid ${file}: ${key} must stay inside the repository`);
    }
    return normalized;
  };

  const voiceRaw = value.voice;
  if (voiceRaw !== undefined && (!voiceRaw || typeof voiceRaw !== 'object' || Array.isArray(voiceRaw))) {
    throw new Error(`Invalid ${file}: voice must be an object`);
  }
  const voice = (voiceRaw ?? {}) as Record<string, unknown>;
  const voiceString = (key: 'tone' | 'person' | 'readingLevel', fallback: string): string => {
    const candidate = voice[key] ?? fallback;
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error(`Invalid ${file}: voice.${key} must be a non-empty string`);
    }
    return candidate;
  };
  const voiceArray = (key: 'banned' | 'required', fallback: string[]): string[] => {
    const candidate = voice[key];
    if (candidate === undefined) return [...fallback];
    if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === 'string')) {
      throw new Error(`Invalid ${file}: voice.${key} must be an array of strings`);
    }
    return [...candidate];
  };

  const person = voiceString('person', defaultConfig.voice.person);
  if (!['first', 'second', 'third'].includes(person)) {
    throw new Error(`Invalid ${file}: voice.person must be first, second, or third`);
  }

  const maxProposals = value.maxProposals ?? defaultConfig.maxProposals;
  if (!Number.isInteger(maxProposals) || Number(maxProposals) <= 0) {
    throw new Error(`Invalid ${file}: maxProposals must be a positive integer`);
  }

  const surfaces = stringArray('surfaces', defaultConfig.surfaces ?? []);
  const allowedSurfaces = new Set(['landing', 'app', 'email', 'docs', 'store', 'legal', 'internal', 'unknown']);
  const invalidSurface = surfaces.find((surface) => !allowedSurfaces.has(surface));
  if (invalidSurface) {
    throw new Error(`Invalid ${file}: unsupported surface "${invalidSurface}"`);
  }

  return {
    ...defaultConfig,
    include: stringArray('include', defaultConfig.include),
    exclude: stringArray('exclude', defaultConfig.exclude),
    dataDir: relativePath('dataDir', defaultConfig.dataDir),
    outDir: relativePath('outDir', defaultConfig.outDir),
    voice: {
      tone: voiceString('tone', defaultConfig.voice.tone),
      person: person as LoopConfig['voice']['person'],
      readingLevel: voiceString('readingLevel', defaultConfig.voice.readingLevel),
      banned: voiceArray('banned', defaultConfig.voice.banned),
      required: voiceArray('required', defaultConfig.voice.required),
    },
    audience: typeof value.audience === 'string' ? value.audience : defaultConfig.audience,
    allowedClaims: stringArray('allowedClaims', defaultConfig.allowedClaims),
    maxProposals: Number(maxProposals),
    surfaces: surfaces as LoopConfig['surfaces'],
    disabledPrinciples: stringArray('disabledPrinciples', defaultConfig.disabledPrinciples),
    protectedFiles: stringArray('protectedFiles', defaultConfig.protectedFiles),
  };
}

export function saveConfig(cwd: string, config: LoopConfig): string {
  const file = path.join(cwd, CONFIG_FILE);
  writeJson(file, config);
  return file;
}

/** Absolute paths for every artefact the loop reads or writes. */
export function paths(cwd: string, config: LoopConfig) {
  const out = path.join(cwd, config.outDir);
  return {
    out,
    inventory: path.join(out, 'inventory.json'),
    product: path.join(out, 'product.json'),
    findings: path.join(out, 'findings.json'),
    behavior: path.join(out, 'behavior.json'),
    brief: path.join(out, 'brief.md'),
    proposals: path.join(out, 'proposals.json'),
    review: path.join(out, 'review.md'),
    applied: path.join(out, 'applied.json'),
    decisions: path.join(out, 'decisions.json'),
    backups: path.join(out, 'backups'),
    report: path.join(out, 'report.md'),
    data: path.join(cwd, config.dataDir),
  };
}
