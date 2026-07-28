/**
 * The approval canvas.
 *
 * A local, dependency-free web page where a human reads every proposed change
 * side by side with the current copy, edits anything they want, and approves
 * in one place. Nothing is written to the repo until the Apply button is
 * pressed, and Apply only ever touches approved rows.
 *
 * Bound to 127.0.0.1. It reads and writes your source code — it does not
 * belong on a network interface.
 */

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type {
  ApplyResult,
  DecisionSet,
  Inventory,
  LoopConfig,
  ProposalSet,
} from '../types.js';
import { ACTIVE_STATE_SCHEMA_ERROR, STATE_SCHEMA_VERSION } from '../types.js';
import { writeJson } from '../util/fsx.js';
import { applyProposals } from './apply.js';
import { PRINCIPLES } from './psychology.js';
import { decisionSetFrom } from './state.js';
import { resolveCatalogueScope } from './catalogue.js';

export interface CanvasOptions {
  cwd: string;
  config: LoopConfig;
  set: ProposalSet;
  inventory: Inventory;
  proposalsPath: string;
  decisionsPath: string;
  backupDir: string;
  port: number;
  onApplied?: (results: ApplyResult[]) => void;
}

export function serveCanvas(opts: CanvasOptions): Promise<{ url: string; close: () => void }> {
  const { set, proposalsPath, decisionsPath } = opts;
  assertSafeCanvasState(set, opts.inventory);
  const scope = resolveCatalogueScope(opts.cwd, opts.config);
  if (
    opts.inventory.scopeDigest !== scope.scopeDigest ||
    opts.inventory.sourceLocale !== scope.sourceLocale
  ) {
    throw new Error('active state does not match the configured source catalogue');
  }
  const token = randomBytes(32).toString('hex');

  const currentLedger = (): DecisionSet => decisionSetFrom(
    set,
    set.proposals
      .filter((proposal) => proposal.status === 'approved' || proposal.status === 'rejected')
      .map((proposal) => ({
        proposalId: proposal.id,
        approved: proposal.status === 'approved',
        finalText: proposal.edited ?? proposal.after,
        explicit: true,
      })),
    'canvas',
  );

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      if (!sameToken(url.searchParams.get('token'), token)) {
        return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
      }
      return send(res, 200, 'text/html; charset=utf-8', PAGE);
    }

    if (url.pathname.startsWith('/api/')) {
      const supplied = req.headers['x-marketing-loop-token'];
      if (Array.isArray(supplied) || !sameToken(supplied, token)) {
        return json(res, 403, { error: 'forbidden' });
      }
      if (req.method === 'POST') {
        const address = server.address() as AddressInfo | null;
        const expectedOrigin = address ? `http://127.0.0.1:${address.port}` : '';
        if (req.headers.origin !== expectedOrigin) {
          return json(res, 403, { error: 'invalid origin' });
        }
        const contentType = req.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          return json(res, 415, { error: 'content-type must be application/json' });
        }
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        product: set.product,
        generatedAt: set.generatedAt,
        proposals: set.proposals,
        principles: PRINCIPLES.map((p) => ({ id: p.id, name: p.name, summary: p.summary })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/decide') {
      return body(req, res, (data) => {
        const { id, status, edited } = data as { id: string; status: string; edited?: string };
        const proposal = set.proposals.find((p) => p.id === id);
        if (!proposal) return json(res, 404, { error: 'unknown proposal' });
        if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
          return json(res, 400, { error: 'invalid decision status' });
        }
        proposal.status = status;
        if (typeof edited === 'string') {
          if (edited.length > 1000) return json(res, 400, { error: 'edited text is too long' });
          proposal.edited = edited.trim() && edited.trim() !== proposal.after ? edited.trim() : undefined;
        }
        writeJson(proposalsPath, set);
        writeJson(decisionsPath, currentLedger());
        return json(res, 200, { ok: true, proposal });
      });
    }

    /**
     * Carry one decision across every proposal making the identical change.
     * Deliberately a separate endpoint from /api/decide: fanning out is always
     * something the human asked for, never something that happens because they
     * clicked once.
     */
    if (req.method === 'POST' && url.pathname === '/api/decide-group') {
      return body(req, res, (data) => {
        const { id, status, edited } = data as { id: string; status: string; edited?: string };
        const lead = set.proposals.find((p) => p.id === id);
        if (!lead) return json(res, 404, { error: 'unknown proposal' });
        if (status !== 'approved' && status !== 'rejected') {
          return json(res, 400, { error: 'group decisions must be approve or reject' });
        }

        if (typeof edited === 'string' && edited.length > 1000) {
          return json(res, 400, { error: 'edited text is too long' });
        }
        const text = typeof edited === 'string' && edited.trim() ? edited.trim() : undefined;
        const changed: string[] = [];

        for (const sibId of [id, ...(lead.siblings ?? [])]) {
          const sib = set.proposals.find((p) => p.id === sibId);
          // Never overturn a decision the human already made on a sibling.
          if (!sib || (sib.id !== id && sib.status !== 'pending')) continue;
          sib.status = status;
          if (text) sib.edited = text !== sib.after ? text : undefined;
          changed.push(sib.id);
        }

        writeJson(proposalsPath, set);
        writeJson(decisionsPath, currentLedger());
        return json(res, 200, { ok: true, changed, proposals: set.proposals });
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/apply') {
      return body(req, res, (data) => {
        const { dryRun } = data as { dryRun?: boolean };
        const decisions = currentLedger();
        writeJson(decisionsPath, decisions);
        const results = applyProposals(set, {
          cwd: opts.cwd,
          config: opts.config,
          backupDir: opts.backupDir,
          inventory: opts.inventory,
          decisions,
          dryRun: Boolean(dryRun),
        });
        writeJson(proposalsPath, set);
        if (!dryRun) opts.onApplied?.(results);
        return json(res, 200, { results });
      });
    }

    return send(res, 404, 'text/plain', 'not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/?token=${token}`,
        close: () => server.close(),
      });
    });
  });
}

