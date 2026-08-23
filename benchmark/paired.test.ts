export {};

const assert = require("node:assert/strict");
const {
  evaluatePairedBudget,
  summarizePairedSamples,
} = require("./paired.mjs");

const alternatingSamples = [
  { fixture: "reader-text", run: 0, order: "main-candidate", mainMs: 10, candidateMs: 11 },
  { fixture: "reader-text", run: 1, order: "candidate-main", mainMs: 10, candidateMs: 12 },
  { fixture: "reader-text", run: 2, order: "main-candidate", mainMs: 10, candidateMs: 13 },
  { fixture: "reader-text", run: 3, order: "candidate-main", mainMs: 10, candidateMs: 14 },
];

test("paired benchmark reports percentile deltas from alternating main and candidate samples", () => {
  const report = summarizePairedSamples(alternatingSamples);

  assert.deepEqual(report.orders, ["main-candidate", "candidate-main", "main-candidate", "candidate-main"]);
  assert.equal(report.deltaMs.p50, 2);
  assert.equal(report.deltaMs.p90, 4);
  assert.equal(report.deltaPercent.p90, 40);
});

test("paired benchmark rejects an intentionally regressing fixture at its allowed delta", () => {
  const result = evaluatePairedBudget(alternatingSamples, {
    p50DeltaMs: 2,
    p90DeltaMs: 4,
    p90DeltaPercent: 25,
  });

  assert.equal(result.status, "regression");
  assert.match(result.failures.join("\n"), /p90 paired delta percent/);
});

test("paired benchmark requires main and candidate samples to alternate on one runner", () => {
  assert.throws(
    () => summarizePairedSamples([
      alternatingSamples[0],
      alternatingSamples[2],
      alternatingSamples[1],
      alternatingSamples[3],
    ]),
    /alternate main-candidate and candidate-main/,
  );
});
