import type { SessionWorkerMessage } from "./session-messages";

(function installReaderSessionClient(root: typeof globalThis, factory: () => ReaderSessionApi) {
  root.ReaderSession = factory();
})(globalThis, function createReaderSessionClient(): ReaderSessionApi {
  function create(onStateChange: (state: ReaderSessionState) => void = () => {}): ReaderSessionHandle {
    const port = chrome.runtime.connect({ name: "reader-session" });
    let state: ReaderSessionState | null = null;
    let destroyed = false;
    const locallyObserved: ReaderSessionState[] = [];
    let settleReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      rejectReady = reject;
    });

    function fail(message: string): void {
      if (destroyed || !rejectReady) return;
      locallyObserved.length = 0;
      if (state?.phase === "preparing") {
        state = {
          phase: "error",
          requestId: state.requestId,
          reason: "session_unavailable",
          generation: state.generation + 1,
        };
        onStateChange(state);
      }
      rejectReady(new Error(message));
      settleReady = null;
      rejectReady = null;
    }

    function sameObservedState(left: ReaderSessionState, right: ReaderSessionState): boolean {
      if (left.phase !== right.phase || left.generation !== right.generation) return false;
      if (left.phase === "idle" || left.phase === "ended") return true;
      if (right.phase !== left.phase || left.requestId !== right.requestId) return false;
      if (left.phase === "preparing") return true;
      return left.phase === "error" && right.phase === "error" && left.reason === right.reason;
    }

    function observeCommand(command: ReaderSessionCommand): void {
      const generation = (state?.generation ?? 0) + 1;
      if (command.type === "open") {
        state = { phase: "preparing", requestId: command.requestId, generation };
      } else if (command.type === "cancel" && state?.phase === "preparing" && state.requestId === command.requestId) {
        state = { phase: "idle", generation };
      } else if (command.type === "prepareFailed" && state?.phase === "preparing" && state.requestId === command.requestId) {
        state = { phase: "error", requestId: command.requestId, reason: command.reason, generation };
      } else if (command.type === "close") {
        state = { phase: "ended", generation };
      } else {
        return;
      }
      locallyObserved.push(state);
      onStateChange(state);
    }

    port.onMessage.addListener((message: SessionWorkerMessage) => {
      if (destroyed || !message || typeof message !== "object") return;
      if (message.type === "state") {
        const observedIndex = locallyObserved.findIndex((observed) => sameObservedState(observed, message.state));
        if (observedIndex >= 0) {
          locallyObserved.splice(observedIndex, 1);
          if (!state || message.state.generation >= state.generation) state = message.state;
          return;
        }
        if (state && message.state.generation < state.generation) return;
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
        if (destroyed) return;
        observeCommand(command);
        port.postMessage({ type: "dispatch", command });
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        port.disconnect();
        locallyObserved.length = 0;
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
