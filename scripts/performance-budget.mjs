export const FEEDBACK_ABSOLUTE_BUDGET_MS = 100;
export const FEEDBACK_PAIRED_P50_BUDGET_MS = 16;
export const REACT_BUNDLE_MAX_INCREASE_PERCENT = 35;
export const REACT_INITIALIZATION_METRICS = ["reactInitMs", "wasmInitMs", "initializationSpanMs"];

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

function compareBytes(candidate, baseline) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) {
    return { candidate, baseline, absolute: null, percent: null, status: "unmeasured" };
  }
  if (baseline === 0) {
    return {
      candidate,
      baseline,
      absolute: candidate,
      percent: candidate === 0 ? 0 : null,
      status: candidate === 0 ? "within-budget" : "regression",
    };
  }
  const absolute = candidate - baseline;
  const percent = (absolute / baseline) * 100;
  return {
    candidate,
    baseline,
    absolute,
    percent,
    status: percent > REACT_BUNDLE_MAX_INCREASE_PERCENT ? "regression" : "within-budget",
  };
}

function compareInitialization(candidate, baseline) {
  if (!Number.isFinite(candidate)) {
    return { candidate, baseline, absolute: null, percent: null, status: "missing" };
  }
  if (candidate < 0) {
    return { candidate, baseline, absolute: null, percent: null, status: "invalid" };
  }
  if (!Number.isFinite(baseline)) {
    return { candidate, baseline: null, absolute: null, percent: null, status: "measured" };
  }
  const absolute = candidate - baseline;
  return {
    candidate,
    baseline,
    absolute,
    percent: baseline === 0 ? null : (absolute / baseline) * 100,
    status: "measured",
  };
}

export function evaluateReactMigrationGate({
  candidateBundle,
  baselineBundle,
  initializationReports,
}) {
  const failures = [];
  const bundle = {};
  for (const encoding of ["raw", "gzip9"]) {
    bundle[encoding] = {};
    for (const platform of ["chrome", "safari", "total"]) {
      const result = compareBytes(candidateBundle?.[encoding]?.[platform], baselineBundle?.[encoding]?.[platform]);
      bundle[encoding][platform] = result;
      if (result.status === "regression") {
        failures.push(`${encoding}.${platform} bundle increase ${result.percent.toFixed(1)}% exceeds ${REACT_BUNDLE_MAX_INCREASE_PERCENT}%`);
      }
    }
  }

  const initialization = {};
  for (const report of initializationReports || []) {
    const metrics = {};
    for (const metric of REACT_INITIALIZATION_METRICS) {
      const result = compareInitialization(report.candidate?.[metric], report.baseline?.[metric]);
      metrics[metric] = result;
      if (result.status === "missing") failures.push(`${report.name}.${metric} is not measured`);
      if (result.status === "invalid") failures.push(`${report.name}.${metric} is invalid`);
    }
    initialization[report.name] = metrics;
  }

  return {
    status: failures.length > 0 ? "fail" : baselineBundle ? "pass" : "unpaired",
    failures,
    bundle,
    initialization,
  };
}
