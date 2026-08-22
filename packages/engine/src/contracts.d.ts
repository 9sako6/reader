export {};

declare global {
  type ReaderUnitKind = "body" | "quote" | "aside";

  interface SentenceSpan {
    start: number;
    end: number;
    sentenceIndex: number;
  }

  interface ReaderUnit {
    text: string;
    sentenceIndex: number;
    kind: ReaderUnitKind;
    start: number;
    end: number;
  }

  interface ReaderTimingProfile {
    baseUnitMs: number;
    msPerGrapheme: number;
    minUnitMs: number;
    maxUnitMs: number;
    clausePauseMs: number;
    sentencePauseMs: number;
    sectionPauseMs: number;
    speedMultiplier: number;
  }

  type ReaderPosition =
    | { kind: "text"; sourceOffset: number }
    | { kind: "figure"; sourceOffset: number; figureIndex: number };

  type ReaderFlowItem =
    | { kind: "unit"; sourceOffset: number; unitIndex: number }
    | { kind: "figure"; sourceOffset: number; figureIndex: number };

  interface ReaderSectionTransition {
    offset: number;
    headingIndex: number;
  }

  interface ReaderOffsetBlock {
    start: number;
    end: number;
    top?: number;
    bottom?: number;
  }

  interface ReaderEngine {
    readonly MAX_WORDS_PER_UNIT: number;
    readonly MAX_GRAPHEMES_PER_UNIT: number;
    readonly DEFAULT_TIMING_PROFILE: Readonly<ReaderTimingProfile>;
    segmentText(text: string, locale?: string, boundaries?: number[]): ReaderUnit[];
    splitLongUnits(units: ReaderUnit[], locale?: string, maxGraphemes?: number): ReaderUnit[];
    splitSentenceSpans(text: string, locale?: string): SentenceSpan[];
    splitStructuralSpans(text: string): Array<{ text: string; kind: ReaderUnitKind; start: number; end: number }>;
    buildReadingFlow(units: ReaderUnit[], figures: ReaderFigure[]): ReaderFlowItem[];
    findFlowIndexForPosition(flow: ReaderFlowItem[], units: ReaderUnit[], position: ReaderPosition): number;
    positionForFlowItem(flowItem: ReaderFlowItem, units: ReaderUnit[]): ReaderPosition;
    findSentenceStart(units: ReaderUnit[], currentUnitIndex: number): number;
    findPreviousSentenceStart(units: ReaderUnit[], currentUnitIndex: number): number;
    findActiveHeadingIndex(transitions: ReaderSectionTransition[], currentOffset: number, fallbackIndex?: number): number;
    calculateReadingProgress(currentEnd: number, sourceLength: number): number;
    findUnitIndex(units: ReaderUnit[], offset: number): number;
    surroundingSentences(units: ReaderUnit[], currentIndex: number): { previous: string; next: string };
    displayDuration(
      unit: Pick<ReaderUnit, "text" | "sentenceIndex">,
      nextUnit?: Pick<ReaderUnit, "sentenceIndex">,
      sectionBreak?: boolean,
      profile?: ReaderTimingProfile,
    ): number;
    sourceOffsetAtViewportCenter(blocks: ReaderOffsetBlock[], viewportCenter: number): number;
    findBlockIndexForOffset(blocks: ReaderOffsetBlock[], offset: number): number;
  }

  var module: { exports: unknown };
  var Engine: ReaderEngine;
}
