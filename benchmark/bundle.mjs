import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(repositoryRoot, "test-results/performance/bundle.json");
const assets = {
  "runtime.js": {
    chrome: "apps/chrome/dist/runtime.js",
    safari: "apps/ios/ReaderExtension/Resources/generated/runtime.js",
  },
  "session-wasm.js": {
    chrome: "apps/chrome/dist/session-wasm.js",
    safari: "apps/ios/ReaderExtension/Resources/generated/session-wasm.js",
  },
  "reader_session_bg.wasm": {
    chrome: "apps/chrome/dist/reader_session_bg.wasm",
    safari: "apps/ios/ReaderExtension/Resources/generated/reader_session_bg.wasm",
  },
  "defuddle.js": {
    chrome: "apps/chrome/dist/vendor/defuddle/defuddle.js",
    safari: "apps/ios/ReaderExtension/Resources/generated/defuddle.js",
  },
  "bootstrap.js": {
    chrome: null,
    safari: "apps/ios/ReaderExtension/Resources/generated/bootstrap.js",
  },
};

async function assetSize(relativePath) {
  if (!relativePath) return null;
  const metadata = await stat(resolve(repositoryRoot, relativePath));
  return metadata.size;
}

const reportAssets = {};
let chromeBytes = 0;
let safariBytes = 0;
for (const [name, paths] of Object.entries(assets)) {
  const chrome = await assetSize(paths.chrome);
  const safari = await assetSize(paths.safari);
  reportAssets[name] = { chromeBytes: chrome, safariBytes: safari };
  chromeBytes += chrome || 0;
  safariBytes += safari || 0;
}

const report = {
  assets: reportAssets,
  totals: {
    chromeBytes,
    safariBytes,
    bytes: chromeBytes + safariBytes,
  },
};
await mkdir(resolve(repositoryRoot, "test-results/performance"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
