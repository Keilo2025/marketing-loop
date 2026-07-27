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
export { behaviorSubjects, loadBehavior, parseDelimited } from './core/behavior.js';
export { renderBrief } from './core/brief.js';
export { serveCanvas } from './core/canvas.js';
export { extractFromFile, inferSurface, looksLikeCopy, SCANNABLE } from './core/extract.js';
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
export { buildProductModel, looksLikeProject } from './core/product.js';
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
