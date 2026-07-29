import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  emptyMeasurementLedger,
  markVariantDeployed,
  recordBaseline,
  recordPostChange,
  registerVariant,
} from '../dist/core/measurement.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('measurement lifecycle compares a deployed variant and recommends keeping uplift', () => {
  const ledger = emptyMeasurementLedger();
  const baseline = recordBaseline(ledger, {
    subject: 'hero.primaryCta',
    metric: 'conversion_rate',
    value: 3,
    unit: '%',
    sampleSize: 1000,
    measuredAt: '2026-07-01T00:00:00.000Z',
    source: 'GA4 signup funnel',
    direction: 'increase',
  });
  const variant = registerVariant(ledger, {
    baselineId: baseline.id,
    runId: 'run-1',
    proposalId: 'proposal-1',
    catalogueKey: 'hero.primaryCta',
    before: 'Start now',
    after: 'Get my deployment audit',
    createdAt: '2026-07-02T00:00:00.000Z',
  });
  markVariantDeployed(ledger, variant.id, {
    markedAt: '2026-07-03T00:00:00.000Z',
    environment: 'production',
    marker: 'git:abc123',
  });
  const result = recordPostChange(ledger, variant.id, {
    value: 3.6,
    sampleSize: 1100,
    measuredAt: '2026-07-10T00:00:00.000Z',
    source: 'GA4 signup funnel',
    minimumRelativeUplift: 5,
    minimumSampleSize: 500,
  });

  assert.equal(result.absoluteChange, 0.6);
  assert.equal(result.relativeChangePercent, 20);
  assert.equal(result.upliftPercent, 20);
  assert.equal(result.decision, 'keep');
  assert.match(result.decisionReason, /exceeded.*5%/i);
});

test('measurement normalizes lower-is-better metrics and refuses premature conclusions', () => {
  const ledger = emptyMeasurementLedger();
  const baseline = recordBaseline(ledger, {
    subject: 'checkout',
    metric: 'bounce_rate',
    value: 60,
    unit: '%',
    sampleSize: 1000,
    measuredAt: '2026-07-01T00:00:00.000Z',
    source: 'Q2 checkout baseline',
    direction: 'decrease',
  });
  const variant = registerVariant(ledger, {
    baselineId: baseline.id,
    runId: 'run-2',
    proposalId: 'proposal-2',
    catalogueKey: 'checkout.submit',
    before: 'Submit',
    after: 'Pay securely',
    createdAt: '2026-07-02T00:00:00.000Z',
  });

  assert.throws(
    () => recordPostChange(ledger, variant.id, {
      value: 50,
      sampleSize: 1000,
      measuredAt: '2026-07-04T00:00:00.000Z',
      source: 'GA4 checkout',
      minimumRelativeUplift: 5,
      minimumSampleSize: 500,
    }),
    /deployment marker/i,
  );

  markVariantDeployed(ledger, variant.id, {
    markedAt: '2026-07-03T00:00:00.000Z',
    environment: 'production',
    marker: 'release:2026-07-03',
  });
  const result = recordPostChange(ledger, variant.id, {
    value: 50,
    sampleSize: 50,
    measuredAt: '2026-07-04T00:00:00.000Z',
    source: 'GA4 checkout',
    minimumRelativeUplift: 5,
    minimumSampleSize: 500,
  });

  assert.equal(result.relativeChangePercent, -16.67);
  assert.equal(result.upliftPercent, 16.67);
  assert.equal(result.decision, 'inconclusive');
  assert.match(result.decisionReason, /sample/i);
});

test('measure CLI binds an applied proposal to baseline, deployment, and uplift result', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mloop-measure-cli-'));
  fs.cpSync(path.join(here, 'fixture'), cwd, { recursive: true });
  const cli = path.join(here, '..', 'dist', 'cli.js');
  const run = (...args) => spawnSync(
    process.execPath,
    [cli, ...args, '--cwd', cwd],
    { encoding: 'utf8' },
  );

  try {
    let command = run('propose');
    assert.equal(command.status, 0, command.stderr || command.stdout);
    command = run('review');
    assert.equal(command.status, 0, command.stderr || command.stdout);

    const out = path.join(cwd, '.marketing-loop');
    const proposals = JSON.parse(fs.readFileSync(path.join(out, 'proposals.json'), 'utf8'));
    const proposal = proposals.proposals[0];
    assert.ok(proposal);
    const reviewFile = path.join(out, 'review.md');
    const review = fs.readFileSync(reviewFile, 'utf8').replace(
      `<!-- marketing-loop:${proposal.id} -->\n- [ ] APPROVE`,
      `<!-- marketing-loop:${proposal.id} -->\n- [x] APPROVE`,
    );
    fs.writeFileSync(reviewFile, review);
    command = run('review', '--collect');
    assert.equal(command.status, 0, command.stderr || command.stdout);
    command = run('apply');
    assert.equal(command.status, 0, command.stderr || command.stdout);

    command = run(
      'measure',
      'baseline',
      '--subject', proposal.catalogueKey,
      '--metric', 'conversion_rate',
      '--value', '3',
      '--unit', '%',
      '--sample-size', '1000',
      '--source', 'GA4 signup funnel',
      '--at', '2026-07-01T00:00:00.000Z',
    );
    assert.equal(command.status, 0, command.stderr || command.stdout);
    let ledger = JSON.parse(fs.readFileSync(path.join(out, 'measurements.json'), 'utf8'));
    const baseline = ledger.baselines[0];

    command = run(
      'measure',
      'variant',
      '--baseline', baseline.id,
      '--proposal', proposal.id,
      '--at', '2026-07-02T00:00:00.000Z',
    );
    assert.equal(command.status, 0, command.stderr || command.stdout);
    ledger = JSON.parse(fs.readFileSync(path.join(out, 'measurements.json'), 'utf8'));
    const variant = ledger.variants[0];

    command = run(
      'measure',
      'deploy',
      '--variant', variant.id,
      '--environment', 'production',
      '--marker', 'git:abc123',
      '--at', '2026-07-03T00:00:00.000Z',
    );
    assert.equal(command.status, 0, command.stderr || command.stdout);
    command = run(
      'measure',
      'result',
      '--variant', variant.id,
      '--value', '3.6',
      '--sample-size', '1100',
      '--source', 'GA4 signup funnel',
      '--minimum-uplift', '5',
      '--minimum-sample', '500',
      '--at', '2026-07-10T00:00:00.000Z',
    );
    assert.equal(command.status, 0, command.stderr || command.stdout);

    ledger = JSON.parse(fs.readFileSync(path.join(out, 'measurements.json'), 'utf8'));
    assert.equal(ledger.variants[0].deployment.marker, 'git:abc123');
    assert.equal(ledger.variants[0].results[0].decision, 'keep');
    assert.equal(ledger.variants[0].results[0].upliftPercent, 20);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
