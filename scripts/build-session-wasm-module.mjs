import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(repositoryRoot, ".build/session-wasm/reader_session.js");
const outputPath = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated/session-wasm-module.js");
const source = await readFile(sourcePath, "utf8");

await writeFile(
  outputPath,
  `${source}\n\nglobalThis.wasm_bindgen = wasm_bindgen;\nexport { wasm_bindgen };\n`,
);
