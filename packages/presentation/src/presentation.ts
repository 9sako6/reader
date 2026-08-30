import type {
  ReaderEngine,
  ReaderFlowItem,
  ReaderPosition,
  ReaderUnit,
  ReaderUnitKind,
  Spot,
} from "../../engine/src/types";
import type {
  PreparationFailure,
  ReaderContent,
  ReaderFigure,
  ReaderHeading,
  ReaderSectionTransition,
} from "../../extractor/src/types";
import type {
  ReaderSessionPreparation,
  ReaderSessionState,
} from "../../session/browser/types";
import type {
  ReaderFigureView,
  ReaderRewindFeedback,
  ReaderScreen,
  ReaderViewBlock,
} from "../../view/src/types";

export const SPOT_FONT_SIZE_PX = 40;
export const SPOT_FONT = `600 ${SPOT_FONT_SIZE_PX}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif`;

export interface SpotLayout {
  maxWidth: number;
  measureText(text: string, kind: ReaderUnitKind): number;
}

export interface PreparedReaderDocument {
  text: string;
  language: string;
  title: string;
  blocks: ReaderViewBlock[];
  readerUnits: ReaderUnit[];
  spots: Spot[];
  spotContexts: Array<{ previous: string; next: string }>;
  figures: ReaderFigure[];
  flow: ReaderFlowItem[];
  headings: ReaderHeading[];
  sectionTransitions: ReaderSectionTransition[];
  initialHeadingIndex: number;
}

export type ReaderFigureRuntimeState =
  | { kind: "idle" }
  | { kind: "loading"; token: number; figureIndex: number; brightness: "dimmed" | "revealed"; loadingVisible: boolean }
  | { kind: "ready"; figureIndex: number; brightness: "dimmed" | "revealed" }
  | { kind: "failed"; figureIndex: number };

export interface ReaderPresentationUiState {
  loadingSlow: boolean;
  loadingRevealed: boolean;
  loadingCover: boolean;
  controlsVisible: boolean;
  reducedMotion: boolean;
  rewindFeedback: ReaderRewindFeedback | null;
  figure: ReaderFigureRuntimeState;
}

export function createSpotTextMeasurer(sourceDocument: Document): SpotLayout["measureText"] {
  const canvas = sourceDocument.createElement("canvas");
  const context = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (context) context.font = SPOT_FONT;
  return (text) => context?.measureText(text).width ?? estimateSpotTextWidth(text);
}

export function estimateSpotTextWidth(text: string): number {
  let width = 0;
  for (const { segment } of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)) {
    if (/^\s+$/u.test(segment)) width += SPOT_FONT_SIZE_PX * 0.28;
    else if (/^[\p{ASCII}]+$/u.test(segment)) width += SPOT_FONT_SIZE_PX * 0.58;
    else width += SPOT_FONT_SIZE_PX;
  }
  return width;
}

export function prepareReaderDocument(
  content: ReaderContent,
  engine: ReaderEngine,
  layout: SpotLayout,
  fallbackTitle = "",
): PreparedReaderDocument {
  const { readingContext } = content;
  const language = readingContext.language || "ja";
  const figures = Array.isArray(readingContext.figures) ? [...readingContext.figures] : [];
  const extractedBlocks = Array.isArray(readingContext.blocks) ? readingContext.blocks : [];
  const sourceBlocks = extractedBlocks.length > 0
    ? extractedBlocks
    : fallbackBlocks(content.text);
  const blocks = sourceBlocks.map((block) => ({
    ...block,
    sentenceSpans: engine.splitSentenceSpans(block.text, language),
  }));
  const codeRanges = sourceBlocks.flatMap((block) => block.codeRanges || []);
  const figureBoundaries = figures.flatMap((figure) => [figure.sourceOffset, figure.sourceEnd]);
  const codeBoundaries = codeRanges.flatMap((range) => [range.start, range.end]);
  const readerUnits = engine.preserveCodeRanges(
    engine.segmentText(content.text, language, [...figureBoundaries, ...codeBoundaries]),
    content.text,
    codeRanges,
  )
    .map(trimReaderUnit)
    .filter((unit) => unit.text.length > 0)
    .filter((unit) => !figures.some((figure) => (
      figure.sourceEnd > figure.sourceOffset
      && unit.start >= figure.sourceOffset
      && unit.end <= figure.sourceEnd
    )));
  return reflowReaderDocument({
    text: content.text,
    language,
    title: readingContext.title || fallbackTitle,
    blocks,
    readerUnits,
    spots: [],
    spotContexts: [],
    figures,
    flow: [],
    headings: Array.isArray(readingContext.headings) ? [...readingContext.headings] : [],
    sectionTransitions: Array.isArray(readingContext.sectionTransitions)
      ? [...readingContext.sectionTransitions]
      : [],
    initialHeadingIndex: Number.isInteger(readingContext.initialHeadingIndex)
      ? readingContext.initialHeadingIndex
      : -1,
  }, engine, layout);
}

export function reflowReaderDocument(
  document: PreparedReaderDocument,
  engine: ReaderEngine,
  layout: SpotLayout,
): PreparedReaderDocument {
  const spots = engine.buildSpots(document.readerUnits, {
    locale: document.language,
    maxWidth: layout.maxWidth,
    measureText: layout.measureText,
    sectionOffsets: [
      ...document.sectionTransitions.map(({ offset }) => offset),
    ],
  });
  return {
    ...document,
    spots,
    spotContexts: engine.buildSurroundingSentenceContexts(spots),
    flow: engine.buildReadingFlow(spots, document.figures),
  };
}

