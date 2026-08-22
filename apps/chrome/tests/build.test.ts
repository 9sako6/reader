export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Chrome build contains the shared pipeline and only the desktop viewer", () => {
  const output = path.join(__dirname, "..", "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "reader");
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["reader_session_bg.wasm"],
    matches: ["<all_urls>"],
  }]);
  assert.equal(fs.existsSync(path.join(output, "engine.js")), true);
  assert.equal(fs.existsSync(path.join(output, "extractor.js")), true);
  assert.equal(fs.existsSync(path.join(output, "icons.js")), true);
  assert.equal(fs.existsSync(path.join(output, "viewer.js")), true);
  assert.equal(fs.existsSync(path.join(output, "service-worker.js")), true);
  assert.equal(fs.existsSync(path.join(output, "session.js")), true);
  assert.equal(fs.existsSync(path.join(output, "session-wasm.js")), true);
  assert.equal(fs.existsSync(path.join(output, "reader_session_bg.wasm")), true);
  assert.equal(fs.existsSync(path.join(output, "LICENSES", "reader-session-dependencies.txt")), true);
  assert.equal(fs.existsSync(path.join(output, "vendor", "defuddle", "defuddle.js")), true);
  assert.equal(fs.existsSync(path.join(output, "mobile-viewer.js")), false);
});
