export {};

const assert = require("node:assert/strict");

const {
  MAX_GRAPHEMES_PER_UNIT,
  segmentText,
  splitLongUnits,
  preserveCodeRanges,
  splitSentenceSpans,
  findActiveHeadingIndex,
  calculateReadingProgress,
} = require("../../../.build/packages/engine/src/engine.js");

test("a long inline code expression remains one scrollable RSVP unit", () => {
  const source = "Use extraordinarily_long_identifier.withNamespace() before continuing.";
  const code = "extraordinarily_long_identifier.withNamespace()";
  const start = source.indexOf(code);
  const segmented = segmentText(source, "en", [start, start + code.length]);

  const units = splitLongUnits(
    preserveCodeRanges(segmented, source, [{ text: code, start, end: start + code.length }]),
    "en",
    6,
  );

  const codeUnits = units.filter((unit) => unit.kind === "code");
  assert.deepEqual(codeUnits, [{
    text: "extraordinarily_long_identifier.withNamespace()",
    sentenceIndex: 0,
    kind: "code",
    start: 4,
    end: 51,
  }]);
});

test("segmentText preserves the selected source text and offsets", () => {
  const source = "Redisを利用して排他制御を実現する場合（ただし、一部は別処理です）。";
  const units = segmentText(source);

  assert.ok(units.length > 0);
  assert.equal(units.map((unit) => unit.text).join(""), source);
  for (const unit of units) assert.equal(source.slice(unit.start, unit.end), unit.text);
});

test("fallback segmentation keeps existing Japanese phrase behavior", () => {
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

test("splitLongUnits caps unbroken text and preserves grapheme and source offsets", () => {
  const cases = [
    { name: "English word", source: "Supercalifragilisticexpialidocious" },
    { name: "alphanumeric token", source: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
    { name: "URL", source: "https://example.com/path/to/a/very/long/resource?token=abcdefghijklmnopqrstuvwxyz0123456789" },
    { name: "UUID", source: "550e8400-e29b-41d4-a716-446655440000" },
    {
      name: "emoji and combining marks",
      source: "👨‍👩‍👧‍👦🇯🇵e\u0301👨‍👩‍👧‍👦🇯🇵e\u0301👨‍👩‍👧‍👦🇯🇵e\u0301👨‍👩‍👧‍👦🇯🇵e\u0301👨‍👩‍👧‍👦🇯🇵e\u0301",
    },
  ];

  for (const { name, source } of cases) {
    for (const limit of [3, 6, 12]) {
      const sourceWithPrefix = `prefix:${source}:suffix`;
      const sourceStart = "prefix:".length;
      const unit = {
        text: source,
        sentenceIndex: 4,
        kind: "body",
        start: sourceStart,
        end: sourceStart + source.length,
      };
      const units = splitLongUnits([unit], "ja", limit);
      const graphemeCount = (text: string) => [
        ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text),
      ].length;

      assert.equal(units.map((item) => item.text).join(""), source, `${name} at ${limit}`);
      assert.ok(
        units.every((item) => graphemeCount(item.text) <= limit),
        `${name} exceeds ${limit} graphemes`,
      );
      for (const item of units) assert.equal(sourceWithPrefix.slice(item.start, item.end), item.text);
    }
  }
});

test("splitLongUnits adjusts Japanese punctuation without breaking the grapheme limit", () => {
  const cases = [
    { source: "あいう）えお", expected: ["あい", "う）え", "お"] },
    { source: "abcdef）ghij", expected: ["abc", "de", "f）", "ghi", "j"] },
    { source: "あい（うえお", expected: ["あい", "（うえ", "お"] },
  ];

  for (const { source, expected } of cases) {
    const sourceWithPrefix = `prefix:${source}:suffix`;
    const sourceStart = "prefix:".length;
    const units = splitLongUnits([{
      text: source,
      sentenceIndex: 0,
      kind: "body",
      start: sourceStart,
      end: sourceStart + source.length,
    }], "ja", 3);

    assert.deepEqual(units.map((unit) => unit.text), expected);
    assert.equal(units.map((unit) => unit.text).join(""), source);
    assert.ok(units.every((unit) => [
      ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(unit.text),
    ].length <= 3));
    for (const unit of units) assert.equal(sourceWithPrefix.slice(unit.start, unit.end), unit.text);
  }
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

test("segmentText assigns sentence indices in order", () => {
  const units = segmentText("一文目です。二文目です。三文目です。");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 2]);
});

test("sentence spans move a leading opener to the following sentence", () => {
  const source = "前文です。「引用です。」次文です。";
  assert.deepEqual(splitSentenceSpans(source, "ja"), [
    { start: 0, end: 5, sentenceIndex: 0 },
    { start: 5, end: 12, sentenceIndex: 1 },
    { start: 12, end: 17, sentenceIndex: 2 },
  ]);
  const units = segmentText(source, "ja");
  assert.deepEqual(units.map((unit) => unit.text), ["前文です。", "「引用です。」", "次文です。"]);
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 2]);
  assert.deepEqual(units.map((unit) => [unit.start, unit.end]), [[0, 5], [5, 12], [12, 17]]);
  assert.equal(units.map((unit) => unit.text).join(""), source);
});

