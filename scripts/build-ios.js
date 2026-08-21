const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const output = path.join(root, "apps", "ios", "ReaderExtension", "Resources", "generated");
const files = [
  ["node_modules/defuddle/dist/index.js", "defuddle.js"],
  [".build/packages/engine/src/engine.js", "engine.js"],
  [".build/packages/extractor/src/extractor.js", "extractor.js"],
  [".build/apps/ios/ReaderExtension/Resources/viewer/icons.js", "icons.js"],
  [".build/apps/ios/ReaderExtension/Resources/viewer/viewer.js", "viewer.js"],
  [".build/apps/ios/ReaderExtension/Resources/viewer/bootstrap.js", "bootstrap.js"],
  ["node_modules/defuddle/LICENSE", "defuddle-LICENSE.txt"],
  ["LICENSES/lucide.txt", "lucide-LICENSE.txt"],
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const [source, destination] of files) {
  fs.copyFileSync(path.join(root, source), path.join(output, destination));
}
