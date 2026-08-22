export {};

declare global {
  var __rsvpReaderInstalled: boolean;

  interface ReaderReactViewerMount {
    render(model: unknown, handlers: unknown): void;
    unmount(): void;
  }

  interface ReaderReactViewerApi {
    mount(host: Element): ReaderReactViewerMount;
  }

  var ReaderReactViewer: ReaderReactViewerApi | undefined;
}
