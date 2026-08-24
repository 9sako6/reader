import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReaderView } from "./ReaderView";
import viewStyles from "./view.css";
import type { ReaderViewHandlers, ReaderViewModel, ReaderViewMount } from "./types";

function mount(host: Element): ReaderViewMount {
  const root: Root = createRoot(host);
  return {
    render(model: ReaderViewModel, handlers: ReaderViewHandlers): void {
      flushSync(() => root.render(
        <>
          <style data-reader-view-styles="true">{viewStyles}</style>
          <ReaderView model={model} handlers={handlers} />
        </>,
      ));
    },
    unmount(): void {
      root.unmount();
      host.remove();
    },
  };
}

const scope = globalThis as typeof globalThis & {
  ReaderView?: { mount(host: Element): ReaderViewMount };
};

scope.ReaderView = { mount };
