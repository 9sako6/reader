export const FEEDBACK_ABSOLUTE_BUDGET_MS = 100;
export const FEEDBACK_PAIRED_P50_BUDGET_MS = 16;

export function evaluateFeedbackBudget({ observedP90, pairedP50DeltaMs = null }) {
  const pairedP50WithinBudget = pairedP50DeltaMs === null
    || pairedP50DeltaMs <= FEEDBACK_PAIRED_P50_BUDGET_MS;
  return {
    absoluteBudgetMs: FEEDBACK_ABSOLUTE_BUDGET_MS,
    pairedP50BudgetMs: FEEDBACK_PAIRED_P50_BUDGET_MS,
    pairedP50DeltaMs,
    regression: observedP90 > FEEDBACK_ABSOLUTE_BUDGET_MS || !pairedP50WithinBudget,
  };
}
