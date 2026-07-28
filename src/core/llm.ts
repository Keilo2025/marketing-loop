/**
 * Optional API-model stage.
 *
 * The loop does not need this. Inside a coding agent the agent *is* the model
 * and reads `brief.md`. This exists for the standalone case — CI, a cron job,
 * a repo nobody is sitting in front of — where you want the open items filled
 * in without a human present. The approval gate still applies afterwards.
 */

import type { LoopConfig, Proposal } from '../types.js';
import { shortHash } from '../util/fsx.js';

export type Provider = 'anthropic' | 'openai' | 'none';

export function detectProvider(): { provider: Provider; key?: string; model: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.MARKETING_LOOP_MODEL ?? 'claude-sonnet-5',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      key: process.env.OPENAI_API_KEY,
      model: process.env.MARKETING_LOOP_MODEL ?? 'gpt-5',
    };
  }
  return { provider: 'none', model: '' };
}

const SYSTEM = `You are a conversion copywriter for a configured source catalogue. You rewrite source messages so they sell the outcome the reader gets, not the feature that produces it.

Hard constraints:
- Never invent a fact, number, customer, testimonial, guarantee or deadline. If a rewrite needs one, leave it out and add "NEEDS-FACT: <question>" to the evidence array.
- Never produce a dark pattern: fabricated urgency or scarcity, confirmshaming, hidden billing, fake social proof, decline options framed as mistakes.
- Use only source-catalogue text, approved claims, marketing data, and the brief. Never suggest or access application code, components, logic, or target locales.
- Every proposal must carry a rationale a sceptical founder would accept, naming the mechanism and why it applies to this specific string.
- Respond with JSON only. No prose, no code fences.`;

export async function generateWithLlm(
  brief: string,
  config: LoopConfig,
  limit: number,
): Promise<Proposal[]> {
  const { provider, key, model } = detectProvider();
  if (provider === 'none' || !key) {
    throw new Error(
      'No ANTHROPIC_API_KEY or OPENAI_API_KEY found. Either export one, or open this repo in a coding agent and point it at .marketing-loop/brief.md.',
    );
  }

  const prompt = `${brief}\n\n---\n\nReturn JSON: {"proposals":[...]} with at most ${limit} proposals, highest impact first. Follow the schema in the brief exactly.`;

  const raw =
    provider === 'anthropic'
      ? await callAnthropic(key, model, prompt)
      : await callOpenai(key, model, prompt);

  return parseProposals(raw, config);
}

async function callAnthropic(key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

async function callOpenai(key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? '';
}

export function parseProposals(raw: string, config: LoopConfig): Proposal[] {
  const json = extractJson(raw);
  if (!json) return [];

  let parsed: { proposals?: unknown };
  try {
    parsed = JSON.parse(json) as { proposals?: unknown };
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  const out: Proposal[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const before = str(p.before);
    const after = str(p.after);
    if (!before || !after || before === after) continue;

    out.push({
      id: str(p.id) || shortHash('llm', before, after),
      copyId: str(p.copyId),
      catalogueKey: '',
      sourceLocale: '',
      scopeDigest: '',
      file: str(p.file),
      line: Number(p.line) || 0,
      kind: (str(p.kind) || 'unknown') as Proposal['kind'],
      before,
      after,
      alternatives: Array.isArray(p.alternatives) ? p.alternatives.map(str).filter(Boolean) : [],
      rationale: str(p.rationale),
      problemSolved: str(p.problemSolved),
      principles: Array.isArray(p.principles) ? p.principles.map(str).filter(Boolean) : [],
      evidence: Array.isArray(p.evidence) ? p.evidence.map(str).filter(Boolean) : [],
      confidence: clamp(Number(p.confidence)),
      status: 'pending',
      author: 'llm',
    });

    if (out.length >= config.maxProposals) break;
  }

  return out;
}

function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
