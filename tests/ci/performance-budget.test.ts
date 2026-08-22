export {};

const assert = require("node:assert/strict");
const { evaluateFeedbackBudget } = require("../../scripts/performance-budget.mjs");

test("feedback budget accepts a p90 outlier when paired median remains stable", () => {
  const result = evaluateFeedbackBudget({ observedP90: 99, pairedP50DeltaMs: 0.3 });

  assert.equal(result.absoluteBudgetMs, 100);
  assert.equal(result.pairedP50BudgetMs, 16);
  assert.equal(result.regression, false);
});

test("feedback budget rejects a UX-boundary breach or systematic paired slowdown", () => {
  assert.equal(evaluateFeedbackBudget({ observedP90: 101, pairedP50DeltaMs: 0.3 }).regression, true);
  assert.equal(evaluateFeedbackBudget({ observedP90: 99, pairedP50DeltaMs: 16.1 }).regression, true);
});
