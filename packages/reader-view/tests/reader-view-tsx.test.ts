export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourceDirectory = path.resolve(__dirname, "../src");
const buildScript = fs.readFileSync(path.resolve(__dirname, "../../../scripts/build-reader-view.mjs"), "utf8");

test("ReaderView is authored as standard TSX without a createElement renderer", () => {
  const viewPath = path.join(sourceDirectory, "reader-view.tsx");
  const entryPath = path.join(sourceDirectory, "reader-view-entry.tsx");

  assert.equal(fs.existsSync(viewPath), true);
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(fs.existsSync(path.join(sourceDirectory, "reader-view.ts")), false);
  assert.equal(fs.existsSync(path.join(sourceDirectory, "reader-view-entry.ts")), false);

  const viewSource = fs.readFileSync(viewPath, "utf8");
  const entrySource = fs.readFileSync(entryPath, "utf8");

  assert.match(viewSource, /<section\b/u);
  assert.doesNotMatch(viewSource, /\bcreateElement\b/u);
  assert.doesNotMatch(entrySource, /\bcreateElement\b/u);
  assert.match(buildScript, /reader-view-entry\.tsx/u);
});
