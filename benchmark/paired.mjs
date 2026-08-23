export const FAST_PAIRED_BUDGET = Object.freeze({
  p50DeltaMs: 16,
  p90DeltaMs: 16,
  p90DeltaPercent: 25,
});
export const FAST_FIXTURES = Object.freeze(["segment", "flow"]);
export const FAST_PAIR_COUNT = 20;

const ORDERS = ["main-candidate", "candidate-main"];

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function percentile(values, rank) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("percentile requires finite samples");
  }
  if (!(rank > 0 && rank <= 1)) throw new Error("percentile rank must be in (0, 1]");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * rank) - 1)];
}

function validateSample(sample, index, fixture) {
  if (!sample || sample.fixture !== fixture) throw new Error(`paired sample ${index} has a different fixture`);
  if (!Number.isInteger(sample.run) || sample.run !== index) {
    throw new Error(`paired sample ${index} must have contiguous run numbers`);
  }
  if (!ORDERS.includes(sample.order)) throw new Error(`paired sample ${index} has an invalid execution order`);
  const expectedOrder = ORDERS[index % ORDERS.length];
  if (sample.order !== expectedOrder) {
    throw new Error("paired samples must alternate main-candidate and candidate-main");
  }
  assertFinite(sample.mainMs, `paired sample ${index} mainMs`);
  assertFinite(sample.candidateMs, `paired sample ${index} candidateMs`);
  if (sample.mainMs <= 0 || sample.candidateMs < 0) {
    throw new Error(`paired sample ${index} has an invalid duration`);
  }
}

function summary(values) {
  return {
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
  };
}

export function summarizePairedSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error("paired benchmark requires at least two samples");
  }
  const fixture = samples[0]?.fixture;
  if (typeof fixture !== "string" || fixture.length === 0) throw new Error("paired sample fixture is required");
  samples.forEach((sample, index) => validateSample(sample, index, fixture));

  const deltas = samples.map((sample) => sample.candidateMs - sample.mainMs);
  const deltaPercent = samples.map((sample) => ((sample.candidateMs - sample.mainMs) / sample.mainMs) * 100);
  return {
    fixture,
    sampleCount: samples.length,
    orders: samples.map((sample) => sample.order),
    mainMs: summary(samples.map((sample) => sample.mainMs)),
    candidateMs: summary(samples.map((sample) => sample.candidateMs)),
    deltaMs: summary(deltas),
    deltaPercent: summary(deltaPercent),
    samples: samples.map((sample, index) => ({
      ...sample,
      deltaMs: deltas[index],
      deltaPercent: deltaPercent[index],
    })),
  };
}

export function evaluatePairedBudget(samples, budget = FAST_PAIRED_BUDGET) {
  const report = summarizePairedSamples(samples);
  const failures = [];
  if (report.deltaMs.p50 > budget.p50DeltaMs) {
    failures.push(`p50 paired delta ${report.deltaMs.p50.toFixed(3)}ms exceeds ${budget.p50DeltaMs}ms`);
  }
  if (report.deltaMs.p90 > budget.p90DeltaMs) {
    failures.push(`p90 paired delta ${report.deltaMs.p90.toFixed(3)}ms exceeds ${budget.p90DeltaMs}ms`);
  }
  if (report.deltaPercent.p90 > budget.p90DeltaPercent) {
    failures.push(`p90 paired delta percent ${report.deltaPercent.p90.toFixed(3)}% exceeds ${budget.p90DeltaPercent}%`);
  }
  return {
    status: failures.length === 0 ? "pass" : "regression",
    report,
    budget,
    failures,
  };
}

function benchmarkRecords(report) {
  if (!report || typeof report !== "object") throw new Error("Vitest benchmark report is required");
  const files = Array.isArray(report.files) ? report.files : [];
  return files.flatMap((file) => (Array.isArray(file.groups) ? file.groups : [])
    .flatMap((group) => Array.isArray(group.benchmarks) ? group.benchmarks : []));
}

function recordStatistics(record, name) {
  const samples = Array.isArray(record.samples) ? record.samples.filter(Number.isFinite) : [];
  const medianMs = Number.isFinite(record.median)
    ? record.median
    : samples.length > 0 ? percentile(samples, 0.5) : null;
  if (!Number.isFinite(medianMs)) {
    throw new Error(`${name} has no benchmark median statistic`);
  }
  return { medianMs, samples };
}

export function pairVitestBenchmarks(report) {
  const records = benchmarkRecords(report);
  const pairs = new Map();
  for (const record of records) {
    const name = String(record.name || record.id || "");
    const match = name.match(/fast\/([^/]+)\/pair-(\d+)\/(main|candidate)$/u);
    if (!match) continue;
    const [, fixture, runText, side] = match;
    const run = Number(runText);
    const statistics = recordStatistics(record, name);
    const key = `${fixture}:${run}`;
    const pair = pairs.get(key) || { fixture, run, records: {} };
    if (pair.records[side]) throw new Error(`${name} is duplicated`);
    pair.records[side] = {
      samples: statistics.samples,
      medianMs: statistics.medianMs,
    };
    pairs.set(key, pair);
  }
  const grouped = new Map();
  for (const pair of pairs.values()) {
    if (!pair.records.main || !pair.records.candidate) {
      throw new Error(`benchmark pair ${pair.fixture}:${pair.run} is incomplete`);
    }
    const fixturePairs = grouped.get(pair.fixture) || [];
    fixturePairs.push({
      fixture: pair.fixture,
      run: pair.run,
      order: pair.run % ORDERS.length === 0 ? ORDERS[0] : ORDERS[1],
      mainMs: pair.records.main.medianMs,
      candidateMs: pair.records.candidate.medianMs,
      mainSamples: pair.records.main.samples,
      candidateSamples: pair.records.candidate.samples,
    });
    grouped.set(pair.fixture, fixturePairs);
  }
  const groups = [...grouped.values()]
    .map((samples) => samples.sort((left, right) => left.run - right.run))
    .sort((left, right) => left[0].fixture.localeCompare(right[0].fixture));
  const actualFixtures = new Set(groups.map((samples) => samples[0].fixture));
  const missingFixtures = FAST_FIXTURES.filter((fixture) => !actualFixtures.has(fixture));
  const unexpectedFixtures = [...actualFixtures].filter((fixture) => !FAST_FIXTURES.includes(fixture));
  if (missingFixtures.length > 0 || unexpectedFixtures.length > 0) {
    throw new Error(
      `expected fast benchmark fixtures ${FAST_FIXTURES.join(", ")}; `
      + `missing ${missingFixtures.join(", ") || "none"}; `
      + `unexpected ${unexpectedFixtures.join(", ") || "none"}`,
    );
  }
  for (const samples of groups) {
    if (samples.length !== FAST_PAIR_COUNT) {
      throw new Error(
        `${samples[0].fixture} expected ${FAST_PAIR_COUNT} paired samples, received ${samples.length}`,
      );
    }
  }
  return groups;
}

export function evaluateVitestReport(report, budget = FAST_PAIRED_BUDGET) {
  const groups = pairVitestBenchmarks(report).map((samples) => evaluatePairedBudget(samples, budget));
  const failures = groups.flatMap((group) => group.failures.map((failure) => `${group.report.fixture}: ${failure}`));
  return {
    status: failures.length === 0 ? "pass" : "regression",
    groups,
    failures,
  };
}
