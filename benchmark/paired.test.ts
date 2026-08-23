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

function makeFastReport(fixtures = ["segment", "flow"], pairCount = 6) {
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
          p99: median + 1,
          samples: [],
        });
      }
    }
  }
  return { files: [{ groups: [{ benchmarks }] }] };
}

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
      { ...alternatingSamples[1], order: "main-candidate" },
      { ...alternatingSamples[2], order: "candidate-main" },
      { ...alternatingSamples[3], order: "main-candidate" },
    ]),
    /alternate main-candidate and candidate-main/,
  );
});

test("paired benchmark aggregates Vitest JSON percentile statistics when raw samples are omitted", () => {
  const { evaluateVitestReport } = require("./paired.mjs");
  const benchmarks = [];
  for (const fixture of ["segment", "flow"]) {
    for (let run = 0; run < 6; run += 1) {
      const first = run % 2 === 0 ? "main" : "candidate";
      const second = first === "main" ? "candidate" : "main";
      for (const side of [first, second]) {
        const median = side === "main" ? 10 : 11;
        benchmarks.push({
          name: `fast/${fixture}/pair-${run}/${side}`,
          median,
          p99: median + 1,
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
  assert.equal(result.groups.length, 2);
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

test("paired benchmark rejects a Vitest report missing one flow pair", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport(makeFastReport(["flow", "segment"], 5)),
    /flow.*expected 6 paired samples.*received 5/,
  );
});

test("paired benchmark rejects a Vitest report with an extra flow pair", () => {
  const { evaluateVitestReport } = require("./paired.mjs");

  assert.throws(
    () => evaluateVitestReport(makeFastReport(["segment", "flow"], 7)),
    /flow.*expected 6 paired samples.*received 7/,
  );
});
