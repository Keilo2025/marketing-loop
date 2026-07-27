/**
 * Behavioural data ingestion.
 *
 * Drop exports into `marketing-data/` and this reads them. No API keys, no
 * OAuth, no vendor lock — you export from GA4, PostHog, Amplitude, Hotjar or
 * a spreadsheet and the loop treats whatever you give it as evidence.
 *
 * The point of this stage is not analytics. It is to stop the copy stage from
 * guessing which sentence is losing you money.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  BehaviorProblem,
  BehaviorReport,
  BehaviorSignal,
  BehaviorSource,
  CopyItem,
  FunnelStep,
} from '../types.js';
import { exists, read, shortHash } from '../util/fsx.js';

/** Column aliases seen across the common export formats. */
const COLUMN_MAP: Record<string, string[]> = {
  subject: ['event', 'event name', 'label', 'cta', 'button', 'page', 'page path', 'page title', 'step', 'name', 'element', 'text', 'screen', 'url'],
  users: ['users', 'active users', 'sessions', 'visitors', 'unique users', 'count', 'events', 'total'],
  conversions: ['conversions', 'clicks', 'completions', 'signups', 'purchases', 'goal completions', 'converted'],
  rate: ['rate', 'conversion rate', 'ctr', 'click rate', 'engagement rate', 'completion rate', '%'],
  bounce: ['bounce rate', 'bounces', 'exit rate', 'exits'],
  time: ['avg time', 'average time', 'time on page', 'session duration', 'engagement time'],
  scroll: ['scroll depth', 'scroll', 'avg scroll'],
  dropoff: ['drop-off', 'dropoff', 'drop off', 'abandonment', 'drop'],
};

export function loadBehavior(dataDir: string, copy: CopyItem[]): BehaviorReport {
  const report: BehaviorReport = {
    signals: [],
    funnel: [],
    notes: [],
    problems: [],
    sourceFiles: [],
  };

  if (!exists(dataDir)) return report;

  const files = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => /\.(csv|tsv|json|md|txt)$/i.test(n))
    // The folder's own README is documentation, not an observation.
    .filter((n) => !/^readme\.(md|txt)$/i.test(n));

  for (const name of files) {
    const full = path.join(dataDir, name);
    const content = read(full);
    if (!content.trim()) continue;
    report.sourceFiles.push(name);
    const source = guessSource(name);

    if (/\.(csv|tsv)$/i.test(name)) {
      const { signals, funnel } = parseDelimited(content, source, name.endsWith('.tsv') ? '\t' : ',');
      report.signals.push(...signals);
      report.funnel.push(...funnel);
    } else if (/\.json$/i.test(name)) {
      report.signals.push(...parseJson(content, source));
    } else {
      report.notes.push(...parseNotes(content));
    }
  }

  report.problems = deriveProblems(report, copy);
  return report;
}

/* ---------------------------------------------------------------- parsing */

function guessSource(filename: string): BehaviorSource {
  const f = filename.toLowerCase();
  if (f.includes('ga4') || f.includes('analytics')) return 'ga4';
  if (f.includes('posthog')) return 'posthog';
  if (f.includes('amplitude')) return 'amplitude';
  if (f.includes('mixpanel')) return 'mixpanel';
  if (f.includes('hotjar')) return 'hotjar';
  if (f.includes('plausible')) return 'plausible';
  if (f.includes('clarity')) return 'clarity';
  if (/\.(md|txt)$/.test(f)) return 'notes';
  if (f.endsWith('.json')) return 'generic-json';
  return 'generic-csv';
}

