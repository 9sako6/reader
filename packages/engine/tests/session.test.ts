export {};

const assert = require("node:assert/strict");
const {
  findUnitIndex,
  findPreviousSentenceStart,
  surroundingSentences,
  displayDuration,
  sourceOffsetAtViewportCenter,
  findBlockIndexForOffset,
  segmentText,
  buildReadingFlow,
  findFlowIndexForPosition,
  positionForFlowItem,
} = require("../../../.build/packages/engine/src/engine.js");

const units = [
  { text: "最初です。", start: 0, end: 5, sentenceIndex: 0 },
  { text: "次の", start: 5, end: 7, sentenceIndex: 1 },
  { text: "文章です。", start: 7, end: 12, sentenceIndex: 1 },
  { text: "最後です。", start: 12, end: 17, sentenceIndex: 2 },
];

test("source offsets map to RSVP units", () => {
  assert.equal(findUnitIndex(units, 0), 0);
  assert.equal(findUnitIndex(units, 6), 1);
  assert.equal(findUnitIndex(units, 99), 3);
  assert.equal(findUnitIndex([], 10), 0);
});

test("surrounding sentence context stays stable within a sentence", () => {
  assert.deepEqual(surroundingSentences(units, 1), {
    previous: "最初です。",
    next: "最後です。",
  });
  assert.deepEqual(surroundingSentences(units, 2), {
    previous: "最初です。",
    next: "最後です。",
  });
  assert.deepEqual(surroundingSentences(units, 0), { previous: "", next: "次の文章です。" });
});

test("previous sentence lookup advances one quoted sentence at a time", () => {
  const source = "「一文目です。二文目です。」次の文です。";
  const segmented = segmentText(source, "ja");
  assert.deepEqual(segmented.map((unit) => unit.sentenceIndex), [0, 1, 2]);
  assert.equal(findPreviousSentenceStart(segmented, 2), 1);
  assert.equal(findPreviousSentenceStart(segmented, 1), 0);
});

test("surrounding sentence context keeps a quote and its following sentence separate", () => {
  const segmented = segmentText("前文です。「引用です。」次文です。", "ja");
  assert.deepEqual(surroundingSentences(segmented, 1), {
    previous: "前文です。",
    next: "次文です。",
  });
  assert.deepEqual(surroundingSentences(segmented, 2), {
    previous: "「引用です。」",
    next: "",
  });
});

test("display duration accounts for punctuation and section changes", () => {
  const sameSentence = { text: "次です", sentenceIndex: 0 };
  const nextSentence = { text: "次です", sentenceIndex: 1 };
  assert.equal(displayDuration({ text: "短い、", sentenceIndex: 0 }, sameSentence), 372);
  assert.equal(displayDuration({ text: "短い。", sentenceIndex: 0 }, nextSentence), 612);
  assert.equal(displayDuration({ text: "短い。", sentenceIndex: 0 }, nextSentence, true), 852);
});

test("normal reading position uses the source offset at the viewport center", () => {
  const blocks = [
    { top: 100, bottom: 300, start: 0, end: 100 },
    { top: 340, bottom: 540, start: 101, end: 201 },
  ];
  assert.equal(sourceOffsetAtViewportCenter(blocks, 200), 50);
  assert.equal(sourceOffsetAtViewportCenter(blocks, 320), 100);
  assert.equal(sourceOffsetAtViewportCenter(blocks, 440), 151);
});

test("source offsets map back to semantic text blocks", () => {
  const blocks = [
    { start: 0, end: 100 },
    { start: 101, end: 201 },
  ];
  assert.equal(findBlockIndexForOffset(blocks, 50), 0);
  assert.equal(findBlockIndexForOffset(blocks, 150), 1);
  assert.equal(findBlockIndexForOffset(blocks, 999), 1);
  assert.equal(findBlockIndexForOffset([], 10), -1);
});

test("reading flow orders text and figures by source offset without mutating inputs", () => {
  const units = [
    { text: "先頭", start: 0, end: 2, sentenceIndex: 0, kind: "body" },
    { text: "中央", start: 10, end: 12, sentenceIndex: 1, kind: "body" },
    { text: "末尾", start: 20, end: 22, sentenceIndex: 2, kind: "body" },
  ];
  const figures = [
    { src: "first", alt: "", caption: "", sourceOffset: 10, sourceEnd: 10 },
    { src: "same", alt: "", caption: "", sourceOffset: 10, sourceEnd: 10 },
    { src: "before", alt: "", caption: "", sourceOffset: 0, sourceEnd: 0 },
    { src: "last", alt: "", caption: "", sourceOffset: 22, sourceEnd: 22 },
  ];
  const originalUnitOrder = units.map((unit) => unit.start);
  const originalFigureOrder = figures.map((figure) => figure.src);

  const flow = buildReadingFlow(units, figures);

  assert.deepEqual(flow, [
    { kind: "figure", sourceOffset: 0, figureIndex: 2 },
    { kind: "unit", sourceOffset: 0, unitIndex: 0 },
    { kind: "figure", sourceOffset: 10, figureIndex: 0 },
    { kind: "figure", sourceOffset: 10, figureIndex: 1 },
    { kind: "unit", sourceOffset: 10, unitIndex: 1 },
    { kind: "unit", sourceOffset: 20, unitIndex: 2 },
    { kind: "figure", sourceOffset: 22, figureIndex: 3 },
  ]);
  assert.deepEqual(units.map((unit) => unit.start), originalUnitOrder);
  assert.deepEqual(figures.map((figure) => figure.src), originalFigureOrder);
  assert.ok(flow.every((item, index) => index === 0 || item.sourceOffset >= flow[index - 1].sourceOffset));
});

test("reading positions round-trip through text and figure flow items", () => {
  const units = [
    { text: "最初", start: 0, end: 2, sentenceIndex: 0, kind: "body" },
    { text: "次", start: 5, end: 6, sentenceIndex: 1, kind: "body" },
    { text: "最後", start: 12, end: 14, sentenceIndex: 2, kind: "body" },
  ];
  const figures = [
    { src: "figure-a", alt: "", caption: "", sourceOffset: 5, sourceEnd: 5 },
    { src: "figure-b", alt: "", caption: "", sourceOffset: 5, sourceEnd: 5 },
  ];
  const flow = buildReadingFlow(units, figures);
  const figurePosition = { kind: "figure", sourceOffset: 5, figureIndex: 1 };
  const figureFlowIndex = findFlowIndexForPosition(flow, units, figurePosition);
  assert.equal(figureFlowIndex, 2);
  assert.deepEqual(positionForFlowItem(flow[figureFlowIndex], units), figurePosition);

  const textPosition = { kind: "text", sourceOffset: 5 };
  const textFlowIndex = findFlowIndexForPosition(flow, units, textPosition);
  assert.equal(flow[textFlowIndex].kind, "unit");
  assert.deepEqual(positionForFlowItem(flow[textFlowIndex], units), textPosition);

  const missingFigurePosition = { kind: "figure", sourceOffset: 7, figureIndex: 99 };
  const fallbackIndex = findFlowIndexForPosition(flow, units, missingFigurePosition);
  assert.equal(flow[fallbackIndex].kind, "unit");
  assert.equal(flow[fallbackIndex].unitIndex, 1);
});
