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

export interface Spot extends ReaderUnit {
  durationMs: number;
}

export interface SpotOptions {
  locale?: string;
  maxWidth: number;
  measureText(text: string, kind: ReaderUnitKind): number;
  sectionOffsets?: number[];
  timingProfile?: ReaderTimingProfile;
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
  | { kind: "spot"; sourceOffset: number; spotIndex: number }
  | { kind: "figure"; sourceOffset: number; figureIndex: number };

export interface ReaderEngine {
  readonly DEFAULT_TIMING_PROFILE: Readonly<ReaderTimingProfile>;
  segmentText(text: string, locale?: string, boundaries?: number[]): ReaderUnit[];
  preserveCodeRanges(units: ReaderUnit[], text: string, ranges: ReaderCodeRange[]): ReaderUnit[];
  buildSpots(units: ReaderUnit[], options: SpotOptions): Spot[];
  splitSentenceSpans(text: string, locale?: string): SentenceSpan[];
  buildReadingFlow(spots: Spot[], figures: ReaderFigure[]): ReaderFlowItem[];
  positionForFlowItem(flowItem: ReaderFlowItem, spots: Spot[]): ReaderPosition;
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
