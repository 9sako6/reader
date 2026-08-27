import type { ReaderPosition, SentenceSpan, Spot } from "../../engine/src/types";
import type { ReaderBlock, ReaderFigure, ReaderHeading } from "../../extractor/src/types";

export type ReaderScreen =
  | LoadingScreen
  | ErrorScreen
  | PageScreen
  | SpotScreen
  | SpotFigureScreen;

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

export type PageScreen = {
  kind: "page";
  language: string;
  blocks: ReaderViewBlock[];
  figures: ReaderFigure[];
  headings: ReaderHeading[];
  activeHeadingIndex: number;
  position: ReaderPosition;
  progress: number;
  title: string;
};

type SpotsScreen = {
  progress: number;
  loadingCover: boolean;
  controlsVisible: boolean;
  rewindFeedback: ReaderRewindFeedback | null;
  headings: ReaderHeading[];
  activeHeadingIndex: number;
  reducedMotion: boolean;
};

export type SpotScreen = SpotsScreen & {
  kind: "spot";
  previous: string;
  next: string;
  spot: Spot;
  playback: "paused" | "playing";
};

export type SpotFigureScreen = SpotsScreen & {
  kind: "spot-figure";
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

export interface ReaderPageHandlers {
  pageScroll(element: HTMLElement | null): void;
  pagePosition(element: HTMLElement): void;
}

export interface ReaderViewHandlers extends ReaderFigureHandlers, ReaderPageHandlers {
  close(): void;
  cancel(): void;
  retry(): void;
  switchToPage(): void;
  switchToSpots(): void;
  previousSentence(): void;
  togglePlayback(): void;
  resumeFigure(): void;
  loadingAnimation(element: HTMLElement, reducedMotion: boolean): (() => void) | undefined;
}

export interface DesktopReaderViewHandlers extends ReaderViewHandlers {
  headingSelect(headingIndex: number): void;
}

export interface MobileReaderViewHandlers extends ReaderViewHandlers {
  spotsPointerUp(event: PointerEvent): void;
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
