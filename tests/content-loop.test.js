import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readContentLoopState,
  runContentLoop,
} from '../dist/core/content.js';

const selection = {
  filter: { schemaVersion: 1, types: ['cta'], groups: ['hero'], keys: [] },
  resolvedKeys: ['hero.primaryCta', 'hero.secondaryCta'],
  targetLocales: ['de', 'fr'],
};

test('Content Loop starts marketing once and stays paused until an explicit review decision', async () => {
  const fixture = stateFixture();
  let starts = 0;
  let inspections = 0;
  let languageCalls = 0;
  const marketing = marketingAdapter({
    start: async () => {
      starts++;
      return marketingSnapshot({ pending: 2, proposals: 2 });
    },
    inspect: async () => {
      inspections++;
      return marketingSnapshot({ pending: 2, proposals: 2, explicitDecisions: 0 });
    },
  });
  const language = {
    run: async () => {
      languageCalls++;
      return completeLanguage();
    },
  };

  try {
    let state = await runContentLoop({
      stateFile: fixture.file,
      selection,
      marketing,
      language,
      executeLanguage: true,
    });
    assert.equal(state.phase, 'waiting-review');
    assert.equal(starts, 1);
    assert.equal(languageCalls, 0);

    state = await runContentLoop({
      stateFile: fixture.file,
      selection,
      marketing,
      language,
      executeLanguage: true,
    });
    assert.equal(state.phase, 'waiting-review');
    assert.equal(starts, 1);
    assert.equal(inspections, 1);
    assert.equal(languageCalls, 0);
    assert.deepEqual(readContentLoopState(fixture.file), state);
  } finally {
    fixture.cleanup();
  }
});

test('Content Loop settles review then exposes language-ready without provider execution', async () => {
  const fixture = stateFixture();
  let reviewed = false;
  let languageInput;
  const marketing = marketingAdapter({
    inspect: async () => marketingSnapshot({
      proposals: 1,
      pending: reviewed ? 0 : 1,
      explicitDecisions: reviewed ? 1 : 0,
    }),
    collectAndApply: async () => marketingSnapshot({
      proposals: 1,
      pending: 0,
      applied: 1,
      explicitDecisions: 1,
      unresolvedKeys: [],
    }),
  });
  const language = {
    run: async (input) => {
      languageInput = input;
      return {
        compatible: true,
        status: 'ready',
        adoptedSourceKeys: ['hero.primaryCta'],
        pending: 4,
        applied: 0,
        needsHuman: 0,
        marketingBlocked: 0,
        progress: [
          progress('de', 2, 0, 2),
          progress('fr', 2, 0, 2),
        ],
      };
    },
  };

  try {
    await runContentLoop({
      stateFile: fixture.file,
      selection,
      marketing,
      language,
      executeLanguage: false,
    });
    reviewed = true;
    const state = await runContentLoop({
      stateFile: fixture.file,
      selection,
      marketing,
      language,
      executeLanguage: false,
    });

    assert.equal(state.phase, 'language-ready');
    assert.equal(languageInput.execute, false);
    assert.deepEqual(languageInput.keys, selection.resolvedKeys);
    assert.deepEqual(languageInput.locales, selection.targetLocales);
    assert.deepEqual(state.language.progress.map((row) => row.locale), ['de', 'fr']);
  } finally {
    fixture.cleanup();
  }
});

test('Content Loop completes only after every selected key in every target language is accepted', async () => {
  const completeFixture = stateFixture();
  const partialFixture = stateFixture();
  const marketing = immediatelySettledMarketing();
  try {
    await seedWaitingReview(completeFixture.file, marketing);
    const complete = await runContentLoop({
      stateFile: completeFixture.file,
      selection,
      marketing,
      language: { run: async () => completeLanguage() },
      executeLanguage: true,
    });
    assert.equal(complete.phase, 'complete');
    assert.deepEqual(
      complete.language.progress.map(({ locale, accepted }) => ({ locale, accepted })),
      [{ locale: 'de', accepted: 2 }, { locale: 'fr', accepted: 2 }],
    );

    await seedWaitingReview(partialFixture.file, marketing);
    const partial = await runContentLoop({
      stateFile: partialFixture.file,
      selection,
      marketing,
      language: {
        run: async () => ({
          ...completeLanguage(),
          progress: [
            progress('de', 2, 2, 0),
            progress('fr', 2, 1, 1),
          ],
        }),
      },
      executeLanguage: true,
    });
    assert.equal(partial.phase, 'blocked');
    assert.match(partial.error, /outstanding selected languages/i);
  } finally {
    completeFixture.cleanup();
    partialFixture.cleanup();
  }
});

