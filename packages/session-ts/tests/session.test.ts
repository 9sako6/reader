export {};

const assert = require("node:assert/strict");
const ReaderSession = require("../../../.build/packages/session-ts/src/session.js");

test("WASM wrapper forwards create and reducer commands without retaining content after close", async () => {
  const calls: Array<{ state: string; action: string }> = [];
  let nextState: any = { phase: "idle", generation: 0 };
  const previousRuntime = globalThis.ReaderSessionWasm;
  globalThis.ReaderSessionWasm = {
    reader_session_create() {
      return JSON.stringify(nextState);
    },
    reader_session_dispatch(state, action) {
      calls.push({ state, action });
      const parsed = JSON.parse(state);
      const command = JSON.parse(action);
      nextState = command.type === "close"
        ? { phase: "ended", generation: parsed.generation + 1 }
        : { ...parsed, phase: "reading", generation: parsed.generation + 1 };
      return JSON.stringify({ state: nextState, effects: [] });
    },
  };
  await ReaderSession.init();
  const state = ReaderSession.create({ textLength: 1, units: [], figures: [], flow: [] });
  const closed = ReaderSession.reduce(state, { type: "close" }).state;
  assert.equal(closed.phase, "ended");
  assert.equal(calls[0].action.includes('"open"'), true);
  assert.equal(calls[1].action.includes('"prepareSucceeded"'), true);
  assert.equal(calls[2].action.includes('"close"'), true);
  globalThis.ReaderSessionWasm = previousRuntime;
});
