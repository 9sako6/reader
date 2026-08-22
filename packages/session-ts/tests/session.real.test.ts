export {};

import { readFileSync } from "node:fs";

const assert = require("node:assert/strict");

test("wrapper drives the generated Rust WASM handle without a state payload", async () => {
  const glue = readFileSync(".build/session-wasm/reader_session.js", "utf8");
  const bytes = readFileSync(".build/session-wasm/reader_session_bg.wasm");
  const wasmBindgen = new Function(`${glue}; return wasm_bindgen;`)();
  wasmBindgen.initSync({ module: bytes });
  const modulePath = require.resolve("../../../.build/packages/session-ts/src/session.js");
  delete require.cache[modulePath];
  const previousRuntime = globalThis.ReaderSessionWasm;
  try {
    globalThis.ReaderSessionWasm = wasmBindgen;
    const ReaderSession = require(modulePath);
    await ReaderSession.init();
    const handle = ReaderSession.create();
    const observableKeys = [
      "contentPresent",
      "currentKind",
      "figureIndex",
      "flowIndex",
      "flowLength",
      "generation",
      "mode",
      "phase",
      "playback",
      "position",
      "reason",
      "requestId",
      "sourceOffset",
      "timerPending",
      "unitIndex",
    ];
    assert.deepEqual(Object.keys(handle.state).sort(), observableKeys);
    assert.equal(handle.state.currentKind, "none");
    assert.equal(handle.state.position, null);
    assert.equal(handle.state.unitIndex, null);
    assert.equal(handle.state.figureIndex, null);
    assert.equal(handle.state.reason, null);
    ReaderSession.dispatch(handle, { type: "open", requestId: "real" });
    const transition = ReaderSession.dispatch(handle, {
      type: "prepareSucceeded",
      requestId: "real",
      flow: {
        textLength: 4,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 4, durationMs: 1 }],
        figures: [],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    assert.equal(transition.state.phase, "reading");
    assert.equal(transition.state.currentKind, "unit");
    assert.equal(transition.state.figureIndex, null);
    assert.equal(transition.state.reason, null);
    assert.deepEqual(Object.keys(transition.state).sort(), observableKeys);
    assert.equal(JSON.stringify(transition).includes("units"), false);
    const tick = ReaderSession.dispatch(handle, { type: "tick", generation: transition.state.generation });
    assert.equal(JSON.stringify(tick).includes("textLength"), false);
    ReaderSession.dispatch(handle, { type: "close" });
    ReaderSession.destroy(handle);

    const invalid = ReaderSession.create();
    ReaderSession.dispatch(invalid, { type: "open", requestId: "invalid" });
    const invalidTransition = ReaderSession.dispatch(invalid, {
      type: "prepareSucceeded",
      requestId: "invalid",
      flow: {
        textLength: 4,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 4, durationMs: 1 }],
        figures: [{ sourceOffset: 2, sourceEnd: 2 }],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    assert.equal(invalidTransition.state.phase, "error");
    assert.equal(invalidTransition.state.currentKind, "none");
    assert.equal(invalidTransition.state.reason, "invalid_flow");
    assert.equal(invalidTransition.state.position, null);
    assert.equal(invalidTransition.state.unitIndex, null);
    assert.equal(invalidTransition.state.figureIndex, null);
    ReaderSession.destroy(invalid);
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
  }
});
