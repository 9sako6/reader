export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(
  path.resolve(__dirname, "../../.github/workflows/performance.yml"),
  "utf8",
);

test("full browser benchmark is only scheduled or manually dispatched and matrix-splits fixture groups", () => {
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /matrix:/);
  assert.match(workflow, /fixture-group/);
  assert.match(workflow, /short-article/);
  assert.match(workflow, /large-dom/);
  assert.match(workflow, /READER_PERFORMANCE_RUNS: 10/);
  assert.match(workflow, /node benchmark\/full-browser\.mjs/);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /test-results\/performance/);
});

test("full browser benchmark keeps each fixture group serial on its runner", () => {
  assert.match(workflow, /--maxWorkers=1/);
  assert.match(workflow, /--no-file-parallelism/);
  assert.match(workflow, /READER_PERFORMANCE_GROUP/);
  assert.doesNotMatch(workflow, /READER_PERFORMANCE_RUNS: [0-9](?!0)/);
});
