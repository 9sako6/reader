const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const output = path.join(root, "apps", "chrome", "dist");
const files = [
  ["apps/chrome/manifest.json", "manifest.json"],
  [".build/apps/chrome/src/service-worker.js", "service-worker.js"],
  [".build/apps/chrome/src/viewer/viewer.js", "viewer.js"],
  [".build/packages/engine/src/engine.js", "engine.js"],
  [".build/packages/extractor/src/extractor.js", "extractor.js"],
  ["node_modules/defuddle/dist/index.js", "vendor/defuddle/defuddle.js"],
  ["node_modules/defuddle/LICENSE", "vendor/defuddle/LICENSE"],
  ["LICENSES/lucide.txt", "LICENSES/lucide.txt"],
];

fs.rmSync(output, { recursive: true, force: true });
for (const [source, destination] of files) {
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, source), target);
}
