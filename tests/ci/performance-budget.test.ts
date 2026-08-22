export {};

const assert = require("node:assert/strict");
const { evaluateFeedbackBudget, evaluateReactMigrationGate } = require("../../scripts/performance-budget.mjs");

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
