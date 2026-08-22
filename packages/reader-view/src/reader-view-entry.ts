import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReaderView, type ReaderViewHandlers, type ReaderViewModel, type ReaderViewMount } from "./reader-view";

function mount(host: Element): ReaderViewMount {
  const root: Root = createRoot(host);
  return {
    render(model: ReaderViewModel, handlers: ReaderViewHandlers): void {
      root.render(createElement(ReaderView, { model, handlers }));
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