function send(res: http.ServerResponse, code: number, type: string, payload: string): void {
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  res.end(payload);
}

function json(res: http.ServerResponse, code: number, payload: unknown): void {
  send(res, code, 'application/json', JSON.stringify(payload));
}

function body(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cb: (data: unknown) => void,
): void {
  let raw = '';
  let ended = false;
  req.on('data', (chunk) => {
    if (ended) return;
    raw += chunk;
    if (raw.length > 1_000_000) {
      ended = true;
      json(res, 413, { error: 'request body is too large' });
      req.resume();
    }
  });
  req.on('end', () => {
    if (ended) return;
    try {
      cb(raw ? JSON.parse(raw) : {});
    } catch {
      json(res, 400, { error: 'invalid JSON request body' });
    }
  });
  req.on('error', () => {
    if (!ended) {
      ended = true;
      if (!res.headersSent) json(res, 400, { error: 'request body could not be read' });
    }
  });
}

function sameToken(actual: string | undefined | null, expected: string): boolean {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function assertSafeCanvasState(set: ProposalSet, inventory: Inventory): void {
  if (
    set.schemaVersion !== STATE_SCHEMA_VERSION ||
    inventory.schemaVersion !== STATE_SCHEMA_VERSION ||
    !set.runId ||
    !set.inventoryDigest ||
    set.runId !== inventory.runId ||
    set.inventoryDigest !== inventory.inventoryDigest ||
    set.scopeDigest !== inventory.scopeDigest ||
    set.sourceLocale !== inventory.sourceLocale
  ) {
    throw new Error(ACTIVE_STATE_SCHEMA_ERROR);
  }
  const seen = new Set<string>();
  for (const proposal of set.proposals) {
    if (!/^[a-f0-9]{8}$/.test(proposal.id) || seen.has(proposal.id)) {
      throw new Error(`unsafe or duplicate proposal id: ${proposal.id}`);
    }
    seen.add(proposal.id);
  }
}

/* ------------------------------------------------------------------- page */

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marketing loop — review</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfaf8; --panel: #fff; --ink: #1a1a19; --muted: #6b6a66;
    --line: #e5e2dc; --accent: #0f6d4f; --accent-soft: #e7f2ed;
    --reject: #a63a2b; --reject-soft: #fbecea; --warn: #8a6100; --warn-soft: #fdf3dd;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17171a; --panel: #1f1f23; --ink: #eceae6; --muted: #96948e;
      --line: #32323a; --accent: #4fbe93; --accent-soft: #16302a;
      --reject: #e08476; --reject-soft: #331e1b; --warn: #d6a441; --warn-soft: #33291333;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border-bottom: 1px solid var(--line); padding: 14px 24px;
    display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
  }
  h1 { font-size: 15px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  .spacer { flex: 1; }
  .counts { display: flex; gap: 10px; font-size: 12.5px; color: var(--muted); }
  .counts b { color: var(--ink); font-variant-numeric: tabular-nums; }
  main { max-width: 940px; margin: 0 auto; padding: 24px 24px 140px; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 20px; margin-bottom: 16px; transition: border-color .15s, opacity .15s;
  }
  .card[data-status="approved"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 45%, var(--panel)); }
  .card[data-status="rejected"] { opacity: .5; }
  .card[data-status="applied"] { border-color: var(--accent); opacity: .65; }
  .meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
  .tag {
    font: 11.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px;
  }
  .tag.kind { background: var(--accent-soft); border-color: transparent; color: var(--accent); font-weight: 600; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  @media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
  .side h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .text {
    border: 1px solid var(--line); border-radius: 8px; padding: 11px 13px;
    font-size: 15px; min-height: 62px; white-space: pre-wrap; word-break: break-word;
  }
  .before { background: color-mix(in srgb, var(--reject-soft) 55%, transparent); }
  textarea.text {
    width: 100%; resize: vertical; font: inherit; color: inherit;
    background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  }
  textarea.text:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .why { font-size: 14px; color: var(--ink); margin-bottom: 10px; }
  .why b { font-weight: 620; }
  .alts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .alt {
    font-size: 13px; border: 1px dashed var(--line); background: transparent; color: var(--ink);
    border-radius: 7px; padding: 6px 10px; cursor: pointer;
  }
  .alt:hover { border-style: solid; border-color: var(--accent); }
  details { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
  details summary { cursor: pointer; user-select: none; }
  details ul { margin: 8px 0 0; padding-left: 18px; }
  .warn {
    background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
    border-radius: 8px; padding: 9px 12px; font-size: 13px; margin-bottom: 12px;
  }
  .tag.dupe { background: var(--warn-soft); border-color: transparent; color: var(--warn); font-weight: 600; }
  .locale {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-left: 3px solid var(--accent);
    border-radius: 0 8px 8px 0; padding: 9px 12px; font-size: 13px; margin-bottom: 12px;
  }
  .fanout {
    margin-top: 14px; padding: 13px 15px;
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
    border-radius: 9px; font-size: 13.5px;
  }
  .fanout p { margin: 0 0 8px; }
  .fanlist { margin: 0 0 11px; padding-left: 18px; color: var(--muted); font-size: 12.5px; }
  .fanlist code { font-size: 12px; }
  .fanbtns { display: flex; gap: 8px; }
  .fanyes { background: var(--accent); color: #fff; border-color: transparent; }
  .fandone { margin: 0; color: var(--accent); font-weight: 550; }
  .actions { display: flex; gap: 8px; align-items: center; }
  button {
    font: inherit; font-size: 13.5px; font-weight: 550; border-radius: 8px;
    padding: 8px 14px; cursor: pointer; border: 1px solid var(--line);
    background: var(--panel); color: var(--ink);
  }
  button:hover { border-color: var(--muted); }
  button.yes[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.no[aria-pressed="true"] { background: var(--reject); border-color: var(--reject); color: #fff; }
  footer {
    position: fixed; bottom: 0; left: 0; right: 0; padding: 14px 24px;
    background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(12px);
    border-top: 1px solid var(--line); display: flex; gap: 12px; align-items: center;
  }
  footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; padding: 10px 20px; }
  footer .primary:disabled { opacity: .4; cursor: not-allowed; }
  .log { font: 12px ui-monospace, Menlo, monospace; color: var(--muted); max-height: 42px; overflow: auto; flex: 1; }
  .empty { text-align: center; color: var(--muted); padding: 80px 20px; }
  kbd { font: 11px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 1px 5px; }
</style>
</head>
<body>
<header>
  <h1>Marketing loop</h1>
  <span class="sub" id="product"></span>
  <span class="spacer"></span>
  <span class="counts">
    <span><b id="c-approved">0</b> approved</span>
    <span><b id="c-pending">0</b> pending</span>
    <span><b id="c-rejected">0</b> rejected</span>
  </span>
</header>
<main id="list"><div class="empty">Loading…</div></main>
<footer>
  <button class="primary" id="apply" disabled>Apply approved changes</button>
  <button id="dry">Dry run</button>
  <span class="log" id="log"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject</span>
</footer>
<script>
var state = { proposals: [], cursor: 0 };
var launchToken = new URLSearchParams(window.location.search).get('token') || '';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function api(path, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers || {}, {
    'x-marketing-loop-token': launchToken
  });
  return fetch(path, options).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok) throw new Error(data.error || ('Request failed: ' + response.status));
      return data;
    });
  });
}

