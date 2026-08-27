(function installReaderSession(root: typeof globalThis, factory: () => ReaderSessionApi) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReaderSession = api;
})(globalThis, function createReaderSessionApi(): ReaderSessionApi {
  interface WasmSession {
    observable(): string;
    dispatch(commandJson: string): string;
    free(): void;
  }

  type WasmSessionModule = {
    default(input?: { module_or_path?: string | ArrayBuffer | Uint8Array }): Promise<unknown>;
    ReaderSession: new () => WasmSession;
  };

  type RawCommand = ReaderSessionCommand | { type: "tick"; generation: number };
  type SessionEffect =
    | { type: "cancelTimer" }
    | { type: "scheduleTick"; generation: number; delayMs: number };

  let runtime: WasmSessionModule | null = null;
  let runtimePromise: Promise<WasmSessionModule> | null = null;
  let runtimeAttempt = 0;

  function extensionRuntime(): { getURL(path: string): string } | undefined {
    const scope = globalThis as typeof globalThis & {
      chrome?: { runtime?: { getURL?: (path: string) => string } };
      browser?: { runtime?: { getURL?: (path: string) => string } };
    };
    const candidate = scope.chrome?.runtime ?? scope.browser?.runtime;
    return typeof candidate?.getURL === "function"
      ? { getURL: candidate.getURL.bind(candidate) }
      : undefined;
  }

  function loadRuntime(): Promise<WasmSessionModule> {
    if (runtime) return Promise.resolve(runtime);
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      const scope = globalThis as typeof globalThis & {
        ReaderSessionWasm?: WasmSessionModule;
      };
      if (scope.ReaderSessionWasm) return scope.ReaderSessionWasm;
      const extension = extensionRuntime();
      if (!extension) throw new Error("ReaderSession extension runtime is unavailable");
      runtimeAttempt += 1;
      const moduleURL = new URL(extension.getURL("session-wasm.js"), globalThis.location?.href);
      moduleURL.searchParams.set("readerAttempt", String(runtimeAttempt));
      const loaded = await import(moduleURL.href) as WasmSessionModule;
      const response = await fetch(extension.getURL("reader_session_bg.wasm"));
      if (!response.ok) throw new Error(`ReaderSession WASM fetch failed: ${response.status}`);
      const module = new Uint8Array(await response.arrayBuffer()).buffer;
      await loaded.default({ module_or_path: module });
      return loaded;
    })().then((loaded) => {
      runtime = loaded;
      return loaded;
    }).catch((error) => {
      runtime = null;
      runtimePromise = null;
      throw error;
    });
    return runtimePromise;
  }

  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid ReaderSession payload");
    return value as Record<string, unknown>;
  }

  function text(value: unknown, name: string): string {
    if (typeof value !== "string") throw new TypeError(`Invalid ReaderSession ${name}`);
    return value;
  }

  function integer(value: unknown, name: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`Invalid ReaderSession ${name}`);
    return Number(value);
  }

  function decodePosition(value: unknown): ReaderSessionPosition {
    const position = object(value);
    const sourceOffset = integer(position.sourceOffset, "sourceOffset");
    if (position.kind === "text") return { kind: "text", sourceOffset };
    if (position.kind === "figure") {
      return { kind: "figure", sourceOffset, figureIndex: integer(position.figureIndex, "figureIndex") };
    }
    throw new TypeError("Invalid ReaderSession position kind");
  }

  function decodeState(value: unknown): ReaderSessionState {
    const state = object(value);
    const phase = text(state.phase, "phase");
    const generation = integer(state.generation, "generation");
    if (phase === "idle" || phase === "ended") return { phase, generation };
    if (phase === "preparing") {
      return { phase, generation, requestId: text(state.requestId, "requestId") };
    }
    if (phase === "error") {
      const reason = text(state.reason, "reason") as ReaderSessionFailure;
      if (!["content_not_found", "unsupported_page", "extraction_failed", "session_unavailable", "invalid_flow"].includes(reason)) {
        throw new TypeError("Invalid ReaderSession failure");
      }
      return { phase, generation, requestId: text(state.requestId, "requestId"), reason };
    }
    if (phase !== "reading") throw new TypeError("Invalid ReaderSession phase");
    const mode = text(state.mode, "mode");
    const playback = text(state.playback, "playback");
    const currentKind = text(state.currentKind, "currentKind");
    if (mode !== "spots" && mode !== "page") throw new TypeError("Invalid ReaderSession mode");
    if (playback !== "playing" && playback !== "paused") throw new TypeError("Invalid ReaderSession playback");
    if (currentKind !== "spot" && currentKind !== "figure") throw new TypeError("Invalid ReaderSession current kind");
    const spotIndex = state.spotIndex === null ? null : integer(state.spotIndex, "spotIndex");
    const figureIndex = state.figureIndex === null ? null : integer(state.figureIndex, "figureIndex");
    if ((currentKind === "spot") !== (spotIndex !== null) || (currentKind === "figure") !== (figureIndex !== null)) {
      throw new TypeError("Inconsistent ReaderSession current item");
    }
    return {
      phase,
      mode,
      playback,
      flowIndex: integer(state.flowIndex, "flowIndex"),
      flowLength: integer(state.flowLength, "flowLength"),
      generation,
      sourceOffset: integer(state.sourceOffset, "sourceOffset"),
      currentKind,
      requestId: text(state.requestId, "requestId"),
      timerPending: state.timerPending === true,
      position: decodePosition(state.position),
      spotIndex,
      figureIndex,
    };
  }

  function decodeTransition(value: string): { state: ReaderSessionState; effects: SessionEffect[] } {
    const transition = object(JSON.parse(value));
    const effects = Array.isArray(transition.effects) ? transition.effects.map((candidate): SessionEffect => {
      const effect = object(candidate);
      if (effect.type === "cancelTimer") return { type: "cancelTimer" };
      if (effect.type === "scheduleTick") {
        return {
          type: "scheduleTick",
          generation: integer(effect.generation, "effect generation"),
          delayMs: integer(effect.delayMs, "effect delay"),
        };
      }
      throw new TypeError("Invalid ReaderSession effect");
    }) : [];
    return { state: decodeState(transition.state), effects };
  }

  function create(onStateChange: (state: ReaderSessionState) => void = () => {}): ReaderSessionHandle {
    let session: WasmSession | null = null;
    let state: ReaderSessionState | null = null;
    let destroyed = false;
    let timer: number | null = null;
    const pending: Array<{ command: ReaderSessionCommand; observedState: ReaderSessionState | null }> = [];

    function clearTimer(): void {
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
    }

    function sameObservedState(left: ReaderSessionState, right: ReaderSessionState): boolean {
      if (left.phase !== right.phase || left.generation !== right.generation) return false;
      if (left.phase === "idle" || left.phase === "ended") return true;
      if (right.phase !== left.phase || left.requestId !== right.requestId) return false;
      if (left.phase === "preparing") return true;
      return left.phase === "error" && right.phase === "error" && left.reason === right.reason;
    }

    function dispatchNow(command: RawCommand, alreadyObserved: ReaderSessionState | null = null): void {
      if (destroyed || !session) return;
      const transition = decodeTransition(session.dispatch(JSON.stringify(command)));
      state = transition.state;
      for (const effect of transition.effects) {
        clearTimer();
        if (effect.type !== "scheduleTick") continue;
        const generation = effect.generation;
        timer = globalThis.setTimeout(() => {
          timer = null;
          if (destroyed || state?.phase !== "reading" || state.generation !== generation || state.playback !== "playing") return;
          dispatchNow({ type: "tick", generation });
        }, effect.delayMs);
      }
      if (!alreadyObserved || !sameObservedState(alreadyObserved, state)) onStateChange(state);
    }

    function observePending(command: ReaderSessionCommand): ReaderSessionState | null {
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
        return null;
      }
      onStateChange(state);
      return state;
    }

    const ready = loadRuntime().then((loaded) => {
      if (destroyed) return;
      session = new loaded.ReaderSession();
      state = decodeState(JSON.parse(session.observable()));
      if (pending.length === 0) onStateChange(state);
      for (const queued of pending.splice(0)) dispatchNow(queued.command, queued.observedState);
    }).catch((error: unknown) => {
      runtime = null;
      runtimePromise = null;
      if (!destroyed && state?.phase === "preparing") {
        state = {
          phase: "error",
          requestId: state.requestId,
          reason: "session_unavailable",
          generation: state.generation + 1,
        };
        onStateChange(state);
      }
      throw error;
    });

    return {
      ready,
      get state() {
        return state;
      },
      dispatch(command: ReaderSessionCommand): void {
        if (destroyed) return;
        if (!session) {
          pending.push({ command, observedState: observePending(command) });
        }
        else dispatchNow(command);
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        pending.length = 0;
        clearTimer();
        session?.free();
        session = null;
        state = null;
      },
    };
  }

  return { create };
});

export {};
