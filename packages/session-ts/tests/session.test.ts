export {};

const assert = require("node:assert/strict");
const ReaderSession = require("../../../.build/packages/session-ts/src/session.js");

function observable(phase = "idle", generation = 0) {
  return {
    phase,
    mode: "rsvp",
    playback: "paused",
    flowIndex: 0,
    flowLength: 0,
    generation,
    sourceOffset: 0,
    currentKind: "none",
    requestId: "",
    timerPending: false,
    contentPresent: false,
  };
}

test("WASM wrapper dispatches compact commands and destroys a closed handle", async () => {
  const calls: string[] = [];
  const states = new Map<number, any>();
  const previousRuntime = globalThis.ReaderSessionWasm;
  try {
    globalThis.ReaderSessionWasm = {
      reader_session_create() {
        const handle = states.size === 0 ? 1 : 2;
        states.set(handle, observable());
        return handle;
      },
      reader_session_observable(handle) {
        return JSON.stringify(states.get(handle));
      },
      reader_session_dispatch(handle, commandJson) {
        calls.push(commandJson);
        const command = JSON.parse(commandJson);
        const previous = states.get(handle);
        const next = command.type === "close"
          ? observable("ended", previous.generation + 1)
          : { ...previous, phase: command.type === "prepareSucceeded" ? "reading" : previous.phase, generation: previous.generation + 1 };
        states.set(handle, next);
        return JSON.stringify({ state: next, effects: [] });
      },
      reader_session_destroy(handle) {
        states.delete(handle);
      },
    };
    await ReaderSession.init();
    const handle = ReaderSession.create();
    ReaderSession.dispatch(handle, { type: "open", requestId: "A" });
    ReaderSession.dispatch(handle, {
      type: "prepareSucceeded",
      requestId: "A",
      flow: {
        textLength: 1_000_000,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 1_000_000, durationMs: 10 }],
        figures: [{ sourceOffset: 2, sourceEnd: 2 }],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    const tick = ReaderSession.dispatch(handle, { type: "tick", generation: 2 });
    assert.equal(JSON.stringify(tick).includes("units"), false);
    assert.equal(JSON.stringify(tick).includes("figures"), false);
    assert.equal(JSON.stringify(tick).includes("text"), false);
    assert.ok(JSON.stringify(calls[2]).length < 128);
    const beforeClose = handle.state;
    ReaderSession.dispatch(handle, { type: "close" });
    assert.equal(handle.state.phase, "ended");
    ReaderSession.destroy(handle);
    assert.equal(handle.destroyed, true);
    assert.deepEqual(beforeClose.phase, "reading");
    assert.throws(() => ReaderSession.dispatch(handle, { type: "play" }));
    const replacement = ReaderSession.create();
    assert.equal(replacement.id, handle.id);
    ReaderSession.destroy(replacement);
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
  }
});

test("a failed initialization is retryable after the latest request wins", async () => {
  const modulePath = require.resolve("../../../.build/packages/session-ts/src/session.js");
  delete require.cache[modulePath];
  const previousRuntime = globalThis.ReaderSessionWasm;
  const previousGlue = globalThis.wasm_bindgen;
  try {
    globalThis.ReaderSessionWasm = undefined;
    globalThis.wasm_bindgen = async () => {
      throw new Error("fetch failed");
    };
    const ReaderSession = require(modulePath);
    await assert.rejects(ReaderSession.init(), /fetch failed/);
    globalThis.ReaderSessionWasm = {
      reader_session_create: () => 0,
      reader_session_observable: () => JSON.stringify(observable()),
      reader_session_dispatch: (_handle, commandJson) => JSON.stringify({
        state: { ...observable(), phase: JSON.parse(commandJson).type === "open" ? "preparing" : "idle" },
        effects: [],
      }),
      reader_session_destroy: () => undefined,
    };
    await ReaderSession.init();
    const handle = ReaderSession.create();
    ReaderSession.dispatch(handle, { type: "open", requestId: "B" });
    assert.equal(handle.state.phase, "preparing");
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
    globalThis.wasm_bindgen = previousGlue;
  }
});
