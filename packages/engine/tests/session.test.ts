export {};

const assert = require("node:assert/strict");
const {
  findUnitIndex,
  surroundingSentences,
  displayDuration,
  sourceOffsetAtViewportCenter,
  findBlockIndexForOffset,
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
