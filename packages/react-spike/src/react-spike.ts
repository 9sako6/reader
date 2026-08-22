import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface ReaderReactMount {
  unmount(): void;
}

function ReaderReactProbe(): ReactElement {
  return createElement("span", {
    "data-reader-react-spike": "true",
    "aria-hidden": "true",
    hidden: true,
  });
}

function mount(host: Element): ReaderReactMount {
  const root: Root = createRoot(host);
  root.render(createElement(ReaderReactProbe));
    return {
      unmount() {
        root.unmount();
        host.remove();
      },
    };
}

const scope = globalThis as typeof globalThis & {
  ReaderReactSpike?: { mount(host: Element): ReaderReactMount };
};

scope.ReaderReactSpike = { mount };
