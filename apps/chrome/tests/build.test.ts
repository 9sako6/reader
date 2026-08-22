export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Chrome build contains the shared pipeline and only the desktop viewer", () => {
  const output = path.join(__dirname, "..", "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "reader");
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(manifest.host_permissions, undefined);
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
  const session = fs.readFileSync(path.join(output, "session.js"), "utf8");
  assert.equal(session.includes("require("), false);
  assert.match(session, /ReaderReactViewer/u);
  assert.match(session, /createRoot/u);
  const noticePath = path.join(output, "LICENSES", "reader-session-dependencies.txt");
  assert.equal(fs.existsSync(noticePath), true);
  const notice = fs.readFileSync(noticePath, "utf8");
  for (const packageName of ["react@19.2.8", "react-dom@19.2.8", "scheduler@0.27.0", "esbuild@0.28.2"]) {
    assert.match(notice, new RegExp(`${packageName.replace(/[.]/gu, "\\.")}\\nDeclared license: MIT`, "u"));
  }
  assert.match(notice, /Permission is hereby granted, free of charge/u);
  assert.equal(fs.existsSync(path.join(output, "vendor", "defuddle", "defuddle.js")), true);
  assert.equal(fs.existsSync(path.join(output, "mobile-viewer.js")), false);
});
