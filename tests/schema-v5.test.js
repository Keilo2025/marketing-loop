import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentOutput } from '../dist/core/ingest.js';

test('schema-v4 agent output is rejected with a code-target warning', () => {
  assert.throws(
    () => parseAgentOutput(JSON.stringify({
      schemaVersion: 4,
      runId: 'old',
      inventoryDigest: 'old',
      proposals: [],
    })),
    /schema v4.*may target code|schemaVersion must be 5/i,
  );
});

test('schema-v5 agent output preserves only untrusted proposal content', () => {
  const parsed = parseAgentOutput(JSON.stringify({
    schemaVersion: 5,
    runId: 'run',
    inventoryDigest: 'inventory',
    proposals: [{
      copyId: 'copy',
      after: 'Start my audit',
      alternatives: [],
      rationale: 'Names the result.',
      problemSolved: 'The action was vague.',
      principles: [],
      evidence: ['messages/en.json'],
      confidence: 0.8,
      file: 'src/page.tsx',
    }],
  }));
  assert.equal(parsed.schemaVersion, 5);
  assert.equal('file' in parsed.proposals[0], false);
});
