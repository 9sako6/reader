export type ReaderViewModel =
  | { kind: "closed" }
  | { kind: "loading"; slow: boolean; reducedMotion: boolean; revealed?: boolean; mobile?: boolean }
  | { kind: "error"; message: string; canRetry: boolean; mobile?: boolean }
  | {
    kind: "rsvp";
    previous: string;
    next: string;
    unit: ReaderUnit | null;
    figure: ReaderFigureView | null;
    playing: boolean;
    progress: number;
    loadingCover?: boolean;
    rewindFeedback?: ReaderRewindFeedback;
    headings: ReaderHeading[];
    activeHeadingIndex: number;
    reducedMotion?: boolean;
    mobile?: boolean;
  }
  | {
    kind: "text";
    language: string;
    blocks: ReaderViewBlock[];
    figures: ReaderFigure[];
    position: ReaderPosition;
    progress: number;
    title: string;
    mobile?: boolean;
  };

export type ReaderViewBlock = ReaderBlock & { sentenceSpans: SentenceSpan[] };

export type ReaderFigureView = {
  figure: ReaderFigure;
  figureIndex: number;
  status: "loading" | "ready" | "failed";
  token?: number;
  loadingVisible?: boolean;
  brightness?: "dimmed" | "revealed";
};

export type ReaderRewindFeedback = {
  left: number;
  top: number;
  id: number;
};

export interface ReaderViewHandlers {
  close(): void;
  cancel(): void;
  retry(): void;
  switchToText(): void;
  switchToRsvp(): void;
  previousSentence(): void;
  headingSelect?(headingIndex: number): void;
  togglePlayback(): void;
  resumeFigure(): void;
  figureLoad(figureIndex: number, token?: number): void;
  figureError(figureIndex: number, token?: number): void;
  figureImage?(element: HTMLImageElement, figureIndex: number, token?: number): void;
  toggleFigureBrightness?(figureIndex: number): void;
  rewindFeedbackDone?(id: number): void;
  loadingAnimation?(element: HTMLElement, reducedMotion: boolean): (() => void) | undefined;
  rewindAnimation?(
    elements: { firstRing: HTMLElement; secondRing: HTMLElement; icon: SVGElement },
    reducedMotion: boolean,
    onDone: () => void,
  ): (() => void) | undefined;
  textScroll(element: HTMLElement | null): void;
  textPosition(element: HTMLElement): void;
  rsvpPointerUp?(event: PointerEvent): void;
}

export interface ReaderViewMount {
  render(model: ReaderViewModel, handlers: ReaderViewHandlers): void;
  unmount(): void;
}
