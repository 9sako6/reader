import "../../../packages/session/browser/session";
import type { SessionClientMessage } from "./session-messages";

type WasmSessionModule = {
  default(input?: { module_or_path?: string | ArrayBuffer | Uint8Array }): Promise<unknown>;
  ReaderSession: new () => unknown;
};

const scope = globalThis as typeof globalThis & {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<SessionClientMessage>) => void) | null;
};
const pending: ReaderSessionCommand[] = [];
let session: ReaderSessionHandle | null = null;

scope.onmessage = (event) => {
  if (!event.data || event.data.type !== "dispatch") return;
  if (session) session.dispatch(event.data.command);
  else pending.push(event.data.command);
};

void initialize();

async function initialize(): Promise<void> {
  try {
    const wasmModulePath = "./session-wasm.js";
    const wasm = await import(wasmModulePath) as WasmSessionModule;
    await wasm.default({ module_or_path: new URL("reader_session_bg.wasm", globalThis.location.href).href });
    globalThis.ReaderSessionWasm = wasm;
    session = globalThis.ReaderSession.create((state) => scope.postMessage({ type: "state", state }));
    for (const command of pending.splice(0)) session.dispatch(command);
    await session.ready;
    scope.postMessage({ type: "ready" });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