export function sessionPreparation(document: PreparedReaderDocument): ReaderSessionPreparation {
  return {
    textLength: document.text.length,
    spots: document.spots.map((spot) => ({
      sentenceIndex: spot.sentenceIndex,
      kind: spot.kind,
      start: spot.start,
      end: spot.end,
      durationMs: spot.durationMs,
    })),
    figures: document.figures.map((figure) => ({
      sourceOffset: figure.sourceOffset,
      sourceEnd: figure.sourceEnd,
    })),
    flow: document.flow,
  };
}

export function presentReader(
  document: PreparedReaderDocument | null,
  session: ReaderSessionState | null,
  ui: ReaderPresentationUiState,
): ReaderScreen {
  if (!session || session.phase === "idle" || session.phase === "preparing") {
    return {
      kind: "loading",
      slow: ui.loadingSlow,
      revealed: ui.loadingRevealed,
      reducedMotion: ui.reducedMotion,
    };
  }
  if (session.phase === "error") {
    return { kind: "error", message: preparationFailureLabel(session.reason) };
  }
  if (session.phase === "ended" || !document) {
    return { kind: "error", message: preparationFailureLabel("session_unavailable") };
  }
  const position = session.position;
  const activeHeadingIndex = activeHeadingIndexAt(
    document.sectionTransitions,
    position.sourceOffset,
    document.initialHeadingIndex,
  );
  if (session.mode === "page") {
    const title = document.title.trim();
    return {
      kind: "page",
      language: document.language,
      blocks: document.blocks,
      figures: document.figures,
      headings: document.headings,
      activeHeadingIndex,
      position,
      progress: readingProgress(position.sourceOffset, document.text.length),
      title: title && document.blocks[0]?.text.trim() !== title ? title : "",
    };
  }
  const item = document.flow[session.flowIndex];
  const spot = item?.kind === "spot" && session.spotIndex !== null
    ? document.spots[session.spotIndex]
    : undefined;
  const progress = readingProgress(
    progressSourceOffset(document, position, spot),
    document.text.length,
  );
  const common = {
    reducedMotion: ui.reducedMotion,
    progress,
    loadingCover: ui.loadingCover,
    controlsVisible: ui.controlsVisible,
    rewindFeedback: ui.rewindFeedback,
    headings: document.headings,
    activeHeadingIndex,
  };
  if (item?.kind === "figure") {
    return {
      kind: "spot-figure",
      figure: presentFigure(document, item.figureIndex, ui.figure),
      ...common,
    };
  }
  if (!spot) throw new Error("reader_spot_unavailable");
  const context = document.spotContexts[session.spotIndex ?? 0] ?? { previous: "", next: "" };
  return {
    kind: "spot",
    previous: context.previous,
    next: context.next,
    spot,
    playback: session.playback,
    ...common,
  };
}

function activeHeadingIndexAt(
  transitions: ReaderSectionTransition[],
  sourceOffset: number,
  fallbackIndex: number,
): number {
  let activeIndex = fallbackIndex;
  for (const transition of transitions) {
    if (transition.offset <= sourceOffset) activeIndex = transition.headingIndex;
  }
  return activeIndex;
}

function readingProgress(sourceOffset: number, sourceLength: number): number {
  if (!Number.isFinite(sourceOffset) || !Number.isFinite(sourceLength) || sourceLength <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((sourceOffset / sourceLength) * 100)));
}

function trimReaderUnit(unit: ReaderUnit): ReaderUnit {
  if (unit.kind === "code") return { ...unit };
  const text = unit.text.trim();
  const leadingWhitespace = unit.text.length - unit.text.trimStart().length;
  return {
    ...unit,
    text,
    start: unit.start + leadingWhitespace,
    end: unit.start + leadingWhitespace + text.length,
  };
}

function fallbackBlocks(text: string): ReaderViewBlock[] {
  const blocks: ReaderViewBlock[] = [];
  let searchFrom = 0;
  for (const rawValue of text.split(/\n\s*\n|\n(?=\s*[\p{L}\p{N}「『（(])/u)) {
    const value = rawValue.trim();
    if (!value) continue;
    const start = text.indexOf(value, searchFrom);
    blocks.push({
      text: value,
      kind: "paragraph",
      level: null,
      start,
      end: start + value.length,
      sentenceSpans: [],
    });
    searchFrom = start + value.length;
  }
  return blocks;
}

function progressSourceOffset(
  document: PreparedReaderDocument,
  position: ReaderPosition,
  spot: Spot | undefined,
): number {
  if (position.kind === "figure") return position.sourceOffset;
  const currentSpot = spot || document.spots[0];
  const finalTextSpot = currentSpot
    && document.spots.at(-1) === currentSpot
    && !document.figures.some((figure) => figure.sourceOffset >= currentSpot.end);
  return finalTextSpot ? document.text.length : position.sourceOffset;
}

function presentFigure(
  document: PreparedReaderDocument,
  figureIndex: number,
  state: ReaderFigureRuntimeState,
): ReaderFigureView {
  const figure = document.figures[figureIndex];
  if (!figure || state.kind === "idle" || state.figureIndex !== figureIndex) {
    throw new Error("reader_figure_state_unavailable");
  }
  if (state.kind === "loading") {
    return {
      figure,
      figureIndex,
      status: "loading",
      token: state.token,
      loadingVisible: state.loadingVisible,
      brightness: state.brightness,
    };
  }
  if (state.kind === "ready") {
    return { figure, figureIndex, status: "ready", brightness: state.brightness };
  }
  return { figure, figureIndex, status: "failed" };
}

function preparationFailureLabel(reason: PreparationFailure | "invalid_flow"): string {
  if (reason === "content_not_found") return "文章を読み取れませんでした";
  if (reason === "unsupported_page") return "このページはまだ開けません";
  return "文章を準備できませんでした";
}
