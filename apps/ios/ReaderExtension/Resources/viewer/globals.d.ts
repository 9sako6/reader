export {};

declare global {
  interface ReaderMobileIcons {
    create(document: Document, name: "previous" | "play" | "pause" | "close", size?: number): SVGSVGElement;
  }

  interface ReaderMobileViewer {
    install(): void;
    open(): Promise<void>;
    close(): void;
  }

  var MobileIcons: ReaderMobileIcons;
  var MobileViewer: ReaderMobileViewer;
}
