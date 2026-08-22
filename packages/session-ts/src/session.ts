(function installReaderSession(root: typeof globalThis, factory: () => ReaderSessionApi) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReaderSession = api;
})(globalThis, function createReaderSessionApi(): ReaderSessionApi {
  type WasmSessionExports = {
    reader_session_create(): string;
    reader_session_dispatch(stateJson: string, actionJson: string): string;
  };

  let runtime: WasmSessionExports | null = null;
  let runtimePromise: Promise<void> | null = null;

  function wasmUrl(): string {
    const extensionRuntime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: { getURL?: (path: string) => string } };
      browser?: { runtime?: { getURL?: (path: string) => string } };
    }).chrome?.runtime?.getURL
      || (globalThis as typeof globalThis & {
        browser?: { runtime?: { getURL?: (path: string) => string } };
      }).browser?.runtime?.getURL;
    if (extensionRuntime) return extensionRuntime("reader_session_bg.wasm");
    return "reader_session_bg.wasm";
  }

  async function init(): Promise<void> {
    if (runtime) return;
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const scope = globalThis as typeof globalThis & {
          wasm_bindgen?: (moduleOrPath?: string) => Promise<WasmSessionExports>;
          ReaderSessionWasm?: WasmSessionExports;
        };
        if (scope.ReaderSessionWasm) {
          runtime = scope.ReaderSessionWasm;
          return;
        }
        const wasmBindgen = typeof wasm_bindgen === "function" ? wasm_bindgen : scope.wasm_bindgen;
        if (typeof wasmBindgen !== "function") {
          throw new Error("ReaderSession WASM glue is not loaded");
        }
        runtime = await wasmBindgen(wasmUrl()) as WasmSessionExports;
      })();
    }
    await runtimePromise;
  }

  function requireRuntime(): WasmSessionExports {
    if (!runtime) throw new Error("ReaderSession.init() must finish before create or reduce");
    return runtime;
  }

  function create(input: ReaderSessionInput): ReaderSessionState {
    const activeRuntime = requireRuntime();
    const requestId = input.requestId || "reader-session";
    let state = JSON.parse(activeRuntime.reader_session_create()) as ReaderSessionState;
    state = reduce(state, { type: "open", requestId }).state;
    return reduce(state, {
      type: "prepareSucceeded",
      requestId,
      flow: {
        textLength: input.textLength,
        units: input.units,
        figures: input.figures,
        flow: input.flow,
        timingProfile: input.timingProfile || {},
      },
    }).state;
  }

  function reduce(state: ReaderSessionState, command: ReaderSessionCommand): ReaderSessionTransition {
    const activeRuntime = requireRuntime();
    const transition = JSON.parse(
      activeRuntime.reader_session_dispatch(JSON.stringify(state), JSON.stringify(command)),
    ) as ReaderSessionTransition;
    return transition;
  }

  return {
    init,
    ready: () => runtime !== null,
    create,
    reduce,
  };
});