function load() {
  api('/api/state').then(function (data) {
    state.proposals = data.proposals;
    document.getElementById('product').textContent =
      data.product + ' · ' + data.proposals.length + ' proposals';
    render();
  });
}

function render() {
  var list = document.getElementById('list');
  if (!state.proposals.length) {
    list.innerHTML = '<div class="empty">No proposals. Run <code>marketing-loop propose</code> first.</div>';
    return;
  }
  list.innerHTML = state.proposals.map(card).join('');
  bind();
  counts();
}

function card(p, i) {
  var confidence = Math.round((p.confidence || 0) * 100);
  var alts = (p.alternatives || []).map(function (a) {
    return '<button class="alt" data-alt="' + esc(a) + '" data-id="' + p.id + '">' + esc(a) + '</button>';
  }).join('');
  var warnings = (p.warnings || []).length
    ? '<div class="warn"><b>Guardrail:</b> ' + p.warnings.map(esc).join('<br>') + '</div>' : '';
  var evidence = (p.evidence || []).length
    ? '<details><summary>Evidence &amp; source</summary><ul>' +
      p.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>' : '';

  var pending = pendingSiblings(p);
  var dupeTag = (p.siblings || []).length
    ? '<span class="tag dupe">' + ((p.siblings.length + 1)) + ' identical</span>' : '';
  var localeNote = p.localeWarning
    ? '<div class="locale"><b>Translation.</b> ' + esc(p.localeWarning) + '</div>' : '';

  return '' +
  '<article class="card" data-id="' + p.id + '" data-status="' + esc(p.status) + '" id="card-' + p.id + '">' +
    '<div class="meta">' +
      '<span class="tag kind">' + esc(p.kind) + '</span>' +
      '<span class="tag">' + esc(p.file) + ':' + esc(p.line) + '</span>' +
      '<span class="tag">' + confidence + '% confident</span>' +
      '<span class="tag">' + esc(p.author) + '</span>' +
      dupeTag +
      (p.principles || []).map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join('') +
    '</div>' +
    localeNote +
    warnings +
    '<div class="pair">' +
      '<div class="side"><h4>Now</h4><div class="text before">' + esc(p.before) + '</div></div>' +
      '<div class="side"><h4>Proposed — edit freely</h4>' +
        '<textarea class="text final" rows="3" data-id="' + p.id + '">' + esc(p.edited || p.after) + '</textarea>' +
      '</div>' +
    '</div>' +
    (alts ? '<div class="alts">' + alts + '</div>' : '') +
    '<p class="why"><b>Why.</b> ' + esc(p.rationale) + '</p>' +
    '<p class="why"><b>Problem it solves.</b> ' + esc(p.problemSolved) + '</p>' +
    evidence +
    '<div class="actions">' +
      '<button class="yes" data-id="' + p.id + '" aria-pressed="' + (p.status === 'approved') + '">Approve</button>' +
      '<button class="no" data-id="' + p.id + '" aria-pressed="' + (p.status === 'rejected') + '">Reject</button>' +
    '</div>' +
    '<div class="fanout" id="fan-' + p.id + '" hidden></div>' +
  '</article>';
}

