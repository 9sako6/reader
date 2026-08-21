export {};

declare global {
  type ReaderIconName = "previous" | "play" | "pause" | "close";

  interface ReaderIconFactory {
    create(document: Document, name: ReaderIconName, size?: number): SVGSVGElement;
  }

  var ReaderIcons: ReaderIconFactory;
}
