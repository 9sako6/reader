export {};

const assert = require("node:assert/strict");

const {
  MAX_WORDS_PER_UNIT,
  MAX_GRAPHEMES_PER_UNIT,
  segmentText,
  splitStructuralSpans,
  findSentenceStart,
  findPreviousSentenceStart,
  findActiveHeadingIndex,
  calculateReadingProgress,
} = require("../../../.build/packages/engine/src/engine.js");

test("segmentText preserves the selected source text and offsets", () => {
  const source = "Redisを利用して排他制御を実現する場合（ただし、一部は別処理です）。";
  const units = segmentText(source);

  assert.ok(units.length > 0);
  assert.equal(units.map((unit) => unit.text).join(""), source);
  for (const unit of units) assert.equal(source.slice(unit.start, unit.end), unit.text);
});

test("fallback segmentation keeps existing Japanese phrase behavior", () => {
  assert.equal(MAX_WORDS_PER_UNIT, 7);
  assert.deepEqual(
    segmentText("Redisを利用して排他制御を実現する場合").map((unit) => unit.text),
    ["Redisを利用して", "排他制御を", "実現する場合"],
  );
});

test("segmentText is deterministic regardless of legacy morphology input", () => {
  const source = "これは非常に重要であり慎重に扱う必要があります";
  const tokens = [
    { surface: "これ", pos: "代名詞" },
    { surface: "は", pos: "助詞,係助詞" },
    { surface: "非常", pos: "形状詞" },
    { surface: "に", pos: "助動詞" },
    { surface: "重要", pos: "形状詞" },
    { surface: "で", pos: "助動詞" },
    { surface: "あり", pos: "動詞" },
    { surface: "慎重", pos: "形状詞" },
    { surface: "に", pos: "助動詞" },
    { surface: "扱う", pos: "動詞" },
    { surface: "必要", pos: "名詞" },
    { surface: "が", pos: "助詞,格助詞" },
    { surface: "あり", pos: "動詞" },
    { surface: "ます", pos: "助動詞" },
  ];

  assert.deepEqual(segmentText(source, "ja", tokens).map((unit) => unit.text), [
    "これは非常に",
    "重要であり慎重に",
    "扱う必要が",
    "あります",
  ]);
  assert.deepEqual(segmentText(source).map((unit) => unit.text), [
    "これは非常に",
    "重要であり慎重に",
    "扱う必要が",
    "あります",
  ]);
});

test("every RSVP unit is capped to avoid line wrapping", () => {
  assert.equal(MAX_GRAPHEMES_PER_UNIT, 12);
  assert.deepEqual(
    segmentText("非常に長い技術文章のまとまりをそのまま表示して改行が起きないようにする。").map(
      (unit) => unit.text,
    ),
    [
      "非常に長い技術文章の",
      "まとまり",
      "をそのまま表示して",
      "改行が起きないように",
      "する。",
    ],
  );
});

test("long units split at word boundaries without breaking katakana words", () => {
  assert.deepEqual(
    segmentText("ソフトウェアエンジニアリング").map((unit) => unit.text),
    ["ソフトウェア", "エンジニアリング"],
  );
  assert.deepEqual(
    segmentText("ソフトウェア開発ライフサイクル").map((unit) => unit.text),
    ["ソフトウェア開発", "ライフサイクル"],
  );
});

test("long Japanese corner-bracket quotes are split without losing quote styling", () => {
  const units = segmentText("「これはとても長い引用なので一度では表示せず注視点を固定したまま分割する」");
  assert.deepEqual(units.map((unit) => unit.text), [
    "「これはとても長い引用",
    "なので一度では表示せず注",
    "視点を固定したまま分割",
    "する」",
  ]);
  assert.deepEqual(units.map((unit) => unit.kind), ["quote", "quote", "quote", "quote"]);
});

test("short Japanese corner brackets stay together as a quote unit", () => {
  const units = segmentText("「排他制御」と呼ぶ。");
  assert.equal(units[0].text, "「排他制御」");
  assert.equal(units[0].kind, "quote");
});

test("parenthetical text is marked as aside", () => {
  const units = segmentText("本文です（ただし、一部は例外です）。");
  assert.deepEqual(units.map((unit) => unit.kind), ["body", "aside", "aside"]);
  assert.deepEqual(units.map((unit) => unit.text), ["本文です", "（ただし、", "一部は例外です）。"]);
});

test("splitStructuralSpans identifies body, quote, and aside", () => {
  assert.deepEqual(
    splitStructuralSpans("前「引用」後（補足）").map((span) => span.kind),
    ["body", "quote", "body", "aside"],
  );
});

test("segmentText assigns sentence indices in order", () => {
  const units = segmentText("一文目です。二文目です。三文目です。");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 2]);
});

test("segmentText treats English periods as sentence boundaries", () => {
  const units = segmentText("First sentence. Second sentence. Third sentence.", "en");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 0, 1, 1, 2, 2]);
  assert.equal(findSentenceStart(units, 3), 2);
  assert.equal(units[2].text, " Second ");
});

test("segmentText starts a new sentence after a block boundary", () => {
  const units = segmentText("Transcript\nFirst, a quick intro.", "en");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 1]);
  assert.equal(findSentenceStart(units, 2), 1);
  assert.equal(units[1].text, "First, a ");
});

test("segmentText never crosses a supplied content boundary", () => {
  const source = "画像前の文章と画像後の文章です。";
  const boundary = source.indexOf("画像後");
  const units = segmentText(source, "ja", [boundary]);

  assert.equal(units.map((unit) => unit.text).join(""), source);
  assert.ok(units.every((unit) => unit.end <= boundary || unit.start >= boundary));
});

test("findSentenceStart keeps the sentence immediately before an image", () => {
  const units = segmentText(
    "最初の文です。画像直前にある非常に長い文で複数の表示単位に分かれます。画像後です。",
  );
  assert.equal(findSentenceStart(units, 5), 1);
});

test("findPreviousSentenceStart moves to previous sentence", () => {
  const units = segmentText("最初の文です。次の文です。最後の文です。");
  assert.equal(findPreviousSentenceStart(units, 2), 1);
});

test("findActiveHeadingIndex follows section transitions", () => {
  const transitions = [
    { offset: 10, headingIndex: 2 },
    { offset: 30, headingIndex: 3 },
  ];
  assert.equal(findActiveHeadingIndex(transitions, 5, 1), 1);
  assert.equal(findActiveHeadingIndex(transitions, 10, 1), 2);
  assert.equal(findActiveHeadingIndex(transitions, 42, 1), 3);
});

test("calculateReadingProgress clamps selection offsets to a percentage", () => {
  assert.equal(calculateReadingProgress(0, 100), 0);
  assert.equal(calculateReadingProgress(42, 100), 42);
  assert.equal(calculateReadingProgress(120, 100), 100);
  assert.equal(calculateReadingProgress(-10, 100), 0);
  assert.equal(calculateReadingProgress(10, 0), 0);
});

test("empty text produces no units", () => {
  assert.deepEqual(segmentText(""), []);
});

test("previous sentence lookup returns the first position for no units", () => {
  assert.equal(findPreviousSentenceStart([], 0), 0);
});
