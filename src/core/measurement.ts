import type {
  MeasurementBaseline,
  MeasurementDeployment,
  MeasurementDirection,
  MeasurementLedger,
  MeasurementVariant,
  PostChangeMeasurement,
} from '../types.js';
import { shortHash } from '../util/fsx.js';

export interface BaselineInput {
  subject: string;
  metric: string;
  value: number;
  unit: MeasurementBaseline['unit'];
  sampleSize?: number;
  measuredAt: string;
  source: string;
  direction: MeasurementDirection;
}

export interface VariantInput {
  baselineId: string;
  runId: string;
  proposalId: string;
  catalogueKey: string;
  before: string;
  after: string;
  createdAt: string;
}

export interface DeploymentInput {
  markedAt: string;
  environment: string;
  marker: string;
}

export interface PostChangeInput {
  value: number;
  sampleSize?: number;
  measuredAt: string;
  source: string;
  minimumRelativeUplift: number;
  minimumSampleSize: number;
}

export function emptyMeasurementLedger(): MeasurementLedger {
  return { schemaVersion: 1, baselines: [], variants: [] };
}

export function recordBaseline(
  ledger: MeasurementLedger,
  input: BaselineInput,
): MeasurementBaseline {
  assertLedger(ledger);
  assertText('subject', input.subject);
  assertText('metric', input.metric);
  assertFinite('value', input.value);
  assertText('source', input.source);
  assertTimestamp('measuredAt', input.measuredAt);
  assertSampleSize(input.sampleSize);
  if (input.direction !== 'increase' && input.direction !== 'decrease') {
    throw new Error('direction must be increase or decrease');
  }

  const baseline: MeasurementBaseline = {
    id: `baseline-${shortHash(
      input.subject,
      input.metric,
      input.measuredAt,
      String(input.value),
    )}`,
    subject: input.subject.trim(),
    metric: input.metric.trim(),
    value: input.value,
    unit: input.unit,
    ...(input.sampleSize === undefined ? {} : { sampleSize: input.sampleSize }),
    measuredAt: input.measuredAt,
    source: input.source.trim(),
    direction: input.direction,
  };
  if (ledger.baselines.some((candidate) => candidate.id === baseline.id)) {
    throw new Error(`baseline ${baseline.id} already exists`);
  }
  ledger.baselines.push(baseline);
  return baseline;
}

export function registerVariant(
  ledger: MeasurementLedger,
  input: VariantInput,
): MeasurementVariant {
  assertLedger(ledger);
  const baseline = requireBaseline(ledger, input.baselineId);
  assertText('runId', input.runId);
  assertText('proposalId', input.proposalId);
  assertText('catalogueKey', input.catalogueKey);
  assertText('before', input.before);
  assertText('after', input.after);
  assertTimestamp('createdAt', input.createdAt);
  if (input.before === input.after) throw new Error('variant after text must differ from before text');
  if (Date.parse(input.createdAt) < Date.parse(baseline.measuredAt)) {
    throw new Error('variant cannot be created before its baseline was measured');
  }

  const variant: MeasurementVariant = {
    id: `variant-${shortHash(
      input.runId,
      input.proposalId,
      input.baselineId,
      input.createdAt,
    )}`,
    baselineId: input.baselineId,
    runId: input.runId.trim(),
    proposalId: input.proposalId.trim(),
    catalogueKey: input.catalogueKey.trim(),
    before: input.before,
    after: input.after,
    createdAt: input.createdAt,
    results: [],
  };
  if (ledger.variants.some((candidate) => candidate.id === variant.id)) {
    throw new Error(`variant ${variant.id} already exists`);
  }
  ledger.variants.push(variant);
  return variant;
}

export function markVariantDeployed(
  ledger: MeasurementLedger,
  variantId: string,
  input: DeploymentInput,
): MeasurementDeployment {
  const variant = requireVariant(ledger, variantId);
  assertTimestamp('markedAt', input.markedAt);
  assertText('environment', input.environment);
  assertText('marker', input.marker);
  if (Date.parse(input.markedAt) < Date.parse(variant.createdAt)) {
    throw new Error('deployment marker cannot precede variant creation');
  }
  const deployment: MeasurementDeployment = {
    markedAt: input.markedAt,
    environment: input.environment.trim(),
    marker: input.marker.trim(),
  };
  variant.deployment = deployment;
  return deployment;
}

