import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReaderView } from "./ReaderView";
import viewStyles from "./view.css";
import type { DesktopReaderViewHandlers, MobileReaderViewHandlers, ReaderScreen, ReaderViewHandlersByLayout, ReaderViewLayout, ReaderViewMount } from "./types";

function mount<Layout extends ReaderViewLayout>(host: Element, options: { layout: Layout }): ReaderViewMount<Layout> {
  const root: Root = createRoot(host);
  return {
    render(screen: ReaderScreen, handlers: ReaderViewHandlersByLayout[Layout]): void {
      const view = options.layout === "mobile"
        ? <ReaderView layout="mobile" screen={screen} handlers={handlers as MobileReaderViewHandlers} />
        : <ReaderView layout="desktop" screen={screen} handlers={handlers as DesktopReaderViewHandlers} />;
      flushSync(() => root.render(
        <>
          <style data-reader-view-styles="true">{viewStyles}</style>
          {view}
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
  ReaderView?: {
    mount<Layout extends ReaderViewLayout>(host: Element, options: { layout: Layout }): ReaderViewMount<Layout>;
  };
};

scope.ReaderView = { mount };
