export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");
const chromiumJobStart = workflow.indexOf("\n  e2e:\n");
const iosJobStart = workflow.indexOf("\n  ios:\n", chromiumJobStart);
const chromiumJob = workflow.slice(chromiumJobStart, iosJobStart);
const iosJob = workflow.slice(iosJobStart);

test("CI uploads the performance baseline before Chromium E2E can clear test-results", () => {
  const baselineBuild = chromiumJob.indexOf("name: Build main performance baseline");
  const measure = chromiumJob.indexOf("run: READER_PERFORMANCE_ENFORCE=1 mise run measure:performance");
  const upload = chromiumJob.indexOf("name: Upload reader performance baseline");
  const uploadPath = chromiumJob.indexOf("path: test-results/performance/reader.json", upload);
  const e2e = chromiumJob.indexOf("run: mise run test:e2e -- --project=chromium");
  const extensionSmoke = chromiumJob.indexOf("run: mise run test:chrome-extension");
  const timingUpload = chromiumJob.indexOf("name: Upload Chromium reader timing reports");
  const timingPath = chromiumJob.indexOf("path: test-results/timing/*.json", timingUpload);
  const diagnostics = chromiumJob.indexOf("name: Upload browser diagnostics");

  assert.ok(chromiumJobStart >= 0);
  assert.ok(iosJobStart > chromiumJobStart);
  assert.ok(baselineBuild >= 0 && baselineBuild < measure);
  assert.match(chromiumJob.slice(baselineBuild, measure), /READER_PERFORMANCE_BASELINE_ROOT=/);
  assert.match(chromiumJob.slice(baselineBuild, measure), /READER_PERFORMANCE_BASE_COMMIT=/);
  assert.match(chromiumJob.slice(baselineBuild, measure), /rustfmt,clippy --target wasm32-unknown-unknown/);
  assert.match(chromiumJob.slice(baselineBuild, measure), /rustup override set 1\.97\.1/);
  assert.ok(measure >= 0 && measure < upload);
  assert.ok(upload >= 0 && upload < uploadPath && uploadPath < e2e);
  assert.ok(e2e >= 0 && e2e < extensionSmoke && extensionSmoke < timingUpload);
  assert.ok(timingUpload >= 0 && timingUpload < timingPath && timingPath < diagnostics);
  assert.match(chromiumJob.slice(timingUpload, diagnostics), /if: success\(\)/);
  assert.match(chromiumJob.slice(timingUpload, diagnostics), /if-no-files-found: error/);
  assert.match(chromiumJob, /git worktree remove --force/);
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
