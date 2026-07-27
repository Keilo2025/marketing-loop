/**
 * Copy extraction.
 *
 * No AST, on purpose. This has to run against half-finished vibe-coded repos
 * where the TSX does not parse, the Vue file has three script blocks and the
 * HTML was pasted from a template. Line-oriented pattern matching degrades
 * gracefully; a parser throws and gives you nothing.
 *
 * The cost is precision, so `looksLikeCopy` does the heavy lifting: it is the
 * filter between "user-facing sentence" and "tailwind class soup".
 */

import path from 'node:path';
import type { CopyItem, CopyKind, Surface } from '../types.js';
import { shortHash } from '../util/fsx.js';

export const SCANNABLE = [
  '.tsx', '.jsx', '.ts', '.js', '.mjs', '.html', '.htm', '.vue', '.svelte',
  '.astro', '.md', '.mdx', '.json', '.yml', '.yaml', '.liquid', '.erb', '.php',
];

/** Attributes whose values are shown to a user. */
const COPY_ATTRS = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'arialabel', 'label',
  'heading', 'headline', 'subtitle', 'subheading', 'description', 'tagline',
  'cta', 'ctatext', 'buttontext', 'buttonlabel', 'submitlabel', 'emptytext',
  'helptext', 'hint', 'tooltip', 'confirmtext', 'canceltext', 'successmessage',
  'errormessage', 'value',
]);

/** Attributes that never contain copy, however tempting they look. */
const CODE_ATTRS = new Set([
  'class', 'classname', 'id', 'key', 'href', 'src', 'srcset', 'type', 'name',
  'role', 'style', 'rel', 'target', 'width', 'height', 'viewbox', 'd', 'fill',
  'stroke', 'path', 'to', 'as', 'variant', 'size', 'color', 'icon', 'data-testid',
  'testid', 'ref', 'for', 'action', 'method', 'lang', 'charset', 'property',
]);

