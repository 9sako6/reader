import { percentile } from "./sample.mjs";

export const FEEDBACK_ABSOLUTE_BUDGET_MS = 100;
export const FEEDBACK_PAIRED_P50_BUDGET_MS = 16;
export const REACT_BUNDLE_MAX_INCREASE_PERCENT = 35;
export const REACT_FIXED_HEAP_BUDGET_BYTES = 400_000;
export const REACT_MEMORY_FLOOR_BYTES = 65_536;
export const REACT_REPRESENTATIVE_LEAK_P50_BUDGET_BYTES = 32_768;
export const REACT_REPRESENTATIVE_LEAK_P90_BUDGET_BYTES = 65_536;
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

export function summarizeMemorySamples(values) {
  const samples = Array.isArray(values) ? [...values] : [];
  const measured = samples.length > 0 && samples.every((value) => Number.isFinite(value));
  return {
    samples,
    count: samples.length,
    p50: measured ? percentile(samples, 0.5) : null,
    p90: measured ? percentile(samples, 0.9) : null,
    max: measured ? Math.max(...samples) : null,
  };
}

function cycleDelta(run, cycle) {
  return run?.cleanupCycles?.cycles?.[cycle]?.delta ?? null;
}

export function buildPairedMemorySamples(baselineRuns, candidateRuns, { requireBalanced = false } = {}) {
  if (!Array.isArray(baselineRuns) || !Array.isArray(candidateRuns) || baselineRuns.length !== candidateRuns.length) {
    throw new Error("Paired memory samples require equal baseline and candidate run counts");
  }
  const samples = baselineRuns.map((baselineRun, index) => {
    const candidateRun = candidateRuns[index];
    const baselineOrder = baselineRun?.executionOrder;
    const candidateOrder = candidateRun?.executionOrder;
    if (![
      "baseline-candidate",
      "candidate-baseline",
    ].includes(baselineOrder) || baselineOrder !== candidateOrder) {
      throw new Error(`Paired memory sample ${index} has inconsistent execution order`);
    }
    const baselineCycle0 = cycleDelta(baselineRun, 0);
    const baselineCycle1 = cycleDelta(baselineRun, 1);
    const candidateCycle0 = cycleDelta(candidateRun, 0);
    const candidateCycle1 = cycleDelta(candidateRun, 1);
    const fixedOverheadBytes = [baselineCycle0, baselineCycle1, candidateCycle0, candidateCycle1].every(Number.isFinite)
      ? (candidateCycle0 - candidateCycle1) - (baselineCycle0 - baselineCycle1)
      : null;
    if (![baselineCycle0, baselineCycle1, candidateCycle0, candidateCycle1].every(Number.isFinite)) {
      throw new Error(`Paired memory sample ${index} is missing cycle0 or cycle1 heap data`);
    }
    return {
      run: index,
      executionOrder: candidateRun?.executionOrder ?? baselineRun?.executionOrder ?? null,
      baseline: { cycle0: baselineCycle0, cycle1: baselineCycle1 },
      candidate: { cycle0: candidateCycle0, cycle1: candidateCycle1 },
      fixedOverheadBytes,
    };
  });
  const executionOrderCounts = {
    "baseline-candidate": samples.filter((sample) => sample.executionOrder === "baseline-candidate").length,
    "candidate-baseline": samples.filter((sample) => sample.executionOrder === "candidate-baseline").length,
  };
  if (requireBalanced && (samples.length !== 10 || executionOrderCounts["baseline-candidate"] !== 5 || executionOrderCounts["candidate-baseline"] !== 5)) {
    throw new Error("Paired memory samples require ten runs split across five AB and five BA orders");
  }
  return {
    sampleCount: samples.length,
    samples,
    executionOrderCounts,
    fixedOverhead: summarizeMemorySamples(samples.map((sample) => sample.fixedOverheadBytes)),
    baselineSteady: summarizeMemorySamples(samples.map((sample) => sample.baseline.cycle1)),
    candidateSteady: summarizeMemorySamples(samples.map((sample) => sample.candidate.cycle1)),
    steadyDelta: summarizeMemorySamples(samples.map((sample) => sample.candidate.cycle1 - sample.baseline.cycle1)),
  };
}

function steadyMemoryGate(baselineSummary, candidateSummary, pairedDelta, firstRootFixedOverheadBytes) {
  const measured = Number.isFinite(baselineSummary?.p90)
    && Number.isFinite(candidateSummary?.p90)
    && Number.isFinite(pairedDelta?.p90);
  const secondRootOverheadBytes = measured ? Math.max(0, pairedDelta.p90) : null;
  const combinedFixedOverheadBytes = measured && Number.isFinite(firstRootFixedOverheadBytes)
    ? Math.max(0, firstRootFixedOverheadBytes) + secondRootOverheadBytes
    : null;
  return {
    baseline: baselineSummary,
    candidate: candidateSummary,
    pairedDelta,
    secondRootOverheadBytes,
    combinedFixedOverheadBytes,
    classification: "second-root-overhead",
    regression: !measured,
  };
}