/** Siblings nobody has ruled on yet — the only ones a fan-out should touch. */
function pendingSiblings(p) {
  return (p.siblings || [])
    .map(function (id) { return state.proposals.find(function (x) { return x.id === id; }); })
    .filter(function (x) { return x && x.status === 'pending'; });
}

function decide(id, status, edited) {
  return api('/api/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id, status: status, edited: edited })
  }).then(function (data) {
    if (!data.proposal) return;
    var idx = state.proposals.findIndex(function (p) { return p.id === id; });
    if (idx >= 0) state.proposals[idx] = data.proposal;
    paintCard(data.proposal);
    counts();
    offerFanout(data.proposal);
  });
}

function paintCard(p) {
  var el = document.getElementById('card-' + p.id);
  if (el) el.setAttribute('data-status', p.status);
  var yes = document.querySelector('.yes[data-id="' + p.id + '"]');
  var no = document.querySelector('.no[data-id="' + p.id + '"]');
  if (yes) yes.setAttribute('aria-pressed', String(p.status === 'approved'));
  if (no) no.setAttribute('aria-pressed', String(p.status === 'rejected'));
}

/**
 * Ask before carrying a decision to identical strings elsewhere. Never assume:
 * the whole point of this tool is that a person saw each change before it
 * reached the code, and silently approving eleven files on one click would
 * throw that away for the sake of a click.
 */
