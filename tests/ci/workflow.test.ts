export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.resolve(__dirname, "../../.github/workflows/ci.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const fullWorkflowPath = path.resolve(__dirname, "../../.github/workflows/full-ci.yml");
const fullWorkflow = fs.readFileSync(fullWorkflowPath, "utf8");
const misePath = path.resolve(__dirname, "../../mise.toml");
const mise = fs.readFileSync(misePath, "utf8");

function jobKeys(source) {
  const jobsStart = source.indexOf("\njobs:\n");
  assert.ok(jobsStart >= 0, "workflow must define jobs");
  return [...source.slice(jobsStart).matchAll(/^  ([a-z][a-z0-9-]*):$/gmu)].map((match) => match[1]);
}

function jobBlock(source, jobName) {
  const start = source.indexOf(`\n  ${jobName}:\n`);
  assert.ok(start >= 0, `${jobName} job must exist`);
  const next = source.slice(start + 3).search(/^  [a-z][a-z0-9-]*:$/mu);
  return source.slice(start, next < 0 ? source.length : start + 3 + next);
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

test("required TypeScript job uses Node-only checks and the artifact-independent test task", () => {
  const testJob = jobBlock(workflow, "test");

  assert.match(testJob, /install_args: node pnpm/);
  assert.match(testJob, /run: mise run typecheck/);
  assert.match(testJob, /run: mise run test:node/);
  assert.doesNotMatch(testJob, /rustup|cargo|openjdk|quint|wasm|run: mise run test(?:\s|$)|measure:/iu);
});

test("Node test task explicitly excludes only generated-artifact Vitest files", () => {
  const nodeTaskStart = mise.indexOf('[tasks."test:node"]');
  const testTaskStart = mise.indexOf('[tasks.test]');
  assert.ok(nodeTaskStart >= 0, "mise must define test:node");
  assert.ok(testTaskStart > nodeTaskStart, "test:node must precede test");
  const nodeTask = mise.slice(nodeTaskStart, testTaskStart);
  const artifactTests = [
    "apps/chrome/tests/build.test.ts",
    "apps/ios/tests/extension.test.ts",
    "packages/session-ts/tests/session.real.test.ts",
  ];

  assert.match(nodeTask, /depends = \["compile", "build:reader-view"\]/u);
  assert.match(nodeTask, /pnpm exec vitest run/u);
  const excludes = [...nodeTask.matchAll(/--exclude\s+([^\s"]+)/gu)].map((match) => match[1]);
  assert.deepEqual(excludes, artifactTests);
  for (const testPath of artifactTests) {
    const escapedPath = testPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(nodeTask, new RegExp(`--exclude ${escapedPath}`, "u"));
  }
  assert.match(nodeTask, /--exclude apps\/chrome\/tests\/build\.test\.ts[\s\S]*--exclude apps\/ios\/tests\/extension\.test\.ts[\s\S]*--exclude packages\/session-ts\/tests\/session\.real\.test\.ts/u);
});

test("scheduled full CI is main-only and retains the complete session, artifact, and Vitest suite", () => {
  const permissionsStart = fullWorkflow.indexOf("\npermissions:\n");
  const onStart = fullWorkflow.indexOf("\non:\n");
  assert.ok(onStart >= 0 && permissionsStart > onStart);
  const eventKeys = [...fullWorkflow.slice(onStart, permissionsStart).matchAll(/^  ([a-z][a-z0-9_-]*):$/gmu)]
    .map((match) => match[1]);
  assert.deepEqual(eventKeys, ["schedule", "workflow_dispatch"]);
  assert.match(fullWorkflow, /ref: main/u);
  assert.match(fullWorkflow, /timeout-minutes: 10/u);
  assert.match(fullWorkflow, /rustup toolchain install 1\.97\.1[\s\S]*wasm32-unknown-unknown/u);
  assert.match(fullWorkflow, /cargo install wasm-bindgen-cli --version 0\.2\.127 --locked/u);
  assert.match(fullWorkflow, /openjdk-21-jre-headless/u);
  assert.match(fullWorkflow, /run: mise run check/u);
  assert.match(fullWorkflow, /run: mise run test\n/u);
  assert.match(fullWorkflow, /cargo clippy --locked --all-targets --all-features -- -D warnings/u);
  assert.match(fullWorkflow, /mise run spec:verify/u);
  assert.match(fullWorkflow, /mise run measure:session/u);
  assert.match(fullWorkflow, /mise run measure:bundle/u);
  assert.match(fullWorkflow, /path: test-results\/performance\/bundle\.json/u);
  assert.doesNotMatch(fullWorkflow, /--exclude .*\.test\.ts/u);
  assert.match(mise, /\[tasks\.test\][\s\S]*run = "pnpm exec vitest run"/u);
});
