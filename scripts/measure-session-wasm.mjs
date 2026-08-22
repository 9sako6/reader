import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const artifactPath = ".build/session-wasm/reader_session_bg.wasm";
const bytes = await readFile(artifactPath);
const startedAt = performance.now();
await WebAssembly.compile(bytes);
const compileMilliseconds = performance.now() - startedAt;
const maximumBytes = 450_000;

if (bytes.byteLength > maximumBytes) {
  throw new Error(`ReaderSession WASM is ${bytes.byteLength} bytes; maximum is ${maximumBytes}`);
}

console.log(JSON.stringify({
  artifact: "reader_session_bg.wasm",
  bytes: bytes.byteLength,
  compileMilliseconds: Number(compileMilliseconds.toFixed(2)),
}));
