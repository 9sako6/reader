export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(
  path.resolve(__dirname, "../../.github/workflows/platform.yml"),
  "utf8",
);

function jobBlock(jobName) {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  assert.ok(start >= 0, `${jobName} job must exist`);
  const nextJob = jobName === "e2e" ? "ios" : null;
  const next = nextJob === null ? -1 : workflow.indexOf(`\n  ${nextJob}:\n`, start + 3);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function topLevelEventKeys(source) {
  const onStart = source.indexOf("\non:\n");
  const permissionsStart = source.indexOf("\npermissions:\n", onStart);
  assert.ok(onStart >= 0, "workflow must define top-level on");
  assert.ok(permissionsStart > onStart, "workflow event block must precede permissions");
  return [...source.slice(onStart, permissionsStart).matchAll(/^  ([a-z][a-z0-9_-]*):$/gmu)]
    .map((match) => match[1]);
}

test("platform workflow runs only on a daily schedule or manual dispatch and checks out main", () => {
  assert.deepEqual(topLevelEventKeys(workflow), ["schedule", "workflow_dispatch"]);
  assert.match(workflow, /\n    - cron: "[^"]+"/);
  assert.match(jobBlock("e2e"), /ref: main/);
  assert.match(jobBlock("ios"), /ref: main/);
});

test("platform workflow preserves Chromium E2E, Chrome smoke, timing artifact, and timeout", () => {
  const e2e = jobBlock("e2e");
  assert.match(e2e, /name: Chromium viewer E2E/);
  assert.match(e2e, /runs-on: macos-15/);
  assert.match(e2e, /timeout-minutes: 30/);
  assert.match(e2e, /pnpm exec playwright install chromium/);
  assert.match(e2e, /mise run test:e2e -- --project=chromium/);
  assert.match(e2e, /mise run test:chrome-extension/);
  assert.match(e2e, /name: Upload Chromium reader timing reports/);
  assert.match(e2e, /path: test-results\/timing\/\*\.json/);
  assert.match(e2e, /name: chromium-reader-timing/);
  assert.match(e2e, /if: success\(\)/);
  assert.match(e2e, /if-no-files-found: error/);
  assert.match(e2e, /name: Upload browser diagnostics/);

  const chromiumE2e = e2e.indexOf("run: mise run test:e2e -- --project=chromium");
  const chromeSmoke = e2e.indexOf("run: mise run test:chrome-extension");
  const timingUpload = e2e.indexOf("name: Upload Chromium reader timing reports");
  const diagnostics = e2e.indexOf("name: Upload browser diagnostics");
  assert.ok(chromiumE2e >= 0 && chromiumE2e < chromeSmoke && chromeSmoke < timingUpload && timingUpload < diagnostics);
});

test("platform workflow preserves WebKit E2E, iOS build, Safari smoke, artifacts, and timeout", () => {
  const ios = jobBlock("ios");
  assert.match(ios, /name: iOS build and WebKit viewer E2E/);
  assert.match(ios, /runs-on: macos-15/);
  assert.match(ios, /timeout-minutes: 20/);
  assert.match(ios, /pnpm exec playwright install webkit/);
  assert.match(ios, /mise run test:e2e -- --project=webkit/);
  assert.match(ios, /name: Upload WebKit reader timing reports/);
  assert.match(ios, /path: test-results\/timing\/\*\.json/);
  assert.match(ios, /name: webkit-reader-timing/);
  assert.match(ios, /xcodebuild[\s\S]*CODE_SIGNING_ALLOWED=NO[\s\S]*build/);
  assert.match(ios, /run: READER_REQUIRE_IOS_EXTENSION_BUNDLE=1 mise run test:safari-package-runtime/);
  assert.match(ios, /name: Upload browser diagnostics/);

  const webkitE2e = ios.indexOf("run: mise run test:e2e -- --project=webkit");
  const timingUpload = ios.indexOf("name: Upload WebKit reader timing reports");
  const build = ios.indexOf("name: Build for iOS Simulator");
  const safariSmoke = ios.indexOf("name: Verify generated Safari package runtime");
  const diagnostics = ios.indexOf("name: Upload browser diagnostics");
  assert.ok(webkitE2e >= 0 && webkitE2e < timingUpload && timingUpload < build && build < safariSmoke && safariSmoke < diagnostics);
});
