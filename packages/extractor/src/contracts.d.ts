import type {
  PreparationFailure as PreparationFailureContract,
  PreparationState as PreparationStateContract,
  ReaderBlock as ReaderBlockContract,
  ReaderBlockKind as ReaderBlockKindContract,
  ReaderCodeRange as ReaderCodeRangeContract,
  ReaderCodeFigure as ReaderCodeFigureContract,
  ReaderContent as ReaderContentContract,
  ReaderExtractionMetrics as ReaderExtractionMetricsContract,
  ReaderExtractionOptions as ReaderExtractionOptionsContract,
  ReaderExtractionPhase as ReaderExtractionPhaseContract,
  ReaderExtractor as ReaderExtractorContract,
  ReaderFigure as ReaderFigureContract,
  ReaderHeading as ReaderHeadingContract,
  ReaderImageFigure as ReaderImageFigureContract,
  ReaderMermaidFigure as ReaderMermaidFigureContract,
  ReaderSectionTransition as ReaderSectionTransitionContract,
  ReadingContext as ReadingContextContract,
} from "./types";

declare global {
  type ReaderBlockKind = ReaderBlockKindContract;
  type ReaderHeading = ReaderHeadingContract;
  type ReaderCodeRange = ReaderCodeRangeContract;
  type ReaderCodeFigure = ReaderCodeFigureContract;
  type ReaderBlock = ReaderBlockContract;
  type ReaderImageFigure = ReaderImageFigureContract;
  type ReaderMermaidFigure = ReaderMermaidFigureContract;
  type ReaderFigure = ReaderFigureContract;
  type ReaderSectionTransition = ReaderSectionTransitionContract;
  type ReadingContext = ReadingContextContract;
  type ReaderContent = ReaderContentContract;
  type PreparationFailure = PreparationFailureContract;
  type PreparationState = PreparationStateContract;
  type ReaderExtractionPhase = ReaderExtractionPhaseContract;
  type ReaderExtractionMetrics = ReaderExtractionMetricsContract;
  type ReaderExtractionOptions = ReaderExtractionOptionsContract;
  type ReaderExtractor = ReaderExtractorContract;

  var module: { exports: unknown };
  var Defuddle: typeof import("defuddle").default;
  var Extractor: ReaderExtractor;
}

export {};
