export {};

declare global {
  type ReaderBlockKind = "heading" | "quote" | "preformatted" | "paragraph";

  interface ReaderHeading {
    text: string;
    level: number;
  }

  interface ReaderBlock extends ReaderOffsetBlock {
    text: string;
    kind: ReaderBlockKind;
    level: number | null;
  }

  interface ReaderFigure {
    src: string;
    alt: string;
    caption: string;
    referenceSentence: string;
    referenceEnd: number;
  }

  interface ReadingContext {
    title: string;
    blocks: ReaderBlock[];
    headings: ReaderHeading[];
    sectionOffsets: number[];
    sectionTransitions: ReaderSectionTransition[];
    initialHeadingIndex: number;
    figures: ReaderFigure[];
  }

  interface ReaderContent {
    text: string;
    readingContext: ReadingContext;
  }

  interface ReaderExtractor {
    fromText(text: string, readingContext?: Partial<ReadingContext> | null): ReaderContent | null;
    fromPage(sourceDocument?: Document, DefuddleClass?: typeof import("defuddle").default): ReaderContent | null;
  }
}
