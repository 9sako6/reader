export {};

import type { ReaderSessionState } from "../types";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const modulePath = "../../../../.build/packages/session/browser/session.js";

function observable(phase = "idle", generation = 0, requestId = "") {
  return {
    phase,
    mode: "spots",
    playback: "paused",
    flowIndex: 0,
    flowLength: phase === "reading" ? 1 : 0,
    generation,
    sourceOffset: 0,
    currentKind: phase === "reading" ? "spot" : "none",
    requestId,
    timerPending: false,
    contentPresent: phase === "reading",
    position: phase === "reading" ? { kind: "text", sourceOffset: 0 } : null,
    spotIndex: phase === "reading" ? 0 : null,
    figureIndex: null,
    reason: null,
  };
}

function fakeRuntime(calls: string[], states: Map<number, any>) {
  let nextHandle = 0;
  return {
    default: async () => undefined,
    ReaderSession: class {
      private readonly handle = nextHandle++;

      constructor() {
        states.set(this.handle, observable());
      }

      observable() {
        return JSON.stringify(states.get(this.handle));
      }

      dispatch(commandJson: string) {
        calls.push(commandJson);
        const command = JSON.parse(commandJson);
        const previous = states.get(this.handle);
        const next = command.type === "open"
          ? observable("preparing", previous.generation + 1, command.requestId)
          : command.type === "prepareSucceeded"
            ? observable("reading", previous.generation + 1, command.requestId)
            : command.type === "close"
              ? observable("ended", previous.generation + 1)
              : { ...previous, generation: previous.generation + 1 };
        states.set(this.handle, next);
        return JSON.stringify({ state: next, effects: [] });
      }

      free() {
        states.delete(this.handle);
      }
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
        spots: [{ sentenceIndex: 0, kind: "body", start: 0, end: 1_000_000, durationMs: 10 }],
        figures: [],
        flow: [{ kind: "spot", sourceOffset: 0, spotIndex: 0 }],
      },
    });
    await handle.ready;

    assert.equal(handle.state.phase, "reading");
    assert.equal(handle.state.currentKind, "spot");
    assert.equal(JSON.stringify(handle.state).includes("contentPresent"), false);
    assert.ok(JSON.stringify(calls[1]).length > 128);
    assert.deepEqual(observed.map(({ phase }) => phase), ["preparing", "reading"]);

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
  try {
    globalThis.ReaderSessionWasm = {
      default: async () => undefined,
      ReaderSession: class {
        constructor() {
          throw new Error("initialization failed");
        }
      },
    };
    const ReaderSession = require(resolvedPath);
    await assert.rejects(ReaderSession.create().ready, /initialization failed/);

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
    delete require.cache[resolvedPath];
  }
});

test("browser facade lazily resolves the generated glue and WASM through the extension runtime", () => {
  const source = fs.readFileSync("packages/session/browser/session.ts", "utf8");
  assert.match(source, /import\(moduleURL\.href\)/u);
  assert.match(source, /extension\.getURL\("session-wasm\.js"\)/u);
  assert.match(source, /fetch\(extension\.getURL\("reader_session_bg\.wasm"\)\)/u);
});
