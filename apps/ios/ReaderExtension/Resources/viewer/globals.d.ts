export {};

declare global {
  var __READER_PERFORMANCE_ENABLED: boolean | undefined;
  var __READER_PERFORMANCE_LAST_METRICS: ReaderExtractionMetrics | undefined;

  interface ReaderMobileViewer {
    install(): void;
    open(): Promise<void>;
    close(): void;
  }

  var MobileViewer: ReaderMobileViewer;

  interface ReaderLazyRuntimeApi {
    createLazyRuntimeController(loadRuntime: () => Promise<void>): LazyRuntimeController;
    createExtensionRuntimeLoader(
      assets: readonly string[],
      getRuntimeURL: (resourceName: string) => string,
      importRuntime: (runtimeURL: string) => Promise<unknown>,
      installRuntime: () => void,
    ): () => Promise<void>;
  }

  interface LazyRuntimeController {
    open(): Promise<boolean>;
    close(): void;
    navigate(): void;
  }

  var ReaderLazyRuntime: ReaderLazyRuntimeApi;

  var browser: {
    runtime?: { getURL?: (path: string) => string };
  } | undefined;
}
