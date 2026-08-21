export {};

declare global {
  interface ReaderMobileViewer {
    install(): void;
    open(): Promise<void>;
    close(): void;
  }

  var MobileViewer: ReaderMobileViewer;
}
