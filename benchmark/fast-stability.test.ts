export {};

const assert = require("node:assert/strict");
const { evaluatePairedBudget, FAST_PAIRED_BUDGET } = require("./paired.mjs");
const { FAST_BENCHMARK_CONFIG } = require("./fast-config.mjs");

function pairedSamples(candidateMs) {
  return Array.from({ length: FAST_BENCHMARK_CONFIG.pairCount }, (_, run) => ({
    fixture: "segment",
    run,
    order: run % 2 === 0 ? "main-candidate" : "candidate-main",
    mainMs: 13,
    candidateMs,
  }));
}

function medianObservation(iterations) {
  const samples = Array.from({ length: iterations }, (_, index) => (index < 3 ? 18 : 13));
  return [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.5) - 1];
}

test("short jittered observations regress while an extended observation stays within the same budget", () => {
  const shortObservation = medianObservation(5);
  const extendedObservation = medianObservation(10);

  assert.equal(evaluatePairedBudget(pairedSamples(shortObservation), FAST_PAIRED_BUDGET).status, "regression");
  assert.equal(evaluatePairedBudget(pairedSamples(extendedObservation), FAST_PAIRED_BUDGET).status, "pass");
});

test("fast benchmark keeps twenty pairs and extends each observation without changing warmup", () => {
  assert.deepEqual(FAST_PAIRED_BUDGET, {
    p50DeltaMs: 16,
    p90DeltaMs: 16,
    p90DeltaPercent: 25,
  });
  assert.equal(FAST_BENCHMARK_CONFIG.pairCount, 20);
  assert.equal(FAST_BENCHMARK_CONFIG.batchSize, 16);
  assert.equal(FAST_BENCHMARK_CONFIG.sampleIterations, 10);
  assert.equal(FAST_BENCHMARK_CONFIG.warmupIterations, 5);
});