test('Content Loop blocks unresolved handoff and preserves terminal per-language failures', async () => {
  const handoffFixture = stateFixture();
  const humanFixture = stateFixture();
  try {
    const unresolvedMarketing = immediatelySettledMarketing({
      handoffCompatible: true,
      unresolvedKeys: ['hero.primaryCta'],
    });
    await seedWaitingReview(handoffFixture.file, unresolvedMarketing);
    let languageCalls = 0;
    const blocked = await runContentLoop({
      stateFile: handoffFixture.file,
      selection,
      marketing: unresolvedMarketing,
      language: {
        run: async () => {
          languageCalls++;
          return completeLanguage();
        },
      },
      executeLanguage: true,
    });
    assert.equal(blocked.phase, 'blocked');
    assert.match(blocked.error, /handoff.*resolved/i);
    assert.equal(languageCalls, 0);

    const settled = immediatelySettledMarketing();
    await seedWaitingReview(humanFixture.file, settled);
    const needsHuman = await runContentLoop({
      stateFile: humanFixture.file,
      selection,
      marketing: settled,
      language: {
        run: async () => ({
          compatible: true,
          status: 'needs-human',
          adoptedSourceKeys: ['hero.primaryCta'],
          pending: 1,
          applied: 3,
          needsHuman: 1,
          marketingBlocked: 0,
          progress: [
            progress('de', 2, 2, 0),
            { ...progress('fr', 2, 1, 0), needsHuman: 1 },
          ],
          error: 'fr hero.secondaryCta exhausted judge attempts',
        }),
      },
      executeLanguage: true,
    });
    assert.equal(needsHuman.phase, 'needs-human');
    assert.equal(needsHuman.language.progress[1].needsHuman, 1);
    assert.match(needsHuman.error, /exhausted judge attempts/i);
  } finally {
    handoffFixture.cleanup();
    humanFixture.cleanup();
  }
});

test('Content Loop resumes retryable provider pauses and explicit human language decisions', async () => {
  const retryFixture = stateFixture();
  const humanFixture = stateFixture();
  const marketing = immediatelySettledMarketing();
  try {
    await seedWaitingReview(retryFixture.file, marketing);
    let attempts = 0;
    let retryState = await runContentLoop({
      stateFile: retryFixture.file,
      selection,
      marketing,
      language: {
        run: async () => {
          attempts++;
          return attempts === 1
            ? {
                ...completeLanguage(),
                status: 'blocked',
                retryable: true,
                error: 'provider rate limit',
                progress: [
                  progress('de', 2, 2, 0),
                  progress('fr', 2, 0, 2),
                ],
              }
            : completeLanguage();
        },
      },
      executeLanguage: true,
    });
    assert.equal(retryState.phase, 'blocked');
    assert.equal(retryState.retryable, true);
    retryState = await runContentLoop({
      stateFile: retryFixture.file,
      selection,
      marketing,
      language: {
        run: async () => {
          attempts++;
          return completeLanguage();
        },
      },
      executeLanguage: true,
    });
    assert.equal(retryState.phase, 'complete');
    assert.equal(attempts, 2);

    await seedWaitingReview(humanFixture.file, marketing);
    let resolvedByHuman = false;
    let humanState = await runContentLoop({
      stateFile: humanFixture.file,
      selection,
      marketing,
      language: {
        run: async () => resolvedByHuman
          ? completeLanguage()
          : {
              ...completeLanguage(),
              status: 'needs-human',
              needsHuman: 1,
              progress: [
                progress('de', 2, 2, 0),
                { ...progress('fr', 2, 1, 0), needsHuman: 1 },
              ],
            },
      },
      executeLanguage: true,
    });
    assert.equal(humanState.phase, 'needs-human');
    resolvedByHuman = true;
    humanState = await runContentLoop({
      stateFile: humanFixture.file,
      selection,
      marketing,
      language: { run: async () => completeLanguage() },
      executeLanguage: true,
    });
    assert.equal(humanState.phase, 'complete');
  } finally {
    retryFixture.cleanup();
    humanFixture.cleanup();
  }
});

function stateFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-loop-state-'));
  return {
    file: path.join(directory, 'content-loop.json'),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function marketingAdapter(overrides = {}) {
  return {
    start: overrides.start ?? (async () => marketingSnapshot()),
    inspect: overrides.inspect ?? (async () => marketingSnapshot({ explicitDecisions: 1 })),
    collectAndApply: overrides.collectAndApply ?? (async () => marketingSnapshot({
      pending: 0,
      applied: 2,
      explicitDecisions: 2,
    })),
    openReview: overrides.openReview,
  };
}

function immediatelySettledMarketing(overrides = {}) {
  return marketingAdapter({
    inspect: async () => marketingSnapshot({ explicitDecisions: 1 }),
    collectAndApply: async () => marketingSnapshot({
      pending: 0,
      applied: 2,
      explicitDecisions: 2,
      ...overrides,
    }),
  });
}

function marketingSnapshot(overrides = {}) {
  return {
    runId: 'marketing-run',
    selectedKeys: selection.resolvedKeys,
    proposals: 2,
    pending: 2,
    approved: 0,
    rejected: 0,
    applied: 0,
    failed: 0,
    explicitDecisions: 0,
    handoffCompatible: true,
    unresolvedKeys: [],
    ...overrides,
  };
}

function progress(locale, total, accepted, pending) {
  return {
    locale,
    total,
    accepted,
    pending,
    rework: 0,
    needsHuman: 0,
  };
}

function completeLanguage() {
  return {
    compatible: true,
    status: 'complete',
    adoptedSourceKeys: ['hero.primaryCta'],
    pending: 0,
    applied: 4,
    needsHuman: 0,
    marketingBlocked: 0,
    progress: [
      progress('de', 2, 2, 0),
      progress('fr', 2, 2, 0),
    ],
  };
}

async function seedWaitingReview(stateFile, marketing) {
  await runContentLoop({
    stateFile,
    selection,
    marketing,
    language: { run: async () => completeLanguage() },
    executeLanguage: false,
  });
}
