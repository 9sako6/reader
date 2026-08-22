export {};

declare global {
  var __READER_PERFORMANCE_ENABLED: boolean | undefined;
  var __READER_PERFORMANCE_LAST_METRICS: ReaderExtractionMetrics | undefined;

  interface ReaderReactViewerMount {
    render(model: unknown, handlers: unknown): void;
    unmount(): void;
  }

  interface ReaderReactViewerApi {
    mount(host: Element): ReaderReactViewerMount;
  }

  var ReaderReactViewer: ReaderReactViewerApi | undefined;

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
