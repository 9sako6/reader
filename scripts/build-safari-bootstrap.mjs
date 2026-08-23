import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const runtimePath = resolve(repositoryRoot, ".build/apps/ios/ReaderExtension/Resources/viewer/lazy-runtime.js");
const outputPath = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated/bootstrap.js");
const runtime = await readFile(runtimePath, "utf8");
const compile = promisify(execFile);
await compile("pnpm", [
  "exec",
  "tsc",
  "--ignoreConfig",
  "--target",
  "ES2022",
  "--module",
  "ES2022",
  "--types",
  "chrome",
  "--lib",
  "ES2022,DOM,DOM.Iterable",
  "--strict",
  "--skipLibCheck",
  "--rootDir",
  ".",
  "--outDir",
  ".build/safari-bootstrap",
  "apps/ios/ReaderExtension/Resources/viewer/bootstrap.ts",
  "apps/ios/ReaderExtension/Resources/viewer/globals.d.ts",
  "packages/session/browser/contracts.d.ts",
  "packages/extractor/src/contracts.d.ts",
], { cwd: repositoryRoot });
const bootstrap = await readFile(
  resolve(repositoryRoot, ".build/safari-bootstrap/apps/ios/ReaderExtension/Resources/viewer/bootstrap.js"),
  "utf8",
);

await writeFile(
  outputPath,
  `(function installReaderLazyRuntime() {\n  const module = { exports: {} };\n  const exports = module.exports;\n${runtime}\n  globalThis.ReaderLazyRuntime = module.exports;\n})();\n${bootstrap}\n`,
);