/** Variable names that usually hold copy. */
const COPY_IDENT =
  /\b(title|heading|headline|subhead(?:ing|line)?|tagline|slogan|cta|ctaText|label|description|desc|subtitle|copy|message|msg|body|blurb|prompt|placeholder|empty(?:State|Text)?|error|success|hint|help|banner|badge|benefit|feature(?:Title|Desc)?|valueProp|pitch)\s*[:=]\s*(['"`])/gi;

const TAILWIND_HINT =
  /^(sm:|md:|lg:|xl:|2xl:|hover:|focus:|active:|dark:|group-|peer-)?(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|text-|bg-|border|rounded|p[xytblr]?-|m[xytblr]?-|w-|h-|min-|max-|gap-|space-|items-|justify-|font-|leading-|tracking-|shadow|opacity-|z-|overflow-|transition|duration-|ease-|cursor-|select-|whitespace-|truncate|container|mx-auto|col-|row-|order-|aspect-|object-|ring-|divide-|backdrop-|animate-)/;

export function extractFromFile(
  relPath: string,
  content: string,
): CopyItem[] {
  const ext = path.extname(relPath).toLowerCase();
  const surface = inferSurface(relPath);
  const items: CopyItem[] = [];
  const seen = new Map<string, number>();

  const push = (
    text: string,
    index: number,
    kind: CopyKind,
    context: string[],
    element?: string,
    attr?: string,
  ) => {
    const clean = normalise(text);
    if (!looksLikeCopy(clean, attr)) return;
    const occurrence = seen.get(clean) ?? 0;
    seen.set(clean, occurrence + 1);
    items.push({
      id: shortHash(relPath, clean, String(occurrence)),
      file: relPath,
      line: lineOf(content, index),
      text: clean,
      kind,
      surface,
      element,
      attr,
      context,
      length: clean.length,
    });
  };

  if (['.md', '.mdx'].includes(ext)) {
    extractMarkdown(content, push);
  } else if (ext === '.json') {
    extractJson(content, push);
  } else if (['.yml', '.yaml'].includes(ext)) {
    extractYaml(content, push);
  } else {
    // Everything else is markup-ish: HTML, JSX, Vue, Svelte, Astro, Liquid, ERB, PHP.
    extractMarkup(content, push);
    extractIdentifiers(content, push);
  }

  return items;
}

type Push = (
  text: string,
  index: number,
  kind: CopyKind,
  context: string[],
  element?: string,
  attr?: string,
) => void;

/* ------------------------------------------------------------------ markup */

function extractMarkup(content: string, push: Push): void {
  // 1. Text sitting directly between tags.
  //    The closing `<` is a lookahead, not a match — consuming it would swallow
  //    the next opening tag and lose every element that follows a whitespace-only
  //    text node, which is most of them in formatted HTML.
  const textNode = /<([a-zA-Z][\w.-]*)((?:[^<>'"]|'[^']*'|"[^"]*")*)>([^<>{}]{2,300})(?=<)/g;
  let m: RegExpExecArray | null;
  while ((m = textNode.exec(content))) {
    const [, tag = '', attrs = '', text = ''] = m;
    if (/^(script|style|svg|path|code|pre)$/i.test(tag)) continue;
    const index = m.index + m[0].length - text.length;
    push(text, index, kindForTag(tag, attrs, text), tagContext(tag, attrs), tag);
  }

  // 2. Attribute values that are copy.
  const attrPair = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]{2,300})"|'([^']{2,300})')/g;
  while ((m = attrPair.exec(content))) {
    const name = (m[1] ?? '').toLowerCase().replace(/[^a-z-]/g, '');
    const value = m[2] ?? m[3] ?? '';
    if (CODE_ATTRS.has(name)) continue;
    if (!COPY_ATTRS.has(name) && !COPY_ATTRS.has(name.replace(/-/g, ''))) continue;
    push(value, m.index, kindForAttr(name), [`attr:${name}`], undefined, name);
  }

  // 3. <meta name="description"> and Open Graph — pure marketing surface.
  const meta = /<meta\s+[^>]*?(?:name|property)\s*=\s*["'](description|og:title|og:description|twitter:title|twitter:description)["'][^>]*?content\s*=\s*["']([^"']{2,300})["']/gi;
  while ((m = meta.exec(content))) {
    push(m[2] ?? '', m.index, 'meta', [`meta:${m[1]}`], 'meta', 'content');
  }
}

/* ------------------------------------------------------- string identifiers */

function extractIdentifiers(content: string, push: Push): void {
  COPY_IDENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COPY_IDENT.exec(content))) {
    const quote = m[2] ?? '"';
    const start = m.index + m[0].length;
    const end = content.indexOf(quote, start);
    if (end === -1 || end - start > 300) continue;
    const value = content.slice(start, end);
    const ident = (m[1] ?? '').toLowerCase();
    push(value, start, kindForIdent(ident), [`ident:${m[1]}`]);
  }
}

/* -------------------------------------------------------------- markdown */

function extractMarkdown(content: string, push: Push): void {
  const lines = content.split('\n');
  let offset = 0;
  let inFence = false;
  let inFrontmatter = false;

  for (const [i, line] of lines.entries()) {
    const lineStart = offset;
    offset += line.length + 1;

    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (line.trim() === '---') { inFrontmatter = false; continue; }
      const fm = /^(title|description|tagline|subtitle|summary|excerpt)\s*:\s*["']?(.+?)["']?\s*$/i.exec(line);
      if (fm) push(fm[2] ?? '', lineStart, 'meta', ['frontmatter'], undefined, fm[1]);
      continue;
    }
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const heading = /^(#{1,6})\s+(.{2,200})$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      push(heading[2] ?? '', lineStart, level === 1 ? 'headline' : 'subhead', [`h${level}`]);
      continue;
    }

    const cta = /^\s*\[([^\]]{2,80})\]\(([^)]+)\)\s*$/.exec(line);
    if (cta) {
      push(cta[1] ?? '', lineStart, 'cta', ['markdown-link']);
      continue;
    }

    const body = line.trim();
    if (body.length > 20 && !/^[|>\-*+\d]/.test(body)) push(body, lineStart, 'body', ['paragraph']);
  }
}

/* ------------------------------------------------------------------- json */

function extractJson(content: string, push: Push): void {
  // i18n bundles and content files. Keys carry the intent.
  const pair = /"([^"\\]{1,60})"\s*:\s*"((?:[^"\\]|\\.){2,300})"/g;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(content))) {
    const key = m[1] ?? '';
    const value = (m[2] ?? '').replace(/\\"/g, '"');
    if (/^(\$schema|version|type|id|url|src|path|href|icon|color|class|name)$/i.test(key)) continue;
    push(value, m.index, kindForIdent(key.toLowerCase()), [`key:${key}`]);
  }
}

function extractYaml(content: string, push: Push): void {
  const pair = /^\s*([\w.-]{1,60})\s*:\s*["']?([^"'\n#][^\n#]{2,300}?)["']?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(content))) {
    const key = (m[1] ?? '').toLowerCase();
    if (/^(version|id|url|src|path|image|icon|color|type|name|uses|run|on|with)$/.test(key)) continue;
    push(m[2] ?? '', m.index, kindForIdent(key), [`key:${key}`]);
  }
}

