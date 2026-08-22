export const FEEDBACK_ABSOLUTE_BUDGET_MS = 100;
export const FEEDBACK_PAIRED_P50_BUDGET_MS = 16;
export const REACT_BUNDLE_MAX_INCREASE_PERCENT = 35;
export const REACT_FIXED_HEAP_BUDGET_BYTES = 400_000;
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

function summarizeCycleIncrements(cycles, warmupCycles) {
  const increments = cycles?.slice(warmupCycles).map((cycle) => cycle.delta) || [];
  return {
    increments,
    p50: increments.length > 0 && increments.every((value) => Number.isFinite(value))
      ? [...increments].sort((left, right) => left - right)[Math.floor(increments.length / 2)]
      : null,
    p90: increments.length > 0 && increments.every((value) => Number.isFinite(value))
      ? [...increments].sort((left, right) => left - right)[Math.max(0, Math.ceil(increments.length * 0.9) - 1)]
      : null,
    max: increments.length > 0 && increments.every((value) => Number.isFinite(value)) ? Math.max(...increments) : null,
  };
}

export function evaluateReactMemoryGate({ candidateP90Bytes, baselineP90Bytes, fixedOverheadBytes = null, cleanupCycles = null }) {
  const candidateMeasured = Number.isFinite(candidateP90Bytes);
  const baselineMeasured = Number.isFinite(baselineP90Bytes);
  if (!candidateMeasured || !baselineMeasured) {
    return {
      status: "unmeasured",
      candidateP90Bytes,
      baselineP90Bytes,
      fixedOverheadBytes,
      fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
      dataScalingBudgetBytes: null,
      combinedBudgetBytes: null,
      steadyGrowth: null,
      regression: true,
    };
  }
  const measuredFixedOverheadBytes = Number.isFinite(fixedOverheadBytes)
    ? Math.max(0, fixedOverheadBytes)
    : cleanupCycles && Number.isFinite(cleanupCycles.candidate?.cycles?.[0]?.delta) && Number.isFinite(cleanupCycles.baseline?.cycles?.[0]?.delta)
      ? Math.max(0, cleanupCycles.candidate.cycles[0].delta - cleanupCycles.baseline.cycles[0].delta)
      : null;
  if (!Number.isFinite(measuredFixedOverheadBytes)) {
    return {
      status: "unmeasured",
      candidateP90Bytes,
      baselineP90Bytes,
      fixedOverheadBytes: measuredFixedOverheadBytes,
      fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
      dataScalingBudgetBytes: null,
      combinedBudgetBytes: null,
      steadyGrowth: null,
      regression: true,
    };
  }
  const dataScalingBudgetBytes = Math.max(0, baselineP90Bytes) * 1.25;
  const combinedBudgetBytes = dataScalingBudgetBytes + measuredFixedOverheadBytes;
  const fixedOverheadRegression = measuredFixedOverheadBytes > REACT_FIXED_HEAP_BUDGET_BYTES;
  const dataScalingRegression = candidateP90Bytes > combinedBudgetBytes;
  const candidateSteady = cleanupCycles ? summarizeCycleIncrements(cleanupCycles.candidate?.cycles, cleanupCycles.candidate?.warmupCycles ?? 2) : null;
  const baselineSteady = cleanupCycles ? summarizeCycleIncrements(cleanupCycles.baseline?.cycles, cleanupCycles.baseline?.warmupCycles ?? 2) : null;
  const cleanupMeasured = cleanupCycles === null
    || (Number.isFinite(candidateSteady?.p90) && Number.isFinite(baselineSteady?.p90));
  const steadyBudgetBytes = cleanupMeasured && cleanupCycles !== null ? Math.max(0, baselineSteady.p90) * 1.25 : null;
  const cleanupRegression = cleanupCycles !== null
    && (!cleanupMeasured || candidateSteady.p90 > steadyBudgetBytes);
  return {
    status: fixedOverheadRegression || dataScalingRegression || cleanupRegression ? "regression" : "within-budget",
    candidateP90Bytes,
    baselineP90Bytes,
    fixedOverheadBytes: measuredFixedOverheadBytes,
    fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
    dataScalingBudgetBytes,
    combinedBudgetBytes,
    fixedOverheadRegression,
    dataScalingRegression,
    steadyGrowth: cleanupCycles === null ? null : {
      candidate: candidateSteady,
      baseline: baselineSteady,
      budgetBytes: steadyBudgetBytes,
      regression: cleanupRegression,
    },
    regression: fixedOverheadRegression || dataScalingRegression || cleanupRegression,
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
