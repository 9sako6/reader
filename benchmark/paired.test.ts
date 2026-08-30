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

function makeFastReport(fixtures = ["segment", "flow", "contexts", "spots"], pairCount = 20) {
  const benchmarks = [];
  for (const fixture of fixtures) {
    for (let run = 0; run < pairCount; run += 1) {
      const first = run % 2 === 0 ? "main" : "candidate";
      const second = first === "main" ? "candidate" : "main";
      for (const side of [first, second]) {
        const median = side === "main" ? 10 : 11;
        benchmarks.push({
          name: `fast/${fixture}/pair-${run}/${side}`,
          median,
          samples: [],
        });
      }
    }
  }
  return { files: [{ groups: [{ benchmarks }] }] };
}

test("paired benchmark reports percentile deltas after balancing opposite execution orders", () => {
  const report = summarizePairedSamples(alternatingSamples);

  assert.deepEqual(report.orders, ["main-candidate", "candidate-main", "main-candidate", "candidate-main"]);
  assert.equal(report.comparisonCount, 2);
  assert.equal(report.deltaMs.p50, 1.5);
  assert.equal(report.deltaMs.p90, 3.5);
  assert.equal(report.deltaPercent.p90, 35);
});

test("paired benchmark ignores equal second-execution cost on main and candidate", () => {
  const result = evaluatePairedBudget([
    { fixture: "reader-text", run: 0, order: "main-candidate", mainMs: 10, candidateMs: 18 },
    { fixture: "reader-text", run: 1, order: "candidate-main", mainMs: 18, candidateMs: 10 },
    { fixture: "reader-text", run: 2, order: "main-candidate", mainMs: 10, candidateMs: 18 },
    { fixture: "reader-text", run: 3, order: "candidate-main", mainMs: 18, candidateMs: 10 },
  ], {
    p50DeltaMs: 1,
    p90DeltaMs: 1,
    p90DeltaPercent: 1,
  });

  assert.equal(result.status, "pass");
  assert.equal(result.report.deltaMs.p90, 0);
  assert.equal(result.report.deltaPercent.p90, 0);
});

test("paired benchmark rejects a consistent candidate regression after balancing execution order", () => {
  const result = evaluatePairedBudget([
    { fixture: "reader-text", run: 0, order: "main-candidate", mainMs: 10, candidateMs: 18 },
    { fixture: "reader-text", run: 1, order: "candidate-main", mainMs: 14, candidateMs: 14 },
    { fixture: "reader-text", run: 2, order: "main-candidate", mainMs: 10, candidateMs: 18 },
    { fixture: "reader-text", run: 3, order: "candidate-main", mainMs: 14, candidateMs: 14 },
  ], {
    p50DeltaMs: 3,
    p90DeltaMs: 3,
    p90DeltaPercent: 25,
  });

  assert.equal(result.status, "regression");
  assert.equal(result.report.deltaMs.p90, 4);
  assert.equal(result.report.deltaPercent.p90.toFixed(3), "33.333");
});

test("paired benchmark rejects an unmatched final execution order", () => {
  assert.throws(
    () => summarizePairedSamples(alternatingSamples.slice(0, 3)),
    /complete alternating order pairs/,
  );
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
      { ...alternatingSamples[1], order: "main-candidate" },
      { ...alternatingSamples[2], order: "candidate-main" },
      { ...alternatingSamples[3], order: "main-candidate" },
    ]),
    /alternate main-candidate and candidate-main/,
  );
});

test("paired benchmark rejects a candidate duration of zero", () => {
  assert.throws(
    () => summarizePairedSamples([
      { ...alternatingSamples[0], candidateMs: 0 },
      ...alternatingSamples.slice(1),
    ]),
    /paired sample 0 has an invalid duration/,
  );
});

test("paired benchmark rejects a main duration of zero", () => {
  assert.throws(
    () => summarizePairedSamples([
      { ...alternatingSamples[0], mainMs: 0 },
      ...alternatingSamples.slice(1),
    ]),
    /paired sample 0 has an invalid duration/,
  );
});

test("paired benchmark aggregates Vitest JSON percentile statistics when raw samples are omitted", () => {
  const { evaluateVitestReport } = require("./paired.mjs");
  const benchmarks = [];
  for (const fixture of ["segment", "flow", "contexts", "spots"]) {
    for (let run = 0; run < 20; run += 1) {
      const first = run % 2 === 0 ? "main" : "candidate";
      const second = first === "main" ? "candidate" : "main";
      for (const side of [first, second]) {
        const median = side === "main" ? 10 : 11;
        benchmarks.push({
        name: `fast/${fixture}/pair-${run}/${side}`,
        median,
        samples: [],
        });
      }
    }
  }

  const result = evaluateVitestReport({ files: [{ groups: [{ benchmarks }] }] }, {
    p50DeltaMs: 2,
    p90DeltaMs: 2,
    p90DeltaPercent: 20,
  });

  assert.equal(result.status, "pass");
  assert.equal(result.groups.length, 4);
  assert.equal(result.groups.find((group) => group.report.fixture === "flow").report.deltaMs.p50, 1);
  assert.equal(result.groups.find((group) => group.report.fixture === "flow").report.deltaMs.p90, 1);
});

test("paired benchmark rejects a Vitest report with no matching fast benchmark records", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport({ files: [] }),
    /expected fast benchmark fixtures/,
  );
});

test("paired benchmark rejects a Vitest report missing the flow fixture", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport(makeFastReport(["segment"])),
    /expected fast benchmark fixtures.*flow/,
  );
});

test("paired benchmark rejects a Vitest report missing one pair per fixture", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport(makeFastReport(["flow", "segment", "contexts", "spots"], 19)),
    /expected 20 paired samples.*received 19/,
  );
});

test("paired benchmark rejects a Vitest report with an extra pair per fixture", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport(makeFastReport(["segment", "flow", "contexts", "spots"], 21)),
    /expected 20 paired samples.*received 21/,
  );
});