/* -------------------------------------------------------------- heuristics */

export function looksLikeCopy(text: string, attr?: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 300) return false;
  if (!/[a-zA-Z]/.test(t)) return false;

  // Template expressions, JSX, code fragments.
  if (/[{}<>$`]|=>|\/\/|\*\/|::/.test(t)) return false;
  // URLs, paths, imports, mime types, selectors.
  if (/^(https?:\/\/|\/|\.\/|\.\.\/|#|@|data:|mailto:)/.test(t)) return false;
  if (/^[\w.-]+\.(png|jpe?g|svg|gif|webp|css|js|ts|tsx|json|woff2?)$/i.test(t)) return false;
  // SCREAMING_CONSTANTS and camelCaseIdentifiers.
  if (/^[A-Z0-9_]{2,}$/.test(t)) return false;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return false;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(t)) return false;

  const words = t.split(/\s+/);

  // Tailwind / utility class soup.
  if (words.length >= 2 && words.every((w) => TAILWIND_HINT.test(w))) return false;
  if (words.length >= 3 && words.filter((w) => TAILWIND_HINT.test(w)).length / words.length > 0.6) {
    return false;
  }

  // Single words are only copy in places where single words are copy.
  if (words.length === 1) {
    const singleWordOk = attr
      ? COPY_ATTRS.has(attr)
      : /^[A-Z][a-z]{2,}$/.test(t);
    if (!singleWordOk) return false;
    if (t.length < 3) return false;
  }

  // Must contain at least one vowel-bearing real word.
  if (!words.some((w) => /[aeiouAEIOU]/.test(w) && w.length >= 2)) return false;

  return true;
}

function normalise(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function kindForTag(tag: string, attrs: string, text: string): CopyKind {
  const t = tag.toLowerCase();
  const a = attrs.toLowerCase();
  if (t === 'h1') return 'headline';
  if (/^h[2-3]$/.test(t)) return 'subhead';
  if (/^h[4-6]$/.test(t)) return 'label';
  if (t === 'title') return 'meta';
  if (t === 'button') return 'cta';
  if (t === 'label') return 'label';
  if (t === 'a' && (/\b(btn|button|cta|primary|action)\b/.test(a) || text.trim().length < 32)) return 'cta';
  if (t === 'li' || t === 'nav') return 'nav';
  // Order matters: "hero-sub" and "hero-subtitle" are subheads, not headlines,
  // and both contain the word hero.
  if (/(sub(title|head|heading)?\b|\blead\b|\btagline\b|\bdescription\b)/.test(a)) return 'subhead';
  if (/\b(hero|headline|title)\b/.test(a)) return 'headline';
  if (/\b(price|pricing|plan|tier)\b/.test(a)) return 'pricing';
  if (/\b(error|invalid|danger)\b/.test(a)) return 'error';
  if (/\b(empty|placeholder|zero-state)\b/.test(a)) return 'empty-state';
  if (t === 'p' || t === 'span' || t === 'div') return 'body';
  return 'unknown';
}

function kindForAttr(attr: string): CopyKind {
  if (/cta|button|submit/.test(attr)) return 'cta';
  if (/headline|heading|title/.test(attr)) return 'headline';
  if (/sub(title|head)|tagline/.test(attr)) return 'subhead';
  if (/error/.test(attr)) return 'error';
  if (/empty/.test(attr)) return 'empty-state';
  if (/placeholder|hint|help|tooltip/.test(attr)) return 'label';
  if (/description|alt/.test(attr)) return 'meta';
  return 'label';
}

function kindForIdent(ident: string): CopyKind {
  const i = ident.toLowerCase();
  if (/cta|button|submit|action/.test(i)) return 'cta';
  if (/headline|hero|^title$/.test(i)) return 'headline';
  if (/sub(title|head)|tagline|slogan|lead/.test(i)) return 'subhead';
  if (/error|invalid|fail/.test(i)) return 'error';
  if (/empty|zero/.test(i)) return 'empty-state';
  if (/price|plan|tier/.test(i)) return 'pricing';
  if (/label|placeholder|hint|help/.test(i)) return 'label';
  if (/desc|blurb|body|copy|message|msg|benefit|valueprop|pitch/.test(i)) return 'body';
  return 'unknown';
}

function tagContext(tag: string, attrs: string): string[] {
  const ctx = [`tag:${tag}`];
  const cls = /class(?:Name)?\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (cls?.[1]) ctx.push(`class:${cls[1].split(/\s+/).slice(0, 6).join(' ')}`);
  const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (id?.[1]) ctx.push(`id:${id[1]}`);
  return ctx;
}

/**
 * Legal text. Checked before everything else, because `terms/pricing-terms.md`
 * is a legal document that happens to mention pricing, and rewriting a clause
 * to convert better is how a marketing tool creates a legal problem.
 */
const LEGAL =
  /(terms|tos\b|privacy|policy|policies|legal|gdpr|ccpa|cookie|imprint|impressum|eula|disclaimer|licen[cs]e|\bdpa\b|compliance|refund|acceptable-?use|data-?protection)/;

/**
 * Documents written for the team, not the customer. These are the bulk of the
 * noise in a repo that keeps planning notes in Markdown.
 */
const INTERNAL =
  /(^|\/)(\.github|\.changeset|adr|rfcs?|specs?|notes|planning|roadmap|internal|scratch|prompts?|agents?|\.cursor|\.windsurf|\.clinerules|\.marketing-loop)(\/|$)|(changelog|contributing|code_of_conduct|security\.md|todo\.md|architecture\.md)/;

export function inferSurface(relPath: string): Surface {
  const p = relPath.toLowerCase();

  if (LEGAL.test(p)) return 'legal';
  if (INTERNAL.test(p)) return 'internal';
  if (/(landing|marketing|\bhero\b|home|index\.html|\/site\/|\/www\/|\/web\/|\(marketing\))/.test(p)) return 'landing';
  if (/(email|mail|newsletter|templates?\/.*mail)/.test(p)) return 'email';
  if (/(^|\/)(docs?|guides?|handbook)(\/|$)|readme\.md$/.test(p)) return 'docs';
  if (/(store|app-?store|play-?store|listing|metadata\/)/.test(p)) return 'store';
  if (/(pricing|checkout|signup|register|onboarding|upgrade)/.test(p)) return 'landing';
  return 'app';
}
