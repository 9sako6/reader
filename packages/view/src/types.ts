import type { ReaderPosition, ReaderUnit, SentenceSpan } from "../../engine/src/types";
import type { ReaderBlock, ReaderFigure, ReaderHeading } from "../../extractor/src/types";

export type ReaderScreen =
  | LoadingScreen
  | ErrorScreen
  | TextScreen
  | RsvpUnitScreen
  | RsvpFigureScreen;

export type LoadingScreen = {
  kind: "loading";
  slow: boolean;
  reducedMotion: boolean;
  revealed: boolean;
};

export type ErrorScreen = {
  kind: "error";
  message: string;
};

export type TextScreen = {
  kind: "text";
  language: string;
  blocks: ReaderViewBlock[];
  figures: ReaderFigure[];
  headings: ReaderHeading[];
  activeHeadingIndex: number;
  position: ReaderPosition;
  progress: number;
  title: string;
};

type RsvpScreen = {
  progress: number;
  loadingCover: boolean;
  controlsVisible: boolean;
  rewindFeedback: ReaderRewindFeedback | null;
  headings: ReaderHeading[];
  activeHeadingIndex: number;
  reducedMotion: boolean;
};

export type RsvpUnitScreen = RsvpScreen & {
  kind: "rsvp-unit";
  previous: string;
  next: string;
  unit: ReaderUnit;
  playback: "paused" | "playing";
};

export type RsvpFigureScreen = RsvpScreen & {
  kind: "rsvp-figure";
  figure: ReaderFigureView;
};

export type ReaderViewBlock = ReaderBlock & { sentenceSpans: SentenceSpan[] };

type ReaderFigureIdentity = {
  figure: ReaderFigure;
  figureIndex: number;
};

export type ReaderFigureView = ReaderFigureIdentity & (
  | {
    status: "loading";
    token: number;
    loadingVisible: boolean;
    brightness: "dimmed" | "revealed";
  }
  | {
    status: "ready";
    brightness: "dimmed" | "revealed";
  }
  | { status: "failed" }
);

export type ReaderRewindFeedback = {
  left: number;
  top: number;
  id: number;
};

export interface ReaderFigureHandlers {
  figureLoad(figureIndex: number, token: number): void;
  figureError(figureIndex: number, token: number): void;
  figureImage(element: HTMLImageElement, figureIndex: number, token: number): void;
  toggleFigureBrightness(figureIndex: number): void;
}

export interface ReaderTextHandlers {
  textScroll(element: HTMLElement | null): void;
  textPosition(element: HTMLElement): void;
}

export interface ReaderViewHandlers extends ReaderFigureHandlers, ReaderTextHandlers {
  close(): void;
  cancel(): void;
  retry(): void;
  switchToText(): void;
  switchToRsvp(): void;
  previousSentence(): void;
  togglePlayback(): void;
  resumeFigure(): void;
  loadingAnimation(element: HTMLElement, reducedMotion: boolean): (() => void) | undefined;
}

export interface DesktopReaderViewHandlers extends ReaderViewHandlers {
  headingSelect(headingIndex: number): void;
}

export interface MobileReaderViewHandlers extends ReaderViewHandlers {
  rsvpPointerUp(event: PointerEvent): void;
  rewindFeedbackDone(id: number): void;
  rewindAnimation(
    elements: { firstRing: HTMLElement; secondRing: HTMLElement; icon: SVGElement },
    reducedMotion: boolean,
    onDone: () => void,
  ): (() => void) | undefined;
}

export type ReaderViewLayout = "desktop" | "mobile";

export type ReaderViewHandlersByLayout = {
  desktop: DesktopReaderViewHandlers;
  mobile: MobileReaderViewHandlers;
};

export interface ReaderViewMount<Layout extends ReaderViewLayout> {
  render(screen: ReaderScreen, handlers: ReaderViewHandlersByLayout[Layout]): void;
  unmount(): void;
}
