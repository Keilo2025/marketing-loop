/**
 * Programmatic API.
 *
 * Everything the CLI does is available here, so the loop can be embedded in a
 * CI job, a git hook, an MCP server, or another tool's build step.
 */

export * from './types.js';
export { CONFIG_FILE, defaultConfig, loadConfig, paths, saveConfig } from './config.js';
export { analyse, findingsFor, prioritise } from './core/analyse.js';
export { applyProposals, revert } from './core/apply.js';
export {
  behaviorCopyIds,
  behaviorSubjects,
  loadBehavior,
  parseDelimited,
} from './core/behavior.js';
export { renderBrief } from './core/brief.js';
export { buildMarketingContext } from './core/context.js';
export { serveCanvas } from './core/canvas.js';
export { deriveHandoff, handoffSelection, writeHandoff } from './core/handoff.js';
export {
  EMPTY_CONTENT_FILTER,
  matchesContentFilter,
  normalizeContentFilter,
  resolveContentSelection,
} from './core/filter.js';
export { feedbackFor, loadReviewHistory } from './core/history.js';
export {
  extractCatalogueFile,
  inferKindFromKey,
  inferSurfaceFromKey,
  looksLikeCopy,
} from './core/catalogue-extract.js';
export {
  catalogueKeyForFile,
  isCatalogueTarget,
  resolveCatalogueScope,
} from './core/catalogue.js';
export { applyGuardrails, checkProposal } from './core/guardrails.js';
export { importAgentOutput, parseAgentOutput } from './core/ingest.js';
export {
  archiveActiveRun,
  collectDecisionSet,
  decisionSetFrom,
  proposalDigest,
  rotateActiveRun,
  validateDecisionSet,
} from './core/state.js';
export {
  AGENT_TARGETS,
  detectAgents,
  install,
  uninstall,
  type AgentTarget,
  type InstallResult,
} from './core/install.js';
export { detectProvider, generateWithLlm, parseProposals } from './core/llm.js';
export {
  assertMeasurementLedger,
  emptyMeasurementLedger,
  markVariantDeployed,
  recordBaseline,
  recordPostChange,
  registerVariant,
} from './core/measurement.js';
export {
  readContentLoopState,
  runContentLoop,
  type RunContentLoopInput,
} from './core/content.js';
export {
  createLanguageLoopAdapter,
  loadLanguageLoopAdapter,
  type LanguageLoopAdapterOptions,
} from './core/content-language.js';
export { propose, type ProposeInput, type ProposeOutput } from './core/propose.js';
export {
  getPrinciple,
  principleCheatSheet,
  principlesFor,
  PRINCIPLES,
  PRINCIPLE_IDS,
  type Principle,
} from './core/psychology.js';
export { renderReport } from './core/report.js';
export { applyDecisions, collectReview, renderReview, type Decision } from './core/review.js';
export { scanRepo, summarise, type ScanResult } from './core/scan.js';
