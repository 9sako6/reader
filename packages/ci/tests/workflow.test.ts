export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");
const chromiumJobStart = workflow.indexOf("\n  e2e:\n");
const iosJobStart = workflow.indexOf("\n  ios:\n", chromiumJobStart);
const chromiumJob = workflow.slice(chromiumJobStart, iosJobStart);

test("CI uploads the performance baseline before Chromium E2E can clear test-results", () => {
  const measure = chromiumJob.indexOf("run: mise run measure:performance");
  const upload = chromiumJob.indexOf("name: Upload reader performance baseline");
  const uploadPath = chromiumJob.indexOf("path: test-results/performance/reader.json", upload);
  const e2e = chromiumJob.indexOf("run: mise run test:e2e -- --project=chromium");
  const diagnostics = chromiumJob.indexOf("name: Upload browser diagnostics");

  assert.ok(chromiumJobStart >= 0);
  assert.ok(iosJobStart > chromiumJobStart);
  assert.ok(measure >= 0 && measure < upload);
  assert.ok(upload >= 0 && upload < uploadPath && uploadPath < e2e);
  assert.ok(e2e >= 0 && e2e < diagnostics);
});
