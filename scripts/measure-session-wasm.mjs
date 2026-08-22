import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const artifactPath = ".build/session-wasm/reader_session_bg.wasm";
const bytes = await readFile(artifactPath);
const startedAt = performance.now();
await WebAssembly.compile(bytes);
const compileMilliseconds = performance.now() - startedAt;
const glue = await readFile(".build/session-wasm/reader_session.js", "utf8");
const getWasmBindgen = new Function(`${glue}; return wasm_bindgen;`);
const wasmBindgen = getWasmBindgen();
const initializationStartedAt = performance.now();
wasmBindgen.initSync({ module: bytes });
const wasm = wasmBindgen;
const initializationMilliseconds = performance.now() - initializationStartedAt;
const dispatchStartedAt = performance.now();
const handle = wasm.reader_session_create();
wasm.reader_session_dispatch(handle, JSON.stringify({ type: "open", requestId: "measurement" }));
wasm.reader_session_dispatch(handle, JSON.stringify({
  type: "prepareSucceeded",
  requestId: "measurement",
  flow: {
    textLength: 8,
    units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 3, durationMs: 1 }],
    figures: [],
    flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
  },
}));
const dispatchMilliseconds = performance.now() - dispatchStartedAt;
wasm.reader_session_destroy(handle);

console.log(JSON.stringify({
  artifact: "reader_session_bg.wasm",
  bytes: bytes.byteLength,
  gzipBytes: gzipSync(bytes).byteLength,
  compileMilliseconds: Number(compileMilliseconds.toFixed(2)),
  initializationMilliseconds: Number(initializationMilliseconds.toFixed(2)),
  dispatchMilliseconds: Number(dispatchMilliseconds.toFixed(2)),
}));
