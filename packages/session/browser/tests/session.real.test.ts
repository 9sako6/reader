export {};

import { readFileSync } from "node:fs";

const assert = require("node:assert/strict");

test("browser facade drives the generated Rust WASM session through intent commands", async () => {
  const glue = readFileSync(".build/session-wasm/reader_session.js", "utf8");
  const bytes = readFileSync(".build/session-wasm/reader_session_bg.wasm");
  const wasmBindgen = new Function(`${glue}; return wasm_bindgen;`)();
  wasmBindgen.initSync({ module: bytes });
  const modulePath = require.resolve("../../../../.build/packages/session/browser/session.js");
  delete require.cache[modulePath];
  const previousRuntime = globalThis.ReaderSessionWasm;
  try {
    globalThis.ReaderSessionWasm = wasmBindgen;
    const ReaderSession = require(modulePath);
    const handle = ReaderSession.create();
    await handle.ready;
    assert.deepEqual(handle.state, { phase: "idle", generation: 0 });

    handle.dispatch({ type: "open", requestId: "real" });
    handle.dispatch({
      type: "prepareSucceeded",
      requestId: "real",
      flow: {
        textLength: 4,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 4, durationMs: 1 }],
        figures: [],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    assert.equal(handle.state.phase, "reading");
    assert.equal(handle.state.currentKind, "unit");
    assert.equal(JSON.stringify(handle.state).includes("contentPresent"), false);
    handle.dispatch({ type: "close" });
    handle.destroy();

    const invalid = ReaderSession.create();
    await invalid.ready;
    invalid.dispatch({ type: "open", requestId: "invalid" });
    invalid.dispatch({
      type: "prepareSucceeded",
      requestId: "invalid",
      flow: {
        textLength: 4,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 4, durationMs: 1 }],
        figures: [{ sourceOffset: 2, sourceEnd: 2 }],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    assert.deepEqual(invalid.state, {
      phase: "error",
      generation: 2,
      requestId: "invalid",
      reason: "invalid_flow",
    });
    invalid.destroy();
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
    delete require.cache[modulePath];
  }
});
