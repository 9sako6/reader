import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const artifactPath = ".build/session-wasm/reader_session_bg.wasm";
const bytes = await readFile(artifactPath);
const startedAt = performance.now();
await WebAssembly.compile(bytes);
const compileMilliseconds = performance.now() - startedAt;
const glue = await readFile(".build/session-wasm/reader_session.js", "utf8");
const glueUrl = `data:text/javascript;base64,${Buffer.from(glue).toString("base64")}`;
const { ReaderSession, initSync } = await import(glueUrl);
const initializationStartedAt = performance.now();
initSync({ module: bytes });
const initializationMilliseconds = performance.now() - initializationStartedAt;
const dispatchStartedAt = performance.now();
const session = new ReaderSession();
session.dispatch(JSON.stringify({ type: "open", requestId: "measurement" }));
session.dispatch(JSON.stringify({
  type: "prepareSucceeded",
  requestId: "measurement",
  flow: {
    textLength: 8,
    spots: [{ sentenceIndex: 0, kind: "body", start: 0, end: 3, durationMs: 1 }],
    figures: [],
    flow: [{ kind: "spot", sourceOffset: 0, spotIndex: 0 }],
  },
}));
const dispatchMilliseconds = performance.now() - dispatchStartedAt;
session.free();

console.log(JSON.stringify({
  artifact: "reader_session_bg.wasm",
  bytes: bytes.byteLength,
  gzipBytes: gzipSync(bytes).byteLength,
  compileMilliseconds: Number(compileMilliseconds.toFixed(2)),
  initializationMilliseconds: Number(initializationMilliseconds.toFixed(2)),
  dispatchMilliseconds: Number(dispatchMilliseconds.toFixed(2)),
}));