export function parseDelimited(
  content: string,
  source: BehaviorSource,
  delimiter = ',',
): { signals: BehaviorSignal[]; funnel: FunnelStep[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { signals: [], funnel: [] };

  // GA4 exports carry comment preamble lines starting with '#'.
  const start = lines.findIndex((l) => !l.startsWith('#'));
  const header = splitRow(lines[start] ?? '', delimiter).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(start + 1).map((l) => splitRow(l, delimiter));

  const col = (kind: keyof typeof COLUMN_MAP): number =>
    header.findIndex((h) => (COLUMN_MAP[kind] ?? []).some((alias) => h === alias || h.includes(alias)));

  const iSubject = col('subject');
  const iUsers = col('users');
  const iConv = col('conversions');
  const iRate = col('rate');
  const iBounce = col('bounce');
  const iScroll = col('scroll');
  const iDrop = col('dropoff');

  const signals: BehaviorSignal[] = [];
  const funnel: FunnelStep[] = [];

  for (const row of rows) {
    const subject = (iSubject >= 0 ? row[iSubject] : row[0]) ?? '';
    if (!subject.trim()) continue;

    const users = num(iUsers >= 0 ? row[iUsers] : undefined);
    const conversions = num(iConv >= 0 ? row[iConv] : undefined);
    let rate = num(iRate >= 0 ? row[iRate] : undefined);
    if (rate === undefined && users && conversions !== undefined) {
      rate = (conversions / users) * 100;
    }

    const add = (metric: string, value: number | undefined, unit: BehaviorSignal['unit']) => {
      if (value === undefined || Number.isNaN(value)) return;
      signals.push({
        id: shortHash(source, subject, metric),
        source,
        metric,
        subject: subject.trim(),
        value: round(value),
        unit,
      });
    };

    add('conversion_rate', rate, '%');
    add('users', users, 'count');
    add('conversions', conversions, 'count');
    add('bounce_rate', num(iBounce >= 0 ? row[iBounce] : undefined), '%');
    add('scroll_depth', num(iScroll >= 0 ? row[iScroll] : undefined), '%');

    const dropoff = num(iDrop >= 0 ? row[iDrop] : undefined);
    if (dropoff !== undefined) {
      funnel.push({ name: subject.trim(), users: users ?? 0, dropoff: round(dropoff) });
      add('dropoff', dropoff, '%');
    }
  }

  // If the file looks like an ordered funnel (users descending, no explicit
  // drop-off column), compute drop-off ourselves.
  if (!funnel.length && iUsers >= 0 && rows.length > 1) {
    const steps = rows
      .map((row) => ({
        name: ((iSubject >= 0 ? row[iSubject] : row[0]) ?? '').trim(),
        users: num(row[iUsers]) ?? 0,
      }))
      .filter((s) => s.name && s.users > 0);

    const descending = steps.every((s, i) => i === 0 || s.users <= (steps[i - 1]?.users ?? Infinity));
    if (descending && steps.length >= 2) {
      steps.forEach((step, i) => {
        const prev = steps[i - 1];
        const dropoff = prev ? round(((prev.users - step.users) / prev.users) * 100) : 0;
        funnel.push({ name: step.name, users: step.users, dropoff });
      });
    }
  }

  return { signals, funnel };
}

function parseJson(content: string, source: BehaviorSource): BehaviorSignal[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : Array.isArray((data as Record<string, unknown>)?.results)
      ? ((data as Record<string, unknown>).results as Record<string, unknown>[])
      : Array.isArray((data as Record<string, unknown>)?.rows)
        ? ((data as Record<string, unknown>).rows as Record<string, unknown>[])
        : [data as Record<string, unknown>];

  const signals: BehaviorSignal[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const subject = String(
      row.subject ?? row.event ?? row.name ?? row.label ?? row.page ?? row.step ?? '',
    ).trim();
    if (!subject) continue;

    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'number') continue;
      if (/^(id|timestamp|time)$/i.test(key)) continue;
      signals.push({
        id: shortHash(source, subject, key),
        source,
        metric: key.toLowerCase().replace(/\s+/g, '_'),
        subject,
        value: round(value),
        unit: /rate|percent|pct|%|depth/i.test(key) ? '%' : 'count',
        note: typeof row.note === 'string' ? row.note : undefined,
      });
    }
  }
  return signals;
}

function parseNotes(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 8 && !l.startsWith('#'));
}

/* -------------------------------------------------------------- inference */

/** Rough industry reference points. Beaten by anything in your own data. */
const BENCHMARKS: Record<string, number> = {
  conversion_rate: 3.5,
  bounce_rate: 55,
  scroll_depth: 50,
  dropoff: 30,
};

function deriveProblems(report: BehaviorReport, copy: CopyItem[]): BehaviorProblem[] {
  const problems: BehaviorProblem[] = [];

  for (const signal of report.signals) {
    const benchmark = signal.benchmark ?? BENCHMARKS[signal.metric];
    if (benchmark === undefined) continue;

    const worse =
      signal.metric === 'bounce_rate' || signal.metric === 'dropoff'
        ? signal.value > benchmark
        : signal.value < benchmark;
    if (!worse) continue;

    const gap = Math.abs(signal.value - benchmark);
    problems.push({
      subject: signal.subject,
      evidence: `${signal.metric.replace(/_/g, ' ')} is ${signal.value}${signal.unit === '%' ? '%' : ''} against a ${benchmark}${signal.unit === '%' ? '%' : ''} reference (${signal.source})`,
      severity: gap > 25 ? 'high' : gap > 10 ? 'medium' : 'low',
      relatedCopyIds: matchCopy(signal.subject, copy),
    });
  }

  // The worst funnel step is almost always a copy problem before it is a UX one.
  const worstStep = [...report.funnel].sort((a, b) => b.dropoff - a.dropoff)[0];
  if (worstStep && worstStep.dropoff > 20) {
    problems.push({
      subject: worstStep.name,
      evidence: `Largest funnel drop-off: ${worstStep.dropoff}% of users leave at "${worstStep.name}"`,
      severity: worstStep.dropoff > 50 ? 'high' : 'medium',
      relatedCopyIds: matchCopy(worstStep.name, copy),
    });
  }

  for (const note of report.notes) {
    problems.push({
      subject: note.slice(0, 60),
      evidence: `Human observation: ${note}`,
      severity: 'medium',
      relatedCopyIds: matchCopy(note, copy),
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return problems.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 40);
}

/** Link a metric subject back to the strings it plausibly refers to. */
function matchCopy(subject: string, copy: CopyItem[]): string[] {
  const s = subject.toLowerCase().trim();
  if (!s) return [];
  const tokens = s.split(/[^a-z0-9]+/).filter((t) => t.length > 3);

  return copy
    .filter((item) => {
      const t = item.text.toLowerCase();
      if (t === s) return true;
      if (s.length > 4 && (t.includes(s) || s.includes(t))) return true;
      if (item.file.toLowerCase().includes(s.replace(/^\//, ''))) return true;
      return tokens.length > 0 && tokens.every((tok) => t.includes(tok));
    })
    .slice(0, 8)
    .map((item) => item.id);
}

/* ----------------------------------------------------------------- helpers */

function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ''));
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[,$\s]/g, '').replace('%', '');
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function behaviorSubjects(report: BehaviorReport): string[] {
  return [
    ...report.problems.map((p) => p.subject),
    ...report.funnel.filter((f) => f.dropoff > 20).map((f) => f.name),
  ];
}