function offerFanout(p) {
  var box = document.getElementById('fan-' + p.id);
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';

  if (p.status !== 'approved' && p.status !== 'rejected') return;

  var others = pendingSiblings(p);
  if (!others.length) return;

  var verb = p.status === 'approved' ? 'Approve' : 'Reject';
  var files = others.slice(0, 8).map(function (o) { return '<li><code>' + esc(o.file) + ':' + o.line + '</code></li>'; }).join('');
  var more = others.length > 8 ? '<li>and ' + (others.length - 8) + ' more</li>' : '';

  box.innerHTML =
    '<p><b>' + others.length + ' other file' + (others.length === 1 ? '' : 's') +
      ' make' + (others.length === 1 ? 's' : '') + ' the identical change.</b> ' + verb + ' those too?</p>' +
    '<ul class="fanlist">' + files + more + '</ul>' +
    '<div class="fanbtns">' +
      '<button class="fanyes" data-id="' + p.id + '" data-status="' + p.status + '">' +
        verb + ' all ' + (others.length + 1) + '</button>' +
      '<button class="fanno" data-id="' + p.id + '">Just this one</button>' +
    '</div>';
  box.hidden = false;

  // This box is built after bind() ran, so it wires its own buttons.
  var yes = box.querySelector('.fanyes');
  if (yes) yes.onclick = function () { fanout(p.id, p.status); };
  var no = box.querySelector('.fanno');
  if (no) no.onclick = function () { box.hidden = true; box.innerHTML = ''; };
}