test("sentence boundaries inside a quote keep quote classification", () => {
  const source = "「一文目です。二文目です。」次の文です。";
  const units = segmentText(source, "ja");
  assert.deepEqual(units.map((unit) => unit.text), [
    "「一文目です。",
    "二文目です。」",
    "次の文です。",
  ]);
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 2]);
  assert.deepEqual(units.map((unit) => unit.kind), ["quote", "quote", "body"]);
  assert.equal(units.map((unit) => unit.text).join(""), source);
  for (const unit of units) assert.equal(source.slice(unit.start, unit.end), unit.text);
});

test("a quoted phrase followed by a reporting clause remains one sentence", () => {
  const source = "「引用です」と彼は言った。";
  const units = segmentText(source, "ja");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 0, 0]);
  assert.deepEqual(units.map((unit) => unit.kind), ["quote", "body", "body"]);
  assert.equal(units.map((unit) => unit.text).join(""), source);
});

test("aside sentence boundaries remain independent from structural classification", () => {
  const source = "（補足です。続きです。）本文です。";
  const units = segmentText(source, "ja");
  assert.deepEqual(units.map((unit) => unit.text), [
    "（補足です。",
    "続きです。）",
    "本文です。",
  ]);
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 2]);
  assert.deepEqual(units.map((unit) => unit.kind), ["aside", "aside", "body"]);
  assert.equal(units.map((unit) => unit.text).join(""), source);
});

test("English sentence spans retain Intl.Segmenter boundaries for decimals and URLs", () => {
  const cases = [
    {
      source: "Mr. Smith wrote v1.2. Next sentence.",
      expectedSentenceSpans: [
        { start: 0, end: 4, sentenceIndex: 0 },
        { start: 4, end: 22, sentenceIndex: 1 },
        { start: 22, end: 36, sentenceIndex: 2 },
      ],
      expectedSentenceIndexes: [0, 1, 2],
    },
    {
      source: "The value is 3.14. Continue.",
      expectedSentenceSpans: [
        { start: 0, end: 19, sentenceIndex: 0 },
        { start: 19, end: 28, sentenceIndex: 1 },
      ],
      expectedSentenceIndexes: [0, 1],
    },
    {
      source: "Visit https://example.com/test. Continue.",
      expectedSentenceSpans: [
        { start: 0, end: 32, sentenceIndex: 0 },
        { start: 32, end: 41, sentenceIndex: 1 },
      ],
      expectedSentenceIndexes: [0, 1],
    },
  ];
  for (const { source, expectedSentenceSpans, expectedSentenceIndexes } of cases) {
    const units = segmentText(source, "en");
    assert.deepEqual(splitSentenceSpans(source, "en"), expectedSentenceSpans);
    assert.equal(units.map((unit) => unit.text).join(""), source);
    for (const unit of units) assert.equal(source.slice(unit.start, unit.end), unit.text);
    assert.deepEqual([...new Set(units.map((unit) => unit.sentenceIndex))], expectedSentenceIndexes);
  }
});

test("segmentText treats English periods as sentence boundaries", () => {
  const units = segmentText("First sentence. Second sentence. Third sentence.", "en");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 0, 1, 1, 2, 2]);
  assert.equal(units[2].text, " Second ");
});

test("segmentText starts a new sentence after a block boundary", () => {
  const units = segmentText("Transcript\nFirst, a quick intro.", "en");
  assert.deepEqual(units.map((unit) => unit.sentenceIndex), [0, 1, 1]);
  assert.equal(units[1].text, "First, a ");
});

test("segmentText never crosses a supplied content boundary", () => {
  const source = "画像前の文章と画像後の文章です。";
  const boundary = source.indexOf("画像後");
  const units = segmentText(source, "ja", [boundary]);

  assert.equal(units.map((unit) => unit.text).join(""), source);
  assert.ok(units.every((unit) => unit.end <= boundary || unit.start >= boundary));
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
