/**
 * Product model inference.
 *
 * Marketing copy written from a brief is guesswork. Marketing copy written
 * from the code knows what the thing actually does. This module reads the
 * repo the way a technical marketer would on their first day: package
 * manifest, routes, exported components, API endpoints, env vars, README.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Feature, LoopConfig, ProductModel } from '../types.js';
import { exists, read, readJson, walk } from '../util/fsx.js';

interface PackageJson {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const STACK_SIGNALS: Array<[RegExp, string]> = [
  [/^next$/, 'Next.js'],
  [/^react$/, 'React'],
  [/^vue$/, 'Vue'],
  [/^svelte/, 'Svelte'],
  [/^@angular\/core$/, 'Angular'],
  [/^astro$/, 'Astro'],
  [/^remix|@remix-run/, 'Remix'],
  [/^nuxt$/, 'Nuxt'],
  [/^express$|^fastify$|^hono$/, 'Node API'],
  [/^tailwindcss$/, 'Tailwind'],
  [/^prisma$|^drizzle-orm$/, 'SQL database'],
  [/^mongoose$/, 'MongoDB'],
  [/^stripe$/, 'Stripe billing'],
  [/^@supabase\/supabase-js$/, 'Supabase'],
  [/^firebase$/, 'Firebase'],
  [/^next-auth$|^@clerk|^@auth0/, 'Authentication'],
  [/^openai$|^@anthropic-ai\/sdk$|^ai$/, 'LLM features'],
  [/^socket\.io|^ws$/, 'Realtime'],
  [/^resend$|^nodemailer$|^@sendgrid/, 'Transactional email'],
  [/^@sentry/, 'Error monitoring'],
  [/^posthog-js$|^@amplitude|^mixpanel/, 'Product analytics'],
];

/** Dependencies that are worth naming in copy because buyers search for them. */
const INTEGRATION_SIGNALS =
  /^(stripe|@?slack|@?notionhq|googleapis|@octokit|twilio|shopify|hubspot|salesforce|zoom|@?linear|jira|airtable|@?supabase|openai|@anthropic-ai)/;

export function buildProductModel(cwd: string, config: LoopConfig): ProductModel {
  const pkg = readJson<PackageJson>(path.join(cwd, 'package.json'), {});
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const depNames = Object.keys(deps);

  const stack = STACK_SIGNALS.filter(([re]) => depNames.some((d) => re.test(d))).map(
    ([, label]) => label,
  );

  const integrations = depNames.filter((d) => INTEGRATION_SIGNALS.test(d));

  const files = walk(cwd, { exclude: config.exclude, maxFiles: 3000 });

  return {
    name: pkg.name ?? path.basename(cwd),
    tagline: firstReadmeTagline(cwd),
    description: pkg.description ?? readmeIntro(cwd),
    stack: [...new Set(stack)],
    routes: findRoutes(files),
    features: findFeatures(cwd, files, depNames),
    audienceHints: findAudienceHints(cwd, pkg),
    pricingTiers: findPricingTiers(cwd, files),
    integrations,
    generatedAt: new Date().toISOString(),
  };
}

/* ----------------------------------------------------------------- routes */

function findRoutes(files: string[]): string[] {
  const routes = new Set<string>();

  for (const file of files) {
    // Next.js app router / pages router, SvelteKit, Nuxt, Remix.
    let m = /^(?:src\/)?app\/(.*)\/(page|route)\.(tsx?|jsx?)$/.exec(file);
    if (m) { routes.add('/' + cleanSegments(m[1] ?? '')); continue; }
    if (/^(?:src\/)?app\/(page|route)\.(tsx?|jsx?)$/.test(file)) { routes.add('/'); continue; }

    m = /^(?:src\/)?pages\/(.*)\.(tsx?|jsx?|vue)$/.exec(file);
    if (m && !(m[1] ?? '').startsWith('api/') && !(m[1] ?? '').startsWith('_')) {
      routes.add('/' + cleanSegments((m[1] ?? '').replace(/\/?index$/, '')));
      continue;
    }

    m = /^(?:src\/)?routes\/(.*)\/\+page\.svelte$/.exec(file);
    if (m) { routes.add('/' + cleanSegments(m[1] ?? '')); continue; }

    // Static sites.
    if (/^(public\/|dist\/)?[\w-]+\.html$/.test(file)) {
      routes.add('/' + file.replace(/^(public|dist)\//, '').replace(/index\.html$/, ''));
    }
  }

  return [...routes].filter(Boolean).sort().slice(0, 60);
}

function cleanSegments(segment: string): string {
  return segment
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s)) // route groups
    .join('/');
}

/* --------------------------------------------------------------- features */

/**
 * A "feature" is a capability with evidence behind it. We look for the places
 * a codebase names its own capabilities: API routes, exported components,
 * server actions, and top-level directories under a features/modules folder.
 */
