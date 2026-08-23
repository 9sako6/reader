import type { ReactElement } from "react";
import { DesktopView } from "./desktop-view";
import { ErrorView } from "./error-view";
import { LoadingView } from "./loading-view";
import { MobileView } from "./mobile-view";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function ReaderView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if ("mobile" in model && model.mobile) return <MobileView model={model} handlers={handlers} />;
  switch (model.kind) {
    case "loading":
      return <LoadingView model={model} handlers={handlers} />;
    case "error":
      return <ErrorView model={model} handlers={handlers} />;
    case "rsvp":
      return <DesktopView model={model} handlers={handlers} />;
    case "text":
      return <DesktopView model={model} handlers={handlers} />;
  }
}
