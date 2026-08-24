import type {
  ReaderViewHandlers as ReaderViewHandlersContract,
  ReaderViewModel as ReaderViewModelContract,
  ReaderViewMount as ReaderViewMountContract,
} from "../../../../../packages/view/src/types";

declare global {
  var __READER_PERFORMANCE_ENABLED: boolean | undefined;
  var __READER_PERFORMANCE_LAST_METRICS: ReaderExtractionMetrics | undefined;

  type ReaderViewModel = ReaderViewModelContract;
  type ReaderViewHandlers = ReaderViewHandlersContract;
  type ReaderViewMount = ReaderViewMountContract;

  interface ReaderViewApi {
    mount(host: Element): ReaderViewMount;
  }

  var ReaderView: ReaderViewApi | undefined;

  interface ReaderMobileViewer {
    install(): void;
    open(): Promise<void>;
    close(): void;
  }

  var MobileViewer: ReaderMobileViewer;

  var browser: {
    runtime?: { getURL?: (path: string) => string };
  } | undefined;
}
