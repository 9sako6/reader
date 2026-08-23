import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReaderView, type ReaderViewHandlers, type ReaderViewModel, type ReaderViewMount } from "./reader-view";

function mount(host: Element): ReaderViewMount {
  const root: Root = createRoot(host);
  return {
    render(model: ReaderViewModel, handlers: ReaderViewHandlers): void {
      flushSync(() => root.render(<ReaderView model={model} handlers={handlers} />));
    },
    unmount(): void {
      root.unmount();
      host.remove();
    },
  };
}

const scope = globalThis as typeof globalThis & {
  ReaderReactViewer?: { mount(host: Element): ReaderViewMount };
};

scope.ReaderReactViewer = { mount };
