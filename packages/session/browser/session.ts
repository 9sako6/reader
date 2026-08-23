(function installReaderSession(root: typeof globalThis, factory: () => ReaderSessionApi) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReaderSession = api;
})(globalThis, function createReaderSessionApi(): ReaderSessionApi {
  type WasmSessionExports = {
    reader_session_create(): number;
    reader_session_observable(handle: number): string;
    reader_session_dispatch(handle: number, commandJson: string): string;
    reader_session_destroy(handle: number): void;
  };

  type RawCommand = ReaderSessionCommand | { type: "tick"; generation: number };
  type SessionEffect =
    | { type: "cancelTimer" }
    | { type: "scheduleTick"; generation: number; delayMs: number };

  let runtime: WasmSessionExports | null = null;
  let runtimePromise: Promise<WasmSessionExports> | null = null;

  function extensionWasmUrl(): string | undefined {
    const scope = globalThis as typeof globalThis & {
      chrome?: { runtime?: { getURL?: (path: string) => string } };
      browser?: { runtime?: { getURL?: (path: string) => string } };
    };
    return (scope.chrome?.runtime ?? scope.browser?.runtime)?.getURL?.("reader_session_bg.wasm");
  }

  function loadRuntime(): Promise<WasmSessionExports> {
    if (runtime) return Promise.resolve(runtime);
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      const scope = globalThis as typeof globalThis & {
        wasm_bindgen?: (moduleOrPath?: string | ArrayBuffer | Uint8Array) => Promise<WasmSessionExports>;
        ReaderSessionWasm?: WasmSessionExports;
      };
      if (scope.ReaderSessionWasm) return scope.ReaderSessionWasm;
      const wasmBindgen = (typeof wasm_bindgen === "function" ? wasm_bindgen : scope.wasm_bindgen) as
        | ((moduleOrPath?: string | ArrayBuffer | Uint8Array) => Promise<WasmSessionExports>)
        | undefined;
      if (!wasmBindgen) throw new Error("ReaderSession WASM glue is not loaded");
      const url = extensionWasmUrl();
      if (!url) await wasmBindgen();
      else {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`ReaderSession WASM fetch failed: ${response.status}`);
        await wasmBindgen(new Uint8Array(await response.arrayBuffer()).buffer);
      }
      return wasmBindgen as unknown as WasmSessionExports;
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
    if (mode !== "rsvp" && mode !== "text") throw new TypeError("Invalid ReaderSession mode");
    if (playback !== "playing" && playback !== "paused") throw new TypeError("Invalid ReaderSession playback");
    if (currentKind !== "unit" && currentKind !== "figure") throw new TypeError("Invalid ReaderSession current kind");
    const unitIndex = state.unitIndex === null ? null : integer(state.unitIndex, "unitIndex");
    const figureIndex = state.figureIndex === null ? null : integer(state.figureIndex, "figureIndex");
    if ((currentKind === "unit") !== (unitIndex !== null) || (currentKind === "figure") !== (figureIndex !== null)) {
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
      unitIndex,
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
    let id: number | null = null;
    let state: ReaderSessionState | null = null;
    let destroyed = false;
    let timer: number | null = null;
    const pending: RawCommand[] = [];

    function clearTimer(): void {
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
    }

    function dispatchNow(command: RawCommand): void {
      if (destroyed || id === null || !runtime) return;
      const transition = decodeTransition(runtime.reader_session_dispatch(id, JSON.stringify(command)));
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
      onStateChange(state);
    }

    const ready = loadRuntime().then((loaded) => {
      if (destroyed) return;
      id = loaded.reader_session_create();
      state = decodeState(JSON.parse(loaded.reader_session_observable(id)));
      onStateChange(state);
      for (const command of pending.splice(0)) dispatchNow(command);
    });

    return {
      ready,
      get state() {
        return state;
      },
      dispatch(command: ReaderSessionCommand): void {
        if (destroyed) return;
        if (id === null) pending.push(command);
        else dispatchNow(command);
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        pending.length = 0;
        clearTimer();
        if (id !== null && runtime) runtime.reader_session_destroy(id);
        id = null;
        state = null;
      },
    };
  }

  return { create };
});
