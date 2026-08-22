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
const wasm = wasmBindgen.initSync({ module: bytes });
const initializationMilliseconds = performance.now() - initializationStartedAt;
const tapStartedAt = performance.now();
let state = wasm.reader_session_create();
state = wasm.reader_session_dispatch(state, JSON.stringify({ type: "open", requestId: "measurement" }));
state = wasm.reader_session_dispatch(state, JSON.stringify({
  type: "prepareSucceeded",
  requestId: "measurement",
  flow: {
    textLength: 8,
    units: [{ text: "計測。", sentenceIndex: 0, kind: "body", start: 0, end: 3, durationMs: 1 }],
    figures: [],
    flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
    timingProfile: {},
  },
}));
const tapToFirstUnitMilliseconds = performance.now() - tapStartedAt;
const maximumBytes = 450_000;

if (bytes.byteLength > maximumBytes) {
  throw new Error(`ReaderSession WASM is ${bytes.byteLength} bytes; maximum is ${maximumBytes}`);
}

console.log(JSON.stringify({
  artifact: "reader_session_bg.wasm",
  bytes: bytes.byteLength,
  gzipBytes: gzipSync(bytes).byteLength,
  compileMilliseconds: Number(compileMilliseconds.toFixed(2)),
  initializationMilliseconds: Number(initializationMilliseconds.toFixed(2)),
  tapToFirstUnitMilliseconds: Number(tapToFirstUnitMilliseconds.toFixed(2)),
}));
