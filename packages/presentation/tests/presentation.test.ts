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

test("PreparedReaderDocument owns semantic units, fitted spots, timing, and flow", () => {
  const source = "非常に長い意味のまとまりです。次です。";
  const document = prepareReaderDocument(content(source), Engine, {
    maxWidth: 6,
    measureText: graphemeCount,
  });

  assert.ok(document.readerUnits.some((unit: { text: string }) => graphemeCount(unit.text) > 6));
  assert.ok(document.spots.length > document.readerUnits.length);
  assert.ok(document.spots.every((spot: { text: string; durationMs: number }) => (
    graphemeCount(spot.text) <= 6 && spot.durationMs > 0
  )));
  for (const spot of document.spots) {
    assert.equal(source.slice(spot.start, spot.end), spot.text);
  }
  assert.deepEqual(
    sessionPreparation(document).spots.map(({ durationMs, start, end }: { durationMs: number; start: number; end: number }) => ({ durationMs, start, end })),
    document.spots.map(({ durationMs, start, end }: { durationMs: number; start: number; end: number }) => ({ durationMs, start, end })),
  );
});

test("reflow changes final spots without changing the extracted document or fixed semantics", () => {
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
  assert.ok(wide.spots.length < narrow.spots.length);
});

test("reflow builds every Spot context through the bulk engine operation", () => {
  const source = "一文目です。二文目です。三文目です。";
  let bulkContextBuilds = 0;
  const engine = {
    ...Engine,
    buildSurroundingSentenceContexts(spots: unknown[]) {
      bulkContextBuilds += 1;
      return Engine.buildSurroundingSentenceContexts(spots);
    },
    surroundingSentences() {
      throw new Error("reflow must not rebuild the document context for each Spot");
    },
  };

  const document = prepareReaderDocument(content(source), engine, {
    maxWidth: 20,
    measureText: graphemeCount,
  });

  assert.equal(bulkContextBuilds, 1);
  assert.deepEqual(document.spotContexts, [
    { previous: "", next: "二文目です。" },
    { previous: "一文目です。", next: "三文目です。" },
    { previous: "二文目です。", next: "" },
  ]);
});

test("presentReader selects the spot and progress only from ReaderSession state", () => {
  const source = "一文目です。二文目です。三文目です。";
  const document = prepareReaderDocument(content(source), Engine, {
    maxWidth: 20,
    measureText: graphemeCount,
  });
  const spotIndex = 1;
  const flowIndex = document.flow.findIndex((item: { kind: string; spotIndex?: number }) => (
    item.kind === "spot" && item.spotIndex === spotIndex
  ));
  const spot = document.spots[spotIndex];
  const session: ReaderSessionState = {
    phase: "reading",
    mode: "spots",
    playback: "paused",
    flowIndex,
    flowLength: document.flow.length,
    generation: 1,
    sourceOffset: spot.start,
    currentKind: "spot",
    requestId: "request-1",
    timerPending: false,
    position: { kind: "text", sourceOffset: spot.start },
    spotIndex,
    figureIndex: null,
  };

  const screen = presentReader(document, session, ui);
  assert.equal(screen.kind, "spot");
  if (screen.kind !== "spot") return;
  assert.strictEqual(screen.spot, spot);
  assert.equal(screen.previous, "一文目です。");
  assert.equal(screen.next, "三文目です。");
});
