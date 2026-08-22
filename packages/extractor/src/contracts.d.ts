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
    srcset?: string;
    sizes?: string;
    width?: number;
    height?: number;
    alt: string;
    caption: string;
    sourceOffset: number;
    sourceEnd: number;
  }

  interface ReadingContext {
    language: string;
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

  type PreparationFailure =
    | "content_not_found"
    | "unsupported_page"
    | "extraction_failed"
    | "session_unavailable";

  type PreparationState =
    | { kind: "idle" }
    | { kind: "preparing"; requestId: string; startedAt: number }
    | { kind: "ready"; requestId: string }
    | { kind: "cancelled"; requestId: string }
    | { kind: "failed"; requestId: string; reason: PreparationFailure };

  type ReaderExtractionPhase =
    | "dominant_article"
    | "defuddle_parse"
    | "canonical_text"
    | "blocks_figures";

  interface ReaderExtractionMetrics {
    dominantArticleMs: number;
    defuddleMs: number;
    indexMs: number;
    contextMs: number;
  }

  interface ReaderExtractionOptions {
    signal?: AbortSignal;
    onPhase?: (phase: ReaderExtractionPhase, durationMs: number) => void;
    onMetrics?: (metrics: ReaderExtractionMetrics) => void;
  }

  interface ReaderExtractor {
    fromText(text: string, readingContext?: Partial<ReadingContext> | null): ReaderContent | null;
    fromPage(sourceDocument?: Document, DefuddleClass?: typeof import("defuddle").default): ReaderContent | null;
    fromPageAsync(
      sourceDocument?: Document,
      DefuddleClass?: typeof import("defuddle").default,
      options?: ReaderExtractionOptions,
    ): Promise<ReaderContent | null>;
  }

  var module: { exports: unknown };
  var Defuddle: typeof import("defuddle").default;
  var Extractor: ReaderExtractor;
}
