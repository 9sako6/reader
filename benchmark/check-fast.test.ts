export {};

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function regressingVitestReport() {
  const benchmarks = [];
  for (const fixture of ["segment", "flow"]) {
    for (let run = 0; run < 20; run += 1) {
      const first = run % 2 === 0 ? "main" : "candidate";
      const second = first === "main" ? "candidate" : "main";
      for (const side of [first, second]) {
        const median = side === "main" ? 10 : 20;
        benchmarks.push({
          name: `fast/${fixture}/pair-${run}/${side}`,
          median,
          p99: median,
          samples: [],
        });
      }
    }
  }
  return { files: [{ groups: [{ benchmarks }] }] };
}

test("fast benchmark command exits nonzero for a deliberately regressing fixture", () => {
  const directory = mkdtempSync(join(tmpdir(), "reader-fast-benchmark-"));
  const inputPath = join(directory, "vitest.json");
  const outputPath = join(directory, "fast.json");
  writeFileSync(inputPath, JSON.stringify(regressingVitestReport()));

  const result = spawnSync(process.execPath, [
    "benchmark/check-fast.mjs",
    inputPath,
    outputPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Fast paired performance regression/);
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).status, "regression");
});
