export {};

import type { ReaderSessionState } from "../../../packages/session/browser/types";

const assert = require("node:assert/strict");
const modulePath = "../../../.build/apps/chrome/src/session-client.js";

function createPort() {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  return {
    posted,
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener(listener: () => void) {
        disconnectListeners.push(listener);
      },
    },
    postMessage(message: unknown) {
      posted.push(message);
    },
    disconnect() {
      for (const listener of disconnectListeners) listener();
    },
    receive(message: unknown) {
      for (const listener of messageListeners) listener(message);
    },
  };
}

test("Chrome Session client owns preparation before the worker responds and suppresses the repeated state", async () => {
  const previousChrome = globalThis.chrome;
  const previousSession = globalThis.ReaderSession;
  const port = createPort();
  try {
    globalThis.chrome = {
      runtime: {
        connect: () => port,
      },
    } as any;
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    const observed: ReaderSessionState[] = [];
    const handle = globalThis.ReaderSession.create((state) => observed.push(state));

    handle.dispatch({ type: "open", requestId: "request-1" });
    assert.deepEqual(handle.state, { phase: "preparing", requestId: "request-1", generation: 1 });
    assert.deepEqual(observed.map(({ phase }) => phase), ["preparing"]);

    port.receive({
      type: "state",
      state: { phase: "idle", generation: 0 },
    });
    assert.deepEqual(handle.state, { phase: "preparing", requestId: "request-1", generation: 1 });
    assert.deepEqual(observed.map(({ phase }) => phase), ["preparing"]);

    port.receive({
      type: "state",
      state: { phase: "preparing", requestId: "request-1", generation: 1 },
    });
    port.receive({ type: "ready" });
    port.receive({
      type: "state",
      state: {
        phase: "reading",
        mode: "rsvp",
        playback: "paused",
        flowIndex: 0,
        flowLength: 1,
        generation: 2,
        sourceOffset: 0,
        currentKind: "unit",
        requestId: "request-1",
        timerPending: false,
        position: { kind: "text", sourceOffset: 0 },
        unitIndex: 0,
        figureIndex: null,
      },
    });

    await handle.ready;
    assert.deepEqual(observed.map(({ phase }) => phase), ["preparing", "reading"]);
    assert.equal(handle.state?.phase, "reading");
    assert.deepEqual(port.posted, [{
      type: "dispatch",
      command: { type: "open", requestId: "request-1" },
    }]);
    handle.destroy();
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.ReaderSession = previousSession;
    delete require.cache[require.resolve(modulePath)];
  }
});

test("Chrome Session client exposes a worker failure as Session error state", async () => {
  const previousChrome = globalThis.chrome;
  const previousSession = globalThis.ReaderSession;
  const port = createPort();
  try {
    globalThis.chrome = {
      runtime: {
        connect: () => port,
      },
    } as any;
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    const observed: ReaderSessionState[] = [];
    const handle = globalThis.ReaderSession.create((state) => observed.push(state));

    handle.dispatch({ type: "open", requestId: "request-2" });
    port.receive({ type: "error", message: "worker failed" });

    await assert.rejects(handle.ready, /worker failed/u);
    assert.deepEqual(handle.state, {
      phase: "error",
      requestId: "request-2",
      reason: "session_unavailable",
      generation: 2,
    });
    assert.deepEqual(observed.map(({ phase }) => phase), ["preparing", "error"]);
    handle.destroy();
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.ReaderSession = previousSession;
    delete require.cache[require.resolve(modulePath)];
  }
});