function representativeMemoryGate(representativeCleanup) {
  if (!representativeCleanup) return null;
  const baseline = representativeCleanup.baseline?.steadyIncrements;
  const candidate = representativeCleanup.candidate?.steadyIncrements;
  const pairedDelta = representativeCleanup.steadyDelta;
  const measured = Number.isFinite(pairedDelta?.p50) && Number.isFinite(pairedDelta?.p90);
  return {
    baseline,
    candidate,
    pairedDelta,
    warmupCycles: representativeCleanup.candidate?.warmupCycles ?? null,
    cycleCount: representativeCleanup.candidate?.cycles?.length ?? null,
    p50BudgetBytes: REACT_REPRESENTATIVE_LEAK_P50_BUDGET_BYTES,
    p90BudgetBytes: REACT_REPRESENTATIVE_LEAK_P90_BUDGET_BYTES,
    budgetBytes: REACT_REPRESENTATIVE_LEAK_P90_BUDGET_BYTES,
    classification: "cycle2-plus-persistence",
    regression: !measured
      || pairedDelta.p50 > REACT_REPRESENTATIVE_LEAK_P50_BUDGET_BYTES
      || pairedDelta.p90 > REACT_REPRESENTATIVE_LEAK_P90_BUDGET_BYTES,
  };
}

export function evaluateReactMemoryGate({ candidateP90Bytes, baselineP90Bytes, pairedMemory = null, representativeCleanup = null }) {
  const candidateMeasured = Number.isFinite(candidateP90Bytes);
  const baselineMeasured = Number.isFinite(baselineP90Bytes);
  const fixedSummary = pairedMemory?.fixedOverhead;
  const fixedMeasured = Number.isFinite(fixedSummary?.p90);
  const steadyMeasured = Number.isFinite(pairedMemory?.baselineSteady?.p90)
    && Number.isFinite(pairedMemory?.candidateSteady?.p90)
    && Number.isFinite(pairedMemory?.steadyDelta?.p90);
  if (!candidateMeasured || !baselineMeasured || !fixedMeasured || !steadyMeasured) {
    return {
      status: "unmeasured",
      candidateP90Bytes,
      baselineP90Bytes,
      fixedOverheadBytes: fixedMeasured ? Math.max(0, fixedSummary.p90) : null,
      fixedOverhead: fixedSummary ?? null,
      fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
      dataScalingBudgetBytes: null,
      combinedBudgetBytes: null,
      dataScalingObservedBytes: null,
      steadyGrowth: pairedMemory
        ? steadyMemoryGate(pairedMemory.baselineSteady, pairedMemory.candidateSteady, pairedMemory.steadyDelta, null)
        : null,
      representativeGrowth: representativeMemoryGate(representativeCleanup),
      regression: true,
    };
  }
  const measuredFixedOverheadBytes = Math.max(0, fixedSummary.p90);
  const secondRootOverheadBytes = Math.max(0, pairedMemory.steadyDelta.p90);
  const combinedFixedOverheadBytes = measuredFixedOverheadBytes + secondRootOverheadBytes;
  const dataScalingBudgetBytes = Math.max(REACT_MEMORY_FLOOR_BYTES, Math.max(0, baselineP90Bytes)) * 1.25;
  const dataScalingObservedBytes = candidateP90Bytes - measuredFixedOverheadBytes;
  const combinedBudgetBytes = dataScalingBudgetBytes + measuredFixedOverheadBytes;
  const dataScalingRegression = dataScalingObservedBytes > dataScalingBudgetBytes;
  const steadyGrowth = steadyMemoryGate(pairedMemory.baselineSteady, pairedMemory.candidateSteady, pairedMemory.steadyDelta, measuredFixedOverheadBytes);
  const representativeGrowth = representativeMemoryGate(representativeCleanup);
  const cleanupRegression = representativeGrowth?.regression === true;
  return {
    status: combinedFixedOverheadBytes > REACT_FIXED_HEAP_BUDGET_BYTES || dataScalingRegression || cleanupRegression ? "regression" : "within-budget",
    candidateP90Bytes,
    baselineP90Bytes,
    fixedOverheadBytes: measuredFixedOverheadBytes,
    fixedOverhead: fixedSummary,
    secondRootOverheadBytes,
    secondRootOverhead: pairedMemory.steadyDelta,
    combinedFixedOverheadBytes,
    fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
    dataScalingBudgetBytes,
    dataScalingObservedBytes,
    combinedBudgetBytes,
    fixedOverheadRegression: combinedFixedOverheadBytes > REACT_FIXED_HEAP_BUDGET_BYTES,
    dataScalingRegression,
    steadyGrowth,
    representativeGrowth,
    regression: combinedFixedOverheadBytes > REACT_FIXED_HEAP_BUDGET_BYTES || dataScalingRegression || cleanupRegression,
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
