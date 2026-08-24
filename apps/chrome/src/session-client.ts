import type { SessionWorkerMessage } from "./session-messages";

(function installReaderSessionClient(root: typeof globalThis, factory: () => ReaderSessionApi) {
  root.ReaderSession = factory();
})(globalThis, function createReaderSessionClient(): ReaderSessionApi {
  function create(onStateChange: (state: ReaderSessionState) => void = () => {}): ReaderSessionHandle {
    const port = chrome.runtime.connect({ name: "reader-session" });
    let state: ReaderSessionState | null = null;
    let destroyed = false;
    let settleReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      rejectReady = reject;
    });

    function fail(message: string): void {
      if (destroyed || !rejectReady) return;
      rejectReady(new Error(message));
      settleReady = null;
      rejectReady = null;
    }

    port.onMessage.addListener((message: SessionWorkerMessage) => {
      if (destroyed || !message || typeof message !== "object") return;
      if (message.type === "state") {
        state = message.state;
        onStateChange(state);
        return;
      }
      if (message.type === "ready") {
        settleReady?.();
        settleReady = null;
        rejectReady = null;
        return;
      }
      if (message.type === "error") fail(message.message);
    });
    port.onDisconnect.addListener(() => fail(chrome.runtime.lastError?.message || "ReaderSession host disconnected"));

    return {
      ready,
      get state() {
        return state;
      },
      dispatch(command: ReaderSessionCommand): void {
        if (!destroyed) port.postMessage({ type: "dispatch", command });
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        port.disconnect();
        settleReady?.();
        settleReady = null;
        rejectReady = null;
        state = null;
      },
    };
  }

  return { create };
});

export {};
