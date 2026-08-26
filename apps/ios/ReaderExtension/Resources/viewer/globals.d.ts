import type {
  ReaderScreen as ReaderScreenContract,
  ReaderViewLayout as ReaderViewLayoutContract,
  ReaderViewMount as ReaderViewMountContract,
} from "../../../../../packages/view/src/types";

declare global {
  var __READER_PERFORMANCE_ENABLED: boolean | undefined;
  var __READER_PERFORMANCE_LAST_METRICS: ReaderExtractionMetrics | undefined;

  type ReaderScreen = ReaderScreenContract;
  type ReaderViewLayout = ReaderViewLayoutContract;
  type ReaderViewMount<Layout extends ReaderViewLayout> = ReaderViewMountContract<Layout>;

  interface ReaderViewApi {
    mount<Layout extends ReaderViewLayout>(host: Element, options: { layout: Layout }): ReaderViewMount<Layout>;
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