function fanout(id, status) {
  var textarea = document.querySelector('.final[data-id="' + id + '"]');
  return api('/api/decide-group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id, status: status, edited: textarea ? textarea.value : undefined })
  }).then(function (data) {
    if (!data.proposals) return;
    state.proposals = data.proposals;
    var box = document.getElementById('fan-' + id);
    if (box) {
      box.innerHTML = '<p class="fandone">' + data.changed.length + ' proposals set to ' + status + '.</p>';
    }
    data.changed.forEach(function (cid) {
      var p = state.proposals.find(function (x) { return x.id === cid; });
      if (p) paintCard(p);
    });
    counts();
  });
}

function bind() {
  document.querySelectorAll('.yes').forEach(function (b) {
    b.onclick = function () {
      var id = b.dataset.id;
      var ta = document.querySelector('textarea[data-id="' + id + '"]');
      decide(id, 'approved', ta ? ta.value : undefined);
    };
  });
  document.querySelectorAll('.no').forEach(function (b) {
    b.onclick = function () { decide(b.dataset.id, 'rejected'); };
  });
  document.querySelectorAll('.alt').forEach(function (b) {
    b.onclick = function () {
      var ta = document.querySelector('textarea[data-id="' + b.dataset.id + '"]');
      if (ta) { ta.value = b.dataset.alt; ta.focus(); }
    };
  });
  document.querySelectorAll('textarea.final').forEach(function (ta) {
    ta.onblur = function () {
      var p = state.proposals.find(function (x) { return x.id === ta.dataset.id; });
      if (p && p.status === 'approved') decide(ta.dataset.id, 'approved', ta.value);
    };
  });
}

function counts() {
  var by = { approved: 0, pending: 0, rejected: 0, applied: 0 };
  state.proposals.forEach(function (p) { by[p.status] = (by[p.status] || 0) + 1; });
  document.getElementById('c-approved').textContent = by.approved + by.applied;
  document.getElementById('c-pending').textContent = by.pending;
  document.getElementById('c-rejected').textContent = by.rejected;
  document.getElementById('apply').disabled = by.approved === 0;
}

function run(dryRun) {
  var log = document.getElementById('log');
  log.textContent = dryRun ? 'Dry run…' : 'Applying…';
  api('/api/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dryRun: !!dryRun })
  }).then(function (data) {
    var ok = data.results.filter(function (r) { return r.ok; }).length;
    var bad = data.results.filter(function (r) { return !r.ok; });
    log.textContent = (dryRun ? 'Dry run: ' : 'Applied ') + ok + ' change' + (ok === 1 ? '' : 's') +
      (bad.length ? ' · ' + bad.length + ' refused: ' + bad.map(function (b) { return b.file + ' — ' + b.reason; }).join('; ') : '');
    if (!dryRun) load();
  });
}

document.getElementById('apply').onclick = function () { run(false); };
document.getElementById('dry').onclick = function () { run(true); };

document.addEventListener('keydown', function (e) {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  if (!cards.length) return;
  if (e.key === 'j' || e.key === 'k') {
    state.cursor = Math.max(0, Math.min(cards.length - 1, state.cursor + (e.key === 'j' ? 1 : -1)));
    cards[state.cursor].scrollIntoView({ behavior: 'smooth', block: 'center' });
    cards[state.cursor].style.outline = '2px solid var(--accent)';
    cards.forEach(function (c, i) { if (i !== state.cursor) c.style.outline = 'none'; });
  }
  if (e.key === 'a' || e.key === 'r') {
    var id = cards[state.cursor].dataset.id;
    var ta = document.querySelector('textarea[data-id="' + id + '"]');
    decide(id, e.key === 'a' ? 'approved' : 'rejected', e.key === 'a' && ta ? ta.value : undefined);
  }
});

load();
</script>
</body>
</html>`;
