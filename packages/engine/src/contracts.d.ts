export {};

declare global {
  type ReaderUnitKind = "body" | "quote" | "aside";

  interface ReaderUnit {
    text: string;
    sentenceIndex: number;
    kind: ReaderUnitKind;
    start: number;
    end: number;
  }

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
    segmentText(text: string, locale?: string): ReaderUnit[];
    splitLongUnits(units: ReaderUnit[], locale?: string, maxGraphemes?: number): ReaderUnit[];
    splitStructuralSpans(text: string): Array<{ text: string; kind: ReaderUnitKind; start: number }>;
    findPreviousSentenceStart(units: ReaderUnit[], currentUnitIndex: number): number;
    findActiveHeadingIndex(transitions: ReaderSectionTransition[], currentOffset: number, fallbackIndex?: number): number;
    calculateReadingProgress(currentEnd: number, sourceLength: number): number;
    findUnitIndex(units: ReaderUnit[], offset: number): number;
    surroundingSentences(units: ReaderUnit[], currentIndex: number): { previous: string; next: string };
    displayDuration(unit: Pick<ReaderUnit, "text" | "sentenceIndex">, nextUnit?: Pick<ReaderUnit, "sentenceIndex">, sectionBreak?: boolean): number;
    sourceOffsetAtViewportCenter(blocks: ReaderOffsetBlock[], viewportCenter: number): number;
    findBlockIndexForOffset(blocks: ReaderOffsetBlock[], offset: number): number;
  }

  var module: { exports: unknown };
  var Engine: ReaderEngine;
}
