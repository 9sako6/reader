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

  var module: { exports: unknown };
  var Defuddle: typeof import("defuddle").default;
  var Engine: ReaderEngine;
  var Extractor: ReaderExtractor;
  var MobileIcons: ReaderMobileIcons;
  var MobileViewer: ReaderMobileViewer;
  var __rsvpReaderInstalled: boolean;
}
