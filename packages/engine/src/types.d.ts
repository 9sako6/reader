import type { ReaderCodeRange, ReaderFigure, ReaderSectionTransition } from "../../extractor/src/types";

export type ReaderUnitKind = "body" | "quote" | "aside" | "code";

export interface SentenceSpan {
  start: number;
  end: number;
  sentenceIndex: number;
}

export interface ReaderUnit {
  text: string;
  sentenceIndex: number;
  kind: ReaderUnitKind;
  start: number;
  end: number;
}

export interface ReaderTimingProfile {
  baseUnitMs: number;
  msPerGrapheme: number;
  minUnitMs: number;
  maxUnitMs: number;
  clausePauseMs: number;
  sentencePauseMs: number;
  sectionPauseMs: number;
  speedMultiplier: number;
}

export type ReaderPosition =
  | { kind: "text"; sourceOffset: number }
  | { kind: "figure"; sourceOffset: number; figureIndex: number };

export type ReaderFlowItem =
  | { kind: "unit"; sourceOffset: number; unitIndex: number }
  | { kind: "figure"; sourceOffset: number; figureIndex: number };

export interface ReaderEngine {
  readonly MAX_GRAPHEMES_PER_UNIT: number;
  readonly DEFAULT_TIMING_PROFILE: Readonly<ReaderTimingProfile>;
  segmentText(text: string, locale?: string, boundaries?: number[]): ReaderUnit[];
  splitLongUnits(units: ReaderUnit[], locale?: string, maxGraphemes?: number): ReaderUnit[];
  preserveCodeRanges(units: ReaderUnit[], text: string, ranges: ReaderCodeRange[]): ReaderUnit[];
  splitSentenceSpans(text: string, locale?: string): SentenceSpan[];
  buildReadingFlow(units: ReaderUnit[], figures: ReaderFigure[]): ReaderFlowItem[];
  positionForFlowItem(flowItem: ReaderFlowItem, units: ReaderUnit[]): ReaderPosition;
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
}
