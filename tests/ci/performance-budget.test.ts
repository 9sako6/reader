export {};

const assert = require("node:assert/strict");
const {
  buildPairedMemorySamples,
  evaluateFeedbackBudget,
  evaluateReactMemoryGate,
  evaluateReactMigrationGate,
  summarizeMemorySamples,
} = require("../../scripts/performance-budget.mjs");

test("feedback budget accepts a p90 outlier when paired median remains stable", () => {
  const result = evaluateFeedbackBudget({ observedP90: 99, pairedP50DeltaMs: 0.3 });

  assert.equal(result.absoluteBudgetMs, 100);
  assert.equal(result.pairedP50BudgetMs, 16);
  assert.equal(result.regression, false);
});

test("feedback budget accepts a paired speedup", () => {
  assert.equal(evaluateFeedbackBudget({ observedP90: 99, pairedP50DeltaMs: -100 }).regression, false);
});

test("feedback budget rejects a UX-boundary breach or systematic paired slowdown", () => {
  assert.equal(evaluateFeedbackBudget({ observedP90: 101, pairedP50DeltaMs: 0.3 }).regression, true);
  assert.equal(evaluateFeedbackBudget({ observedP90: 99, pairedP50DeltaMs: 16.1 }).regression, true);
});

function bundleBytes(chrome, safari) {
  return {
    raw: { chrome, safari, total: chrome + safari },
    gzip9: { chrome, safari, total: chrome + safari },
  };
}

function initialization(candidate: {
  reactInitMs?: number | null;
  wasmInitMs?: number | null;
  initializationSpanMs?: number | null;
} = {}) {
  return [{
    name: "fixture:short-article",
    candidate: {
      reactInitMs: candidate.reactInitMs === undefined ? 3 : candidate.reactInitMs,
      wasmInitMs: candidate.wasmInitMs === undefined ? 12 : candidate.wasmInitMs,
      initializationSpanMs: candidate.initializationSpanMs === undefined ? 13 : candidate.initializationSpanMs,
    },
    baseline: { wasmInitMs: 10, initializationSpanMs: 10 },
  }];
}

test("React migration gate accepts a paired bundle at the exact 35 percent ceiling", () => {
  const result = evaluateReactMigrationGate({
    candidateBundle: bundleBytes(135, 135),
    baselineBundle: bundleBytes(100, 100),
    initializationReports: initialization(),
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.failures, []);
  assert.equal(result.bundle.raw.chrome.percent, 35);
});

test("React migration gate rejects bundle growth and every missing or invalid initialization phase", () => {
  const result = evaluateReactMigrationGate({
    candidateBundle: bundleBytes(136, 100),
    baselineBundle: bundleBytes(100, 100),
    initializationReports: initialization({ reactInitMs: -1, wasmInitMs: null, initializationSpanMs: null }),
  });

  assert.equal(result.status, "fail");
  assert.match(result.failures.join("\n"), /raw\.chrome bundle increase/);
  assert.match(result.failures.join("\n"), /fixture:short-article\.reactInitMs is invalid/);
  assert.match(result.failures.join("\n"), /fixture:short-article\.wasmInitMs is not measured/);
  assert.match(result.failures.join("\n"), /fixture:short-article\.initializationSpanMs is not measured/);
});

function pairedMemory({ baselineCycle0 = 400_000, baselineCycle1 = 100, candidateCycle0 = 780_020, candidateCycle1 = 120 } = {}) {
  const baselineRuns = [];
  const candidateRuns = [];
  for (let run = 0; run < 10; run += 1) {
    const order = run % 2 === 0 ? "baseline-candidate" : "candidate-baseline";
    baselineRuns.push({
      executionOrder: order,
      cleanupCycles: { cycles: [{ delta: baselineCycle0 }, { delta: baselineCycle1 }], warmupCycles: 1 },
    });
    candidateRuns.push({
      executionOrder: order,
      cleanupCycles: { cycles: [{ delta: candidateCycle0 }, { delta: candidateCycle1 }], warmupCycles: 1 },
    });
  }
  return buildPairedMemorySamples(baselineRuns, candidateRuns);
}

function representativeCleanup(baselineSteady, candidateSteady) {
  const steadyDelta = summarizeMemorySamples(candidateSteady.map((value, index) => value - baselineSteady[index]));
  return {
    baseline: {
      warmupCycles: 1,
      cycles: [0, ...baselineSteady].map((delta, cycle) => ({ cycle, samples: [delta] })),
      steadyIncrements: summarizeMemorySamples(baselineSteady),
    },
    candidate: {
      warmupCycles: 1,
      cycles: [0, ...candidateSteady].map((delta, cycle) => ({ cycle, samples: [delta] })),
      steadyIncrements: summarizeMemorySamples(candidateSteady),
    },
    steadyDelta,
  };
}

test("React memory gate uses ten AB/BA paired cycles to separate fixed overhead from steady data growth", () => {
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 756_000,
    baselineP90Bytes: 412_000,
    pairedMemory: pairedMemory(),
    representativeCleanup: representativeCleanup([100, 110, 120, 115, 105], [120, 125, 120, 115, 120]),
  });

  assert.equal(result.status, "within-budget");
  assert.equal(result.fixedOverheadBytes, 380_000);
  assert.equal(result.fixedOverhead.p50, 380_000);
  assert.equal(result.fixedOverhead.p90, 380_000);
  assert.equal(result.steadyGrowth.candidate.p90, 120);
  assert.equal(result.steadyGrowth.baseline.p90, 100);
  assert.equal(result.steadyGrowth.regression, false);
  assert.equal(result.representativeGrowth.regression, false);
  assert.equal(result.regression, false);
});

