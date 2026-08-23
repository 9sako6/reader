import type {
  ReaderViewHandlers as ReaderViewHandlersContract,
  ReaderViewModel as ReaderViewModelContract,
  ReaderViewMount as ReaderViewMountContract,
} from "../../../packages/view/src/types";

declare global {
  var __rsvpReaderInstalled: boolean;

  type ReaderViewModel = ReaderViewModelContract;
  type ReaderViewHandlers = ReaderViewHandlersContract;
  type ReaderViewMount = ReaderViewMountContract;

  interface ReaderViewApi {
    mount(host: Element): ReaderViewMount;
  }

  var ReaderView: ReaderViewApi | undefined;
}
