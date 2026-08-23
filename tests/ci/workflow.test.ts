export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.resolve(__dirname, "../../.github/workflows/ci.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

function jobKeys(source) {
  const jobsStart = source.indexOf("\njobs:\n");
  assert.ok(jobsStart >= 0, "workflow must define jobs");
  return [...source.slice(jobsStart).matchAll(/^  ([a-z][a-z0-9-]*):$/gmu)].map((match) => match[1]);
}

test("required CI contains only the short test and fast benchmark jobs", () => {
  assert.deepEqual(jobKeys(workflow), ["test", "performance"]);
  assert.doesNotMatch(workflow, /mise run test:e2e/u);
  assert.doesNotMatch(workflow, /mise run test:chrome-extension/u);
  assert.doesNotMatch(workflow, /xcodebuild/u);
  assert.doesNotMatch(workflow, /mise run test:safari-package-runtime/u);
});

test("required CI exposes a short single-runner paired benchmark job", () => {
  const performanceJobStart = workflow.indexOf("\n  performance:\n");
  const performanceJob = workflow.slice(performanceJobStart);

  assert.ok(performanceJobStart >= 0);
  assert.match(performanceJob, /name: Fast paired benchmark/);
  assert.match(performanceJob, /timeout-minutes: 3/);
  assert.match(performanceJob, /vitest bench/);
  assert.match(performanceJob, /benchmark\/fast\.bench\.ts/);
  assert.match(performanceJob, /benchmark\/check-fast\.mjs/);
  assert.match(performanceJob, /--maxWorkers=1/);
  assert.match(performanceJob, /--no-file-parallelism/);
  assert.match(performanceJob, /fetch-depth: 2/);
  assert.match(performanceJob, /github\.event_name/);
  assert.match(performanceJob, /git rev-list --first-parent --max-count=2/);
  assert.match(performanceJob, /test "\$baseline_commit" != "\$candidate_commit"/);
  assert.match(performanceJob, /git worktree add --detach .*\$baseline_commit/);
  assert.match(performanceJob, /READER_BENCHMARK_BASELINE_COMMIT=/);
  assert.match(performanceJob, /READER_BENCHMARK_CANDIDATE_COMMIT=/);
  assert.match(performanceJob, /name: Remove main benchmark worktree[\s\S]*if: always\(\)/);
});
