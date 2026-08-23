import type { ReactElement } from "react";
import { DesktopView } from "./DesktopView";
import { ErrorView } from "./ErrorView";
import { LoadingView } from "./LoadingView";
import { MobileView } from "./MobileView";
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
