import type { ReactElement } from "react";
import { DesktopView } from "./DesktopView";
import { ErrorView } from "./ErrorView";
import { LoadingView } from "./LoadingView";
import { MobileView } from "./MobileView";
import type { DesktopReaderViewHandlers, MobileReaderViewHandlers, ReaderScreen } from "./types";

type ReaderViewProps =
  | { layout: "desktop"; screen: ReaderScreen; handlers: DesktopReaderViewHandlers }
  | { layout: "mobile"; screen: ReaderScreen; handlers: MobileReaderViewHandlers };

export function ReaderView(props: ReaderViewProps): ReactElement {
  const { screen } = props;
  if (props.layout === "mobile") return <MobileView screen={screen} handlers={props.handlers} />;
  switch (screen.kind) {
    case "loading":
      return <LoadingView layout="desktop" screen={screen} handlers={props.handlers} />;
    case "error":
      return <ErrorView layout="desktop" screen={screen} handlers={props.handlers} />;
    case "spot":
    case "spot-figure":
    case "page":
      return <DesktopView screen={screen} handlers={props.handlers} />;
  }
}