function findFeatures(cwd: string, files: string[], deps: string[]): Feature[] {
  const buckets = new Map<string, Set<string>>();

  const add = (name: string, evidence: string) => {
    const key = humanise(name);
    if (!key || key.length < 3 || STOP_FEATURES.has(key.toLowerCase())) return;
    const set = buckets.get(key) ?? new Set<string>();
    set.add(evidence);
    buckets.set(key, set);
  };

  for (const file of files) {
    // API surface — the clearest statement of what the product can do.
    let m = /(?:^|\/)api\/(.+?)(?:\/route)?\.(tsx?|jsx?|py|go|rb)$/.exec(file);
    if (m) { add((m[1] ?? '').split('/')[0] ?? '', file); continue; }

    // features/ or modules/ directories.
    m = /(?:^|\/)(?:features|modules|domains)\/([\w-]+)\//.exec(file);
    if (m) { add(m[1] ?? '', file); continue; }

    // Named page routes double as features.
    m = /(?:^|\/)(?:app|pages)\/([\w-]+)\/(?:page|index)\.(tsx?|jsx?|vue)$/.exec(file);
    if (m) { add(m[1] ?? '', file); continue; }

    // Top-level components with intent-bearing names.
    m = /(?:^|\/)components\/([A-Z][\w]+)\.(tsx?|jsx?|vue|svelte)$/.exec(file);
    if (m && /[A-Z].*[A-Z]/.test(m[1] ?? '')) add(m[1] ?? '', file);
  }

  // Dependencies are capabilities too — "we bill with Stripe" is a feature.
  for (const dep of deps) {
    if (INTEGRATION_SIGNALS.test(dep)) add(`${dep.replace(/^@[\w-]+\//, '')} integration`, `package.json:${dep}`);
  }

  return [...buckets.entries()]
    .map(([name, evidence]) => ({ name, evidence: [...evidence].slice(0, 5) }))
    .sort((a, b) => b.evidence.length - a.evidence.length)
    .slice(0, 30);
}

const STOP_FEATURES = new Set([
  'index', 'app', 'main', 'page', 'route', 'layout', 'utils', 'util', 'lib',
  'helpers', 'types', 'test', 'tests', 'config', 'common', 'shared', 'assets',
  'styles', 'hooks', 'store', 'api',
]);

function humanise(raw: string): string {
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------------------------------------- audience */

function findAudienceHints(cwd: string, pkg: PackageJson): string[] {
  const hints = new Set<string>();
  for (const kw of pkg.keywords ?? []) hints.add(kw);

  const readme = read(path.join(cwd, 'README.md'));
  const forPhrases = readme.match(/\bfor ([a-z][\w\s,-]{3,50}?)(?:\.|,|\n| who| that| to )/gi);
  for (const phrase of forPhrases?.slice(0, 8) ?? []) hints.add(phrase.trim().replace(/[.,]$/, ''));

  // Vocabulary from the code is the audience's own vocabulary.
  for (const marker of ['patient', 'student', 'teacher', 'tenant', 'landlord', 'merchant', 'seller', 'buyer', 'candidate', 'recruiter', 'trader', 'clinician', 'agent', 'client', 'member', 'subscriber', 'admin', 'developer', 'designer', 'founder']) {
    if (new RegExp(`\\b${marker}s?\\b`, 'i').test(readme)) hints.add(marker);
  }

  return [...hints].slice(0, 15);
}

/* ---------------------------------------------------------------- pricing */

function findPricingTiers(cwd: string, files: string[]): string[] {
  const tiers = new Set<string>();
  const candidates = files.filter((f) => /pricing|plans?|tiers?|billing|subscription/i.test(f)).slice(0, 20);

  for (const file of candidates) {
    const content = read(path.join(cwd, file));
    const names = content.match(/["'](free|starter|basic|hobby|pro|plus|team|business|growth|scale|enterprise|premium|unlimited)["']/gi);
    for (const n of names ?? []) tiers.add(n.replace(/["']/g, '').toLowerCase());
  }

  return [...tiers];
}

/* ----------------------------------------------------------------- readme */

function firstReadmeTagline(cwd: string): string | undefined {
  const readme = read(path.join(cwd, 'README.md'));
  if (!readme) return undefined;
  const lines = readme.split('\n');
  for (const [i, line] of lines.entries()) {
    if (!/^#\s/.test(line)) continue;
    for (const next of lines.slice(i + 1, i + 6)) {
      const t = next.trim();
      if (t && !t.startsWith('#') && !t.startsWith('[!') && !t.startsWith('<')) return t;
    }
  }
  return undefined;
}

function readmeIntro(cwd: string): string | undefined {
  const readme = read(path.join(cwd, 'README.md'));
  if (!readme) return undefined;
  const body = readme
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('[!') && !l.startsWith('```'))
    .slice(0, 3)
    .join(' ');
  return body.slice(0, 400) || undefined;
}

/** Detect whether we're even in a project worth scanning. */
export function looksLikeProject(cwd: string): boolean {
  return ['package.json', 'index.html', 'src', 'app', 'README.md'].some((p) =>
    exists(path.join(cwd, p)),
  ) && fs.statSync(cwd).isDirectory();
}
