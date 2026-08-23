export type ReaderBlockKind = "heading" | "quote" | "preformatted" | "paragraph";

export interface ReaderSourceRange {
  start: number;
  end: number;
}

export interface ReaderHeading {
  text: string;
  level: number;
}

export interface ReaderCodeRange extends ReaderSourceRange {
  text: string;
}

export interface ReaderBlock extends ReaderSourceRange {
  text: string;
  kind: ReaderBlockKind;
  level: number | null;
  codeRanges?: ReaderCodeRange[];
}

export interface ReaderImageFigure {
  kind: "image";
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

export interface ReaderCodeFigure {
  kind: "code";
  alt: string;
  caption: string;
  code: string;
  language: string;
  sourceOffset: number;
  sourceEnd: number;
}

export interface ReaderMermaidFigure {
  kind: "mermaid";
  src?: string;
  alt: string;
  caption: string;
  code: string;
  sourceOffset: number;
  sourceEnd: number;
}

export type ReaderFigure = ReaderImageFigure | ReaderCodeFigure | ReaderMermaidFigure;

export interface ReaderSectionTransition {
  offset: number;
  headingIndex: number;
}

export interface ReadingContext {
  language: string;
  title: string;
  blocks: ReaderBlock[];
  headings: ReaderHeading[];
  sectionOffsets: number[];
  sectionTransitions: ReaderSectionTransition[];
  initialHeadingIndex: number;
  figures: ReaderFigure[];
}

export interface ReaderContent {
  text: string;
  readingContext: ReadingContext;
}

export type PreparationFailure =
  | "content_not_found"
  | "unsupported_page"
  | "extraction_failed"
  | "session_unavailable";

export type PreparationState =
  | { kind: "idle" }
  | { kind: "preparing"; requestId: string; startedAt: number }
  | { kind: "ready"; requestId: string }
  | { kind: "cancelled"; requestId: string }
  | { kind: "failed"; requestId: string; reason: PreparationFailure };

export type ReaderExtractionPhase =
  | "dominant_article"
  | "defuddle_parse"
  | "canonical_text"
  | "blocks_figures";

export interface ReaderExtractionMetrics {
  dominantArticleMs: number;
  defuddleMs: number;
  indexMs: number;
  contextMs: number;
}

export interface ReaderExtractionOptions {
  signal?: AbortSignal;
  onPhase?: (phase: ReaderExtractionPhase, durationMs: number) => void;
  onMetrics?: (metrics: ReaderExtractionMetrics) => void;
}

export interface ReaderExtractor {
  fromText(text: string, readingContext?: Partial<ReadingContext> | null): ReaderContent | null;
  fromPage(sourceDocument?: Document, DefuddleClass?: typeof import("defuddle").default): ReaderContent | null;
  fromPageAsync(
    sourceDocument?: Document,
    DefuddleClass?: typeof import("defuddle").default,
    options?: ReaderExtractionOptions,
  ): Promise<ReaderContent | null>;
}
