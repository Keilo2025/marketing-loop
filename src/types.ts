/**
 * Shared types for the marketing loop.
 *
 * The loop is deliberately file-based: every stage reads and writes JSON in
 * `.marketing-loop/` so a coding agent, a human, and the CLI can all pick the
 * work up mid-flight without holding state in memory.
 */

export type CopyKind =
  | 'headline'
  | 'subhead'
  | 'cta'
  | 'body'
  | 'label'
  | 'nav'
  | 'meta'
  | 'error'
  | 'empty-state'
  | 'pricing'
  | 'unknown';

export type Surface = 'landing' | 'app' | 'email' | 'docs' | 'store' | 'legal' | 'internal' | 'unknown';

/**
 * Surfaces the loop is allowed to rewrite.
 *
 * `legal` and `internal` are deliberately absent from the default. Terms of
 * service, privacy policies and internal planning documents are not conversion
 * copy, and a tool that cheerfully rewrites your indemnity clause to be more
 * persuasive is a liability rather than a feature.
 */
export const DEFAULT_SURFACES: Surface[] = ['landing', 'store', 'email', 'app'];

export type SourceRepresentation =
  | 'plain'
  | 'html-text'
  | 'html-attribute-double'
  | 'html-attribute-single'
  | 'js-string-double'
  | 'js-string-single'
  | 'js-template'
  | 'json-string'
  | 'yaml-plain'
  | 'yaml-double'
  | 'yaml-single';

export interface SourceSpan {
  /** Exact bytes between the source delimiters. */
  raw: string;
  /** Zero-based start offset, inclusive. */
  start: number;
  /** Zero-based end offset, exclusive. */
  end: number;
  representation: SourceRepresentation;
  applicable: boolean;
}

/** A single string of user-facing copy located in the codebase. */
export interface CopyItem {
  /** Stable id: short hash of catalogue file + canonical key. */
  id: string;
  /** Canonical dotted path used by the source message catalogue. */
  catalogueKey: string;
  /** Locale that owns this catalogue entry. */
  sourceLocale: string;
  /** Digest of the resolved catalogue boundary that produced this entry. */
  scopeDigest?: string;
  /** Repo-relative path. */
  file: string;
  /** 1-based line number of the string. */
  line: number;
  /** The exact literal contents as they appear in source (unescaped). */
  text: string;
  /** How the string is used, inferred from its surroundings. */
  kind: CopyKind;
  /** Which product surface the file belongs to. */
  surface: Surface;
  /** HTML element or component the string sits in, when detectable. */
  element?: string;
  /** Attribute name if the copy came from an attribute (placeholder, alt, title...). */
  attr?: string;
  /** Free-form hints used by the analyser: class names, component name, nearby ids. */
  context: string[];
  /** Number of characters — cheap proxy for headline vs body. */
  length: number;
  /** SHA-256 of the complete source file at scan time. */
  fileHash?: string;
  /** Exact source representation used by the safe apply stage. */
  source?: SourceSpan;
}

export interface Inventory {
  schemaVersion: 4;
  runId: string;
  inventoryDigest: string;
  generatedAt: string;
  repositoryRoot: string;
  filesScanned: number;
  filesWithCopy: number;
  truncated: boolean;
  items: CopyItem[];
}

/** A problem the analyser found with an existing string. */
export interface CopyFinding {
  copyId: string;
  rule: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  /** Psychology principle ids that would address it. */
  suggests: string[];
}

export interface Feature {
  name: string;
  /** File paths / symbols that prove the feature exists. */
  evidence: string[];
  /** What the user can now do — filled by the analyser or the agent. */
  capability?: string;
  /** The problem it removes — the thing worth selling. */
  problem?: string;
  /** The outcome the user gets. */
  outcome?: string;
}

export interface ProductModel {
  name: string;
  tagline?: string;
  description?: string;
  stack: string[];
  routes: string[];
  features: Feature[];
  /** Signals about who this is for, pulled from code, README and config. */
  audienceHints: string[];
  /** Pricing tiers found in the code, if any. */
  pricingTiers: string[];
  /** Integrations found in dependencies — often the strongest proof points. */
  integrations: string[];
  generatedAt: string;
}

export type BehaviorSource =
  | 'ga4'
  | 'posthog'
  | 'amplitude'
  | 'mixpanel'
  | 'hotjar'
  | 'plausible'
  | 'clarity'
  | 'notes'
  | 'generic-csv'
  | 'generic-json';

export interface BehaviorSignal {
  id: string;
  source: BehaviorSource;
  /** e.g. "cta_click_rate", "bounce_rate", "scroll_depth", "step_dropoff". */
  metric: string;
  /** What the metric is about — a CTA label, a route, a funnel step. */
  subject: string;
  value: number;
  unit: '%' | 'count' | 'seconds' | 'ratio';
  /** Optional benchmark to compare against. */
  benchmark?: number;
  note?: string;
}

export interface FunnelStep {
  name: string;
  users: number;
  /** Drop-off from the previous step, as a percentage. */
  dropoff: number;
}