export function recordPostChange(
  ledger: MeasurementLedger,
  variantId: string,
  input: PostChangeInput,
): PostChangeMeasurement {
  const variant = requireVariant(ledger, variantId);
  const baseline = requireBaseline(ledger, variant.baselineId);
  if (!variant.deployment) {
    throw new Error('variant needs a deployment marker before post-change measurement');
  }
  assertFinite('value', input.value);
  assertSampleSize(input.sampleSize);
  assertTimestamp('measuredAt', input.measuredAt);
  assertText('source', input.source);
  assertNonNegative('minimumRelativeUplift', input.minimumRelativeUplift);
  if (!Number.isInteger(input.minimumSampleSize) || input.minimumSampleSize < 1) {
    throw new Error('minimumSampleSize must be a positive integer');
  }
  if (Date.parse(input.measuredAt) < Date.parse(variant.deployment.markedAt)) {
    throw new Error('post-change measurement cannot precede deployment');
  }

  const absoluteChange = round(input.value - baseline.value);
  const relativeChangePercent = baseline.value === 0
    ? undefined
    : round((absoluteChange / Math.abs(baseline.value)) * 100);
  const upliftPercent = relativeChangePercent === undefined
    ? undefined
    : round(baseline.direction === 'increase'
      ? relativeChangePercent
      : -relativeChangePercent);

  const enoughSamples =
    baseline.sampleSize !== undefined &&
    input.sampleSize !== undefined &&
    baseline.sampleSize >= input.minimumSampleSize &&
    input.sampleSize >= input.minimumSampleSize;

  let decision: PostChangeMeasurement['decision'] = 'inconclusive';
  let decisionReason: string;
  if (!enoughSamples) {
    decisionReason = `Sample sizes must both reach ${input.minimumSampleSize}; this rule is a directional heuristic, not a significance test.`;
  } else if (upliftPercent === undefined) {
    decisionReason = 'Relative uplift is undefined because the baseline value is zero.';
  } else if (upliftPercent >= input.minimumRelativeUplift) {
    decision = 'keep';
    decisionReason = `Direction-normalized uplift exceeded the ${input.minimumRelativeUplift}% keep threshold.`;
  } else if (upliftPercent <= -input.minimumRelativeUplift) {
    decision = 'revert';
    decisionReason = `Direction-normalized uplift fell below the -${input.minimumRelativeUplift}% revert threshold.`;
  } else {
    decisionReason = `Direction-normalized uplift stayed inside the ±${input.minimumRelativeUplift}% inconclusive band.`;
  }

  const result: PostChangeMeasurement = {
    value: input.value,
    ...(input.sampleSize === undefined ? {} : { sampleSize: input.sampleSize }),
    measuredAt: input.measuredAt,
    source: input.source.trim(),
    absoluteChange,
    ...(relativeChangePercent === undefined ? {} : { relativeChangePercent }),
    ...(upliftPercent === undefined ? {} : { upliftPercent }),
    decision,
    decisionReason,
    minimumRelativeUplift: input.minimumRelativeUplift,
    minimumSampleSize: input.minimumSampleSize,
  };
  variant.results.push(result);
  return result;
}

export function assertMeasurementLedger(value: unknown): asserts value is MeasurementLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('measurement ledger must be an object');
  }
  const ledger = value as Partial<MeasurementLedger>;
  if (ledger.schemaVersion !== 1) throw new Error('measurement ledger schemaVersion must be 1');
  if (!Array.isArray(ledger.baselines)) throw new Error('measurement ledger baselines must be an array');
  if (!Array.isArray(ledger.variants)) throw new Error('measurement ledger variants must be an array');
}

function assertLedger(ledger: MeasurementLedger): void {
  assertMeasurementLedger(ledger);
}

function requireBaseline(ledger: MeasurementLedger, baselineId: string): MeasurementBaseline {
  assertLedger(ledger);
  const baseline = ledger.baselines.find((candidate) => candidate.id === baselineId);
  if (!baseline) throw new Error(`baseline ${baselineId} does not exist`);
  return baseline;
}

function requireVariant(ledger: MeasurementLedger, variantId: string): MeasurementVariant {
  assertLedger(ledger);
  const variant = ledger.variants.find((candidate) => candidate.id === variantId);
  if (!variant) throw new Error(`variant ${variantId} does not exist`);
  return variant;
}

function assertText(field: string, value: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertFinite(field: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
}

function assertNonNegative(field: string, value: number): void {
  assertFinite(field, value);
  if (value < 0) throw new Error(`${field} must be non-negative`);
}

function assertSampleSize(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new Error('sampleSize must be a positive integer');
  }
}

function assertTimestamp(field: string, value: string): void {
  assertText(field, value);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
