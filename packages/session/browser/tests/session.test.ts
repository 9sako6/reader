export {};

import type { ReaderSessionState } from "../types";

const assert = require("node:assert/strict");
const modulePath = "../../../../.build/packages/session/browser/session.js";

function observable(phase = "idle", generation = 0, requestId = "") {
  return {
    phase,
    mode: "rsvp",
    playback: "paused",
    flowIndex: 0,
    flowLength: phase === "reading" ? 1 : 0,
    generation,
    sourceOffset: 0,
    currentKind: phase === "reading" ? "unit" : "none",
    requestId,
    timerPending: false,
    contentPresent: phase === "reading",
    position: phase === "reading" ? { kind: "text", sourceOffset: 0 } : null,
    unitIndex: phase === "reading" ? 0 : null,
    figureIndex: null,
    reason: null,
  };
}

function fakeRuntime(calls: string[], states: Map<number, any>) {
  return {
    reader_session_create() {
      const handle = states.has(0) ? 1 : 0;
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
      const next = command.type === "open"
        ? observable("preparing", previous.generation + 1, command.requestId)
        : command.type === "prepareSucceeded"
          ? observable("reading", previous.generation + 1, command.requestId)
          : command.type === "close"
            ? observable("ended", previous.generation + 1)
            : { ...previous, generation: previous.generation + 1 };
      states.set(handle, next);
      return JSON.stringify({ state: next, effects: [] });
    },
    reader_session_destroy(handle) {
      states.delete(handle);
    },
  };
}

test("browser facade queues commands, exposes valid phase states, and destroys its WASM handle", async () => {
  const calls: string[] = [];
  const states = new Map<number, any>();
  const previousRuntime = globalThis.ReaderSessionWasm;
  try {
    globalThis.ReaderSessionWasm = fakeRuntime(calls, states);
    const ReaderSession = require(modulePath);
    const observed: ReaderSessionState[] = [];
    const handle = ReaderSession.create((state) => observed.push(state));
    handle.dispatch({ type: "open", requestId: "A" });
    handle.dispatch({
      type: "prepareSucceeded",
      requestId: "A",
      flow: {
        textLength: 1_000_000,
        units: [{ sentenceIndex: 0, kind: "body", start: 0, end: 1_000_000, durationMs: 10 }],
        figures: [],
        flow: [{ kind: "unit", sourceOffset: 0, unitIndex: 0 }],
      },
    });
    await handle.ready;

    assert.equal(handle.state.phase, "reading");
    assert.equal(handle.state.currentKind, "unit");
    assert.equal(JSON.stringify(handle.state).includes("contentPresent"), false);
    assert.ok(JSON.stringify(calls[1]).length > 128);
    assert.deepEqual(observed.map(({ phase }) => phase), ["idle", "preparing", "reading"]);

    handle.dispatch({ type: "close" });
    assert.equal(handle.state.phase, "ended");
    handle.destroy();
    assert.equal(handle.state, null);
    assert.equal(states.size, 0);
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
    delete require.cache[require.resolve(modulePath)];
  }
});

test("a failed lazy initialization is retryable", async () => {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
  const previousRuntime = globalThis.ReaderSessionWasm;
  const previousGlue = globalThis.wasm_bindgen;
  try {
    globalThis.ReaderSessionWasm = undefined;
    globalThis.wasm_bindgen = async () => {
      throw new Error("fetch failed");
    };
    const ReaderSession = require(resolvedPath);
    await assert.rejects(ReaderSession.create().ready, /fetch failed/);

    const calls: string[] = [];
    const states = new Map<number, any>();
    globalThis.ReaderSessionWasm = fakeRuntime(calls, states);
    const handle = ReaderSession.create();
    handle.dispatch({ type: "open", requestId: "B" });
    await handle.ready;
    assert.equal(handle.state.phase, "preparing");
    handle.destroy();
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
    globalThis.wasm_bindgen = previousGlue;
    delete require.cache[resolvedPath];
  }
});

test("browser facade resolves the Safari extension WASM resource", async () => {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
  const scope = globalThis as typeof globalThis & { chrome?: unknown; browser?: unknown };
  const previousRuntime = globalThis.ReaderSessionWasm;
  const previousGlue = globalThis.wasm_bindgen;
  const previousChrome = scope.chrome;
  const previousBrowser = scope.browser;
  const previousFetch = globalThis.fetch;
  let fetchedUrl = "";
  try {
    globalThis.ReaderSessionWasm = undefined;
    scope.chrome = { runtime: { getURL: (path: string) => `safari-web-extension://reader/${path}` } };
    scope.browser = undefined;
    globalThis.fetch = async (input) => {
      fetchedUrl = String(input);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    };
    globalThis.wasm_bindgen = Object.assign(async () => undefined, fakeRuntime([], new Map()));

    const ReaderSession = require(resolvedPath);
    const handle = ReaderSession.create();
    await handle.ready;
    assert.equal(fetchedUrl, "safari-web-extension://reader/reader_session_bg.wasm");
    assert.equal(handle.state.phase, "idle");
    handle.destroy();
  } finally {
    globalThis.ReaderSessionWasm = previousRuntime;
    globalThis.wasm_bindgen = previousGlue;
    scope.chrome = previousChrome;
    scope.browser = previousBrowser;
    globalThis.fetch = previousFetch;
    delete require.cache[resolvedPath];
  }
});
