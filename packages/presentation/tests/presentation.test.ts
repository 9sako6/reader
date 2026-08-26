import assert from "node:assert/strict";
import type { ReaderContent } from "../../extractor/src/types";
import type { ReaderSessionState } from "../../session/browser/types";
import type { ReaderPresentationUiState } from "../src/presentation";

const Engine = require("../../../.build/packages/engine/src/engine.js");
const {
  prepareReaderDocument,
  presentReader,
  reflowReaderDocument,
  sessionPreparation,
} = require("../../../.build/packages/presentation/src/presentation.js");

function graphemeCount(text: string): number {
  return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].length;
}

function content(text: string): ReaderContent {
  return {
    text,
    readingContext: {
      language: "ja",
      title: "",
      blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    },
  };
}

const ui: ReaderPresentationUiState = {
  loadingSlow: false,
  loadingRevealed: false,
  loadingCover: false,
  controlsVisible: true,
  reducedMotion: false,
  rewindFeedback: null,
  figure: { kind: "idle" },
};

test("PreparedReaderDocument owns semantic units, fitted frames, timing, and flow", () => {
  const source = "非常に長い意味のまとまりです。次です。";
  const document = prepareReaderDocument(content(source), Engine, {
    maxWidth: 6,
    measureText: graphemeCount,
  });

  assert.ok(document.readerUnits.some((unit: { text: string }) => graphemeCount(unit.text) > 6));
  assert.ok(document.frames.length > document.readerUnits.length);
  assert.ok(document.frames.every((frame: { text: string; durationMs: number }) => (
    graphemeCount(frame.text) <= 6 && frame.durationMs > 0
  )));
  for (const frame of document.frames) {
    assert.equal(source.slice(frame.start, frame.end), frame.text);
  }
  assert.deepEqual(
    sessionPreparation(document).units.map(({ durationMs, start, end }: { durationMs: number; start: number; end: number }) => ({ durationMs, start, end })),
    document.frames.map(({ durationMs, start, end }: { durationMs: number; start: number; end: number }) => ({ durationMs, start, end })),
  );
});

test("reflow changes final frames without changing the extracted document or fixed semantics", () => {
  const source = "非常に長い意味のまとまりです。次です。";
  const narrow = prepareReaderDocument(content(source), Engine, {
    maxWidth: 5,
    measureText: graphemeCount,
  });
  const wide = reflowReaderDocument(narrow, Engine, {
    maxWidth: 20,
    measureText: graphemeCount,
  });

  assert.strictEqual(wide.text, narrow.text);
  assert.strictEqual(wide.readerUnits, narrow.readerUnits);
  assert.ok(wide.frames.length < narrow.frames.length);
});

test("presentReader selects the frame and progress only from ReaderSession state", () => {
  const source = "一文目です。二文目です。三文目です。";
  const document = prepareReaderDocument(content(source), Engine, {
    maxWidth: 20,
    measureText: graphemeCount,
  });
  const unitIndex = 1;
  const flowIndex = document.flow.findIndex((item: { kind: string; unitIndex?: number }) => (
    item.kind === "unit" && item.unitIndex === unitIndex
  ));
  const frame = document.frames[unitIndex];
  const session: ReaderSessionState = {
    phase: "reading",
    mode: "rsvp",
    playback: "paused",
    flowIndex,
    flowLength: document.flow.length,
    generation: 1,
    sourceOffset: frame.start,
    currentKind: "unit",
    requestId: "request-1",
    timerPending: false,
    position: { kind: "text", sourceOffset: frame.start },
    unitIndex,
    figureIndex: null,
  };

  const screen = presentReader(document, session, ui);
  assert.equal(screen.kind, "rsvp-unit");
  if (screen.kind !== "rsvp-unit") return;
  assert.strictEqual(screen.frame, frame);
  assert.equal(screen.previous, "一文目です。");
  assert.equal(screen.next, "三文目です。");
});