export interface BehaviorReport {
  signals: BehaviorSignal[];
  funnel: FunnelStep[];
  /** Plain-language notes the human wrote in data/notes.md. */
  notes: string[];
  /** Ranked list of what the data says is broken. */
  problems: BehaviorProblem[];
  sourceFiles: string[];
}

export interface BehaviorProblem {
  /** What is underperforming. */
  subject: string;
  /** Why we think so, in one line. */
  evidence: string;
  severity: 'low' | 'medium' | 'high';
  /** Copy ids this problem plausibly maps to. */
  relatedCopyIds: string[];
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';

export interface Proposal {
  id: string;
  copyId: string;
  file: string;
  line: number;
  kind: CopyKind;
  /** Exact current text. Must match the file for apply to run. */
  before: string;
  /** Recommended replacement. */
  after: string;
  /** Alternates the human can pick instead, cheapest way to give real choice. */
  alternatives: string[];
  /** Why this wins — written for a human, not a model. */
  rationale: string;
  /** The user problem this copy now solves. */
  problemSolved: string;
  /** Psychology principle ids applied. */
  principles: string[];
  /** Behavior signals or code facts backing it. */
  evidence: string[];
  /** 0–1. Below 0.5 means "needs a human to think about it". */
  confidence: number;
  status: ProposalStatus;
  /** Human's replacement text, typed on the canvas. Wins over `after`. */
  edited?: string;
  /** Set when guardrails flagged the proposal. */
  warnings?: string[];
  /** Who wrote it: the deterministic engine, the host agent, or an API model. */
  author: 'engine' | 'agent' | 'llm';
  /**
   * Ids of proposals elsewhere in the repo making the identical change to the
   * identical string. Localised message bundles produce dozens of these, and
   * asking a human to click through all of them separately is how a review gets
   * abandoned half-finished.
   */
  siblings?: string[];
  /**
   * Set when the siblings live in locale directories. Editing an English string
   * inside `messages/tr/` is a translation problem as much as a copy one, and
   * the human needs telling before they approve twelve of them.
   */
  localeWarning?: string;
}

export interface ProposalSet {
  schemaVersion?: 4;
  runId?: string;
  inventoryDigest?: string;
  generatedAt: string;
  product: string;
  proposals: Proposal[];
}

export interface AgentProposal {
  copyId: string;
  after: string;
  alternatives: string[];
  rationale: string;
  problemSolved: string;
  principles: string[];
  evidence: string[];
  confidence: number;
}

export interface AgentOutput {
  schemaVersion: 4;
  runId: string;
  inventoryDigest: string;
  proposals: AgentProposal[];
}

export interface ProposalDecision {
  proposalId: string;
  proposalDigest: string;
  decision: 'approved' | 'rejected';
  finalText: string;
  source: 'canvas' | 'markdown';
  decidedAt: string;
}

export interface DecisionSet {
  schemaVersion: 4;
  runId: string;
  inventoryDigest: string;
  decisions: ProposalDecision[];
}

export interface ApplyResult {
  proposalId: string;
  file: string;
  ok: boolean;
  reason?: string;
  backup?: string;
}

export type CatalogueLayout = 'single-file' | 'namespaced' | 'custom';

export interface CatalogueConfig {
  messagesDir: string;
  sourceLocale: string;
  layout: CatalogueLayout;
}

export interface CatalogueScope extends CatalogueConfig {
  files: string[];
  scopeDigest: string;
}

/**
 * Marketing facts that are safe to use in analysis, proposals, and briefs.
 * This is intentionally derived only from the configured source catalogue,
 * marketing-loop.config.json, and marketing-data/.
 */
export interface MarketingContext {
  sourceLocale: string;
  messagesDir: string;
  layout: CatalogueLayout;
  namespaces: string[];
  currentTagline?: string;
  currentDescription?: string;
  audience: string;
  allowedClaims: string[];
  generatedAt: string;
}

export interface LoopConfig {
  /** Directories to scan for copy; they do not define catalogue scope. */
  include: string[];
  /** Glob-ish fragments to skip. */
  exclude: string[];
  /** Where behavioral exports live. */
  dataDir: string;
  /** Working directory for loop artefacts. */
  outDir: string;
  /** Product voice constraints the agent must respect. */
  voice: {
    tone: string;
    person: 'first' | 'second' | 'third';
    readingLevel: string;
    banned: string[];
    required: string[];
  };
  /** Who we are selling to. Free text beats a taxonomy here. */
  audience: string;
  /** Claims the copy is allowed to make. Anything else is invention. */
  allowedClaims: string[];
  /**
   * Hard limit on how many proposals a single run may produce, counting
   * everything an agent or an API model added. A review nobody finishes is a
   * review that did not happen.
   */
  maxProposals: number;
  /**
   * Which product surfaces may be rewritten. Legal and internal surfaces are
   * scanned and reported but never proposed on unless listed here.
   */
  surfaces?: Surface[];
  /** Persuasion techniques explicitly switched off for this project. */
  disabledPrinciples: string[];
  /** Never touch these files even if they contain copy; they do not define catalogue scope. */
  protectedFiles: string[];
  /** Optional explicit source catalogue, overridden by language-loop.config.json. */
  catalogue?: CatalogueConfig;
}