test("React memory gate rejects fixed overhead beyond its explicit byte budget", () => {
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 600_000,
    baselineP90Bytes: 100_000,
    pairedMemory: pairedMemory({ baselineCycle0: 100_000, baselineCycle1: 0, candidateCycle0: 600_001, candidateCycle1: 0 }),
  });

  assert.equal(result.fixedOverheadRegression, true);
  assert.equal(result.regression, true);
});

test("React memory gate keeps the 25 percent data-scaling budget independent of fixed overhead", () => {
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 600_000,
    baselineP90Bytes: 100_000,
    pairedMemory: pairedMemory({ baselineCycle0: 100, baselineCycle1: 10, candidateCycle0: 210, candidateCycle1: 20 }),
  });

  assert.equal(result.fixedOverheadBytes, 100);
  assert.equal(result.dataScalingObservedBytes, 599_900);
  assert.equal(result.dataScalingBudgetBytes, 125_000);
  assert.equal(result.dataScalingRegression, true);
  assert.equal(result.regression, true);
});

test("React memory gate applies the retained-heap floor when the baseline is negative", () => {
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 31_000,
    baselineP90Bytes: -49_000,
    pairedMemory: pairedMemory({ baselineCycle0: 100, baselineCycle1: 10, candidateCycle0: 100, candidateCycle1: 10 }),
  });

  assert.equal(result.dataScalingBudgetBytes, 81_920);
  assert.equal(result.dataScalingRegression, false);
});

test("React memory gate rejects a steady cycle p90 above the paired 25 percent budget", () => {
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 200,
    baselineP90Bytes: 100,
    pairedMemory: pairedMemory({ baselineCycle0: 100, baselineCycle1: 100, candidateCycle0: 70_100, candidateCycle1: 70_000 }),
  });

  assert.equal(result.steadyGrowth.baseline.p90, 100);
  assert.equal(result.steadyGrowth.candidate.p90, 70_000);
  assert.equal(result.steadyGrowth.budgetBytes, 65_536);
  assert.equal(result.steadyGrowth.regression, true);
  assert.equal(result.regression, true);
});

test("React memory gate rejects persistent representative-cycle growth and keeps all cycle positions", () => {
  const cleanup = representativeCleanup([20, 22, 24, 26, 28], [20, 22, 70_000, 70_000, 70_000]);
  const result = evaluateReactMemoryGate({
    candidateP90Bytes: 100,
    baselineP90Bytes: 100,
    pairedMemory: pairedMemory({ candidateCycle0: 800_000, candidateCycle1: 120 }),
    representativeCleanup: cleanup,
  });

  assert.equal(cleanup.candidate.cycles.length, 6);
  assert.equal(cleanup.candidate.cycles[3].samples[0], 70_000);
  assert.equal(result.representativeGrowth.regression, true);
  assert.equal(result.regression, true);
});

test("React memory samples preserve execution order and require balanced AB/BA runs for enforcement", () => {
  const baseline = [{ executionOrder: "baseline-candidate", cleanupCycles: { cycles: [{ delta: 1 }, { delta: 2 }] } }];
  const candidate = [{ executionOrder: "baseline-candidate", cleanupCycles: { cycles: [{ delta: 1 }, { delta: 2 }] } }];
  assert.deepEqual(buildPairedMemorySamples(baseline, candidate).executionOrderCounts, {
    "baseline-candidate": 1,
    "candidate-baseline": 0,
  });
  assert.throws(
    () => buildPairedMemorySamples([], candidate),
    /equal baseline and candidate run counts/,
  );
  assert.throws(
    () => buildPairedMemorySamples(
      baseline,
      [{ executionOrder: "candidate-baseline", cleanupCycles: { cycles: [{ delta: 1 }, { delta: 2 }] } }],
    ),
    /inconsistent execution order/,
  );
  assert.throws(
    () => buildPairedMemorySamples(
      baseline,
      [{ executionOrder: "baseline-candidate", cleanupCycles: { cycles: [{ delta: 1 }] } }],
    ),
    /missing cycle0 or cycle1/,
  );
  assert.throws(
    () => buildPairedMemorySamples(
      Array.from({ length: 10 }, () => baseline[0]),
      Array.from({ length: 10 }, () => candidate[0]),
      { requireBalanced: true },
    ),
    /ten runs split across five AB and five BA/,
  );
});
