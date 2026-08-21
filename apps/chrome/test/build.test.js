const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Chrome build contains the shared pipeline and only the desktop viewer", () => {
  const output = path.join(__dirname, "..", "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.background.service_worker, "service-worker.js");
  for (const file of ["engine.js", "extractor.js", "viewer.js", "service-worker.js"]) {
    assert.equal(fs.existsSync(path.join(output, file)), true);
  }
  assert.equal(fs.existsSync(path.join(output, "vendor", "defuddle", "defuddle.js")), true);
  assert.equal(fs.existsSync(path.join(output, "mobile-viewer.js")), false);
});
