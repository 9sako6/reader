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
  assert.match(workflow, /max-parallel: 5/);
  assert.match(workflow, /run: node benchmark\/full-browser\.mjs/);
  assert.match(workflow, /READER_PERFORMANCE_GROUP/);
  assert.match(workflow, /READER_PERFORMANCE_BASELINE_ROOT/);
  assert.match(workflow, /READER_PERFORMANCE_BASE_COMMIT=/);
  assert.match(workflow, /READER_PERFORMANCE_CANDIDATE_COMMIT=/);
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /git rev-list --first-parent --max-count=2/);
  assert.match(workflow, /test \"\$baseline_commit\" != \"\$candidate_commit\"/);
  assert.match(workflow, /git worktree add --detach/);
  assert.match(workflow, /name: Remove main benchmark baseline[\s\S]*if: always\(\)/);
  assert.doesNotMatch(workflow, /READER_PERFORMANCE_RUNS:\s+[0-9](?:\s|$)/);
});
