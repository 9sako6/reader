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

  let runtime: WasmSessionExports | null = null;
  let runtimePromise: Promise<void> | null = null;

  function extensionWasmUrl(): string | undefined {
    const scope = globalThis as typeof globalThis & {
      chrome?: { runtime?: { getURL?: (path: string) => string } };
      browser?: { runtime?: { getURL?: (path: string) => string } };
    };
    const extensionRuntime = scope.chrome?.runtime ?? scope.browser?.runtime;
    return extensionRuntime?.getURL?.("reader_session_bg.wasm");
  }

  async function init(): Promise<void> {
    if (runtime) return;
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const scope = globalThis as typeof globalThis & {
          wasm_bindgen?: (moduleOrPath?: string | ArrayBuffer | Uint8Array) => Promise<WasmSessionExports>;
          ReaderSessionWasm?: WasmSessionExports;
        };
        if (scope.ReaderSessionWasm) {
          runtime = scope.ReaderSessionWasm;
          return;
        }
        const wasmBindgen = (typeof wasm_bindgen === "function" ? wasm_bindgen : scope.wasm_bindgen) as
          | ((moduleOrPath?: string | ArrayBuffer | Uint8Array) => Promise<WasmSessionExports>)
          | undefined;
        if (typeof wasmBindgen !== "function") {
          throw new Error("ReaderSession WASM glue is not loaded");
        }
        const url = extensionWasmUrl();
        if (!url) {
          await wasmBindgen();
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`ReaderSession WASM fetch failed: ${response.status}`);
          await wasmBindgen(new Uint8Array(await response.arrayBuffer()).buffer);
        }
        runtime = wasmBindgen as unknown as WasmSessionExports;
      })().catch((error) => {
        runtime = null;
        runtimePromise = null;
        throw error;
      });
    }
    await runtimePromise;
  }

  function requireRuntime(): WasmSessionExports {
    if (!runtime) throw new Error("ReaderSession.init() must finish before create or dispatch");
    return runtime;
  }

  function create(): ReaderSessionHandle {
    const activeRuntime = requireRuntime();
    const id = activeRuntime.reader_session_create();
    const handle: ReaderSessionHandle = {
      id,
      state: JSON.parse(activeRuntime.reader_session_observable(id)) as ReaderSessionObservableState,
      destroyed: false,
    };
    return handle;
  }

  function dispatch(handle: ReaderSessionHandle, command: ReaderSessionCommand): ReaderSessionTransition {
    if (handle.destroyed) throw new Error("ReaderSession handle has been destroyed");
    const activeRuntime = requireRuntime();
    const transition = JSON.parse(
      activeRuntime.reader_session_dispatch(handle.id, JSON.stringify(command)),
    ) as ReaderSessionTransition;
    handle.state = transition.state;
    return transition;
  }

  function destroy(handle: ReaderSessionHandle): void {
    if (handle.destroyed) return;
    if (runtime) runtime.reader_session_destroy(handle.id);
    handle.destroyed = true;
  }

  return {
    init,
    ready: () => runtime !== null,
    create,
    dispatch,
    destroy,
  };
});
