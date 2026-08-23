export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");
const chromiumJobStart = workflow.indexOf("\n  e2e:\n");
const iosJobStart = workflow.indexOf("\n  ios:\n", chromiumJobStart);
const chromiumJob = workflow.slice(chromiumJobStart, iosJobStart);
const iosJob = workflow.slice(iosJobStart);

test("required CI keeps Chromium E2E free of the long paired browser benchmark", () => {
  const e2e = chromiumJob.indexOf("run: mise run test:e2e -- --project=chromium");
  const extensionSmoke = chromiumJob.indexOf("run: mise run test:chrome-extension");
  const timingUpload = chromiumJob.indexOf("name: Upload Chromium reader timing reports");
  const timingPath = chromiumJob.indexOf("path: test-results/timing/*.json", timingUpload);
  const diagnostics = chromiumJob.indexOf("name: Upload browser diagnostics");

  assert.ok(chromiumJobStart >= 0);
  assert.ok(iosJobStart > chromiumJobStart);
  assert.doesNotMatch(chromiumJob, /Build main performance baseline/);
  assert.doesNotMatch(chromiumJob, /Measure reader performance/);
  assert.doesNotMatch(chromiumJob, /READER_PERFORMANCE_BASELINE_ROOT/);
  assert.doesNotMatch(chromiumJob, /reader-performance-baseline/);
  assert.doesNotMatch(chromiumJob, /git worktree add/);
  assert.doesNotMatch(chromiumJob, /git worktree remove/);
  assert.ok(e2e >= 0 && e2e < extensionSmoke && extensionSmoke < timingUpload);
  assert.ok(timingUpload >= 0 && timingUpload < timingPath && timingPath < diagnostics);
  assert.match(chromiumJob.slice(timingUpload, diagnostics), /if: success\(\)/);
  assert.match(chromiumJob.slice(timingUpload, diagnostics), /if-no-files-found: error/);
});

test("required CI exposes a short single-runner paired benchmark job", () => {
  const performanceJobStart = workflow.indexOf("\n  performance:\n");
  const e2eJobStart = workflow.indexOf("\n  e2e:\n", performanceJobStart);
  const performanceJob = workflow.slice(performanceJobStart, e2eJobStart);

  assert.ok(performanceJobStart >= 0);
  assert.ok(e2eJobStart > performanceJobStart);
  assert.match(performanceJob, /name: Fast paired benchmark/);
  assert.match(performanceJob, /timeout-minutes: 3/);
  assert.match(performanceJob, /vitest bench/);
  assert.match(performanceJob, /benchmark\/fast\.bench\.ts/);
  assert.match(performanceJob, /benchmark\/check-fast\.mjs/);
  assert.match(performanceJob, /--maxWorkers=1/);
  assert.match(performanceJob, /--no-file-parallelism/);
});

test("CI uploads WebKit reader timing reports before the iOS build", () => {
  const e2e = iosJob.indexOf("run: mise run test:e2e -- --project=webkit");
  const timingUpload = iosJob.indexOf("name: Upload WebKit reader timing reports");
  const timingPath = iosJob.indexOf("path: test-results/timing/*.json", timingUpload);
  const build = iosJob.indexOf("name: Build for iOS Simulator");

  assert.ok(e2e >= 0 && e2e < timingUpload);
  assert.ok(timingUpload >= 0 && timingUpload < timingPath && timingPath < build);
  assert.match(iosJob.slice(timingUpload, build), /if: success\(\)/);
  assert.match(iosJob.slice(timingUpload, build), /if-no-files-found: error/);
});

test("CI verifies the generated Safari package after the simulator build", () => {
  const build = iosJob.indexOf("name: Build for iOS Simulator");
  const packageRuntime = iosJob.indexOf("run: READER_REQUIRE_IOS_EXTENSION_BUNDLE=1 mise run test:safari-package-runtime");
  const diagnostics = iosJob.indexOf("name: Upload browser diagnostics");

  assert.ok(iosJobStart >= 0);
  assert.ok(build >= 0 && build < packageRuntime && packageRuntime < diagnostics);
});
