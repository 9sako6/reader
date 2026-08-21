const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const output = path.join(root, "apps", "chrome", "dist");
const files = [
  ["apps/chrome/manifest.json", "manifest.json"],
  ["apps/chrome/src/service-worker.js", "service-worker.js"],
  ["apps/chrome/src/viewer/viewer.js", "viewer.js"],
  ["packages/engine/src/engine.js", "engine.js"],
  ["packages/extractor/src/extractor.js", "extractor.js"],
  ["vendor/defuddle/defuddle.js", "vendor/defuddle/defuddle.js"],
  ["vendor/defuddle/LICENSE", "vendor/defuddle/LICENSE"],
  ["vendor/defuddle/SHA256SUMS", "vendor/defuddle/SHA256SUMS"],
];

fs.rmSync(output, { recursive: true, force: true });
for (const [source, destination] of files) {
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, source), target);
}
