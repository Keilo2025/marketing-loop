import path from 'node:path';
import { DEFAULT_SURFACES, type LoopConfig } from './types.js';
import { exists, readJson, writeJson } from './util/fsx.js';

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
  const raw = readJson<Partial<LoopConfig>>(file, {});
  return {
    ...defaultConfig,
    ...raw,
    voice: { ...defaultConfig.voice, ...(raw.voice ?? {}) },
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
