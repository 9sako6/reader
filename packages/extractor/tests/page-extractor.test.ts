export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fromPage: extractPage, fromText } = require("../../../.build/packages/extractor/src/extractor.js");

test("fromText produces the same Content contract as page extraction", () => {
  assert.deepEqual(fromText("  選択した文章  "), {
    text: "選択した文章",
    readingContext: {
      title: "",
      blocks: [],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    },
  });
  assert.equal(fromText("  "), null);
});

test("installed Defuddle bundle exposes its browser constructor", () => {
  const context: any = {};
  context.self = context;
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "node_modules", "defuddle", "dist", "index.js"),
    "utf8",
  );
  vm.runInNewContext(source, context);
  assert.equal(typeof context.Defuddle, "function");
});

test("extractPage returns article text and heading offsets", () => {
  let defuddleOptions = null;
  let readerOverlayRemoved = false;
  const title = { tagName: "H1", textContent: "記事タイトル" };
  const section = { tagName: "H2", textContent: "次の節" };
  const article = {
    querySelector(selector) {
      if (selector !== "#__rsvp-reader-root") return null;
      return {
        remove() {
          readerOverlayRemoved = true;
        },
      };
    },
    querySelectorAll() {
      return [title, section];
    },
  };
  const rawText = "  記事タイトル\n本文です。\n次の節\n続きです。  ";
  const prefixes = new Map([
    [title, "  "],
    [section, "  記事タイトル\n本文です。\n"],
  ]);
  const document = {
    body: article,
    querySelector() {
      return article;
    },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) {
          endElement = element;
        },
        toString() {
          return endElement ? prefixes.get(endElement) : rawText;
        },
      };
    },
    createElement() {
      return article;
    },
  };
  class FakeDefuddle {
    constructor(sourceDocument, options) {
      assert.equal(sourceDocument, document);
      defuddleOptions = options;
    }

    parse() {
      return { content: "<h1>記事タイトル</h1><p>本文です。</p><h2>次の節</h2><p>続きです。</p>" };
    }
  }

  assert.deepEqual(extractPage(document, FakeDefuddle), {
    text: "記事タイトル\n本文です。\n次の節\n続きです。",
    readingContext: {
      title: "記事タイトル",
      sectionOffsets: [0, 13],
      blocks: [
        { text: "記事タイトル", kind: "heading", level: 1, start: 0, end: 6 },
        { text: "次の節", kind: "heading", level: 2, start: 13, end: 16 },
      ],
      headings: [
        { text: "記事タイトル", level: 1 },
        { text: "次の節", level: 2 },
      ],
      sectionTransitions: [
        { offset: 0, headingIndex: 0 },
        { offset: 13, headingIndex: 1 },
      ],
      initialHeadingIndex: -1,
      figures: [],
    },
  });
  assert.equal(defuddleOptions.useAsync, false);
  assert.equal(defuddleOptions.removeExactSelectors, true);
  assert.equal(defuddleOptions.removeLowScoring, true);
  assert.equal(defuddleOptions.removeImages, false);
  assert.equal(readerOverlayRemoved, true);
});

test("extractPage keeps every article image at its source offset", () => {
  const caption = { textContent: "図1 処理時間" };
  const figure = {
    querySelector(selector) {
      return selector === "figcaption" ? caption : null;
    },
  };
  const chartImage = {
    currentSrc: "https://example.com/chart.png",
    src: "https://example.com/chart.png",
    naturalWidth: 1200,
    naturalHeight: 800,
    closest() {
      return figure;
    },
    getAttribute(name) {
      return name === "alt" ? "処理時間の比較グラフ" : null;
    },
  };
  const decorativeImage = {
    currentSrc: "https://example.com/hero.png",
    src: "https://example.com/hero.png",
    naturalWidth: 1600,
    naturalHeight: 900,
    closest() {
      return null;
    },
    getAttribute() {
      return "装飾画像";
    },
  };
  const article = {
    querySelectorAll(selector) {
      if (selector === "img") return [chartImage, decorativeImage];
      return [];
    },
  };
  const rawText = "この結果を図1に示します。\n図1 処理時間\n次の説明です。";
  const prefixes = new Map<any, string>([
    [figure, "この結果を図1に示します。\n"],
    [decorativeImage, ""],
  ]);
  const document = {
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) {
          endElement = element;
        },
        toString() {
          return endElement ? prefixes.get(endElement) : rawText;
        },
      };
    },
    createElement() {
      return article;
    },
  };
  class FakeDefuddle {
    parse() {
      return { content: "<p>この結果を図1に示します。</p><figure></figure><p>次の説明です。</p>" };
    }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.deepEqual(result.readingContext.figures, [
    {
      src: "https://example.com/hero.png",
      alt: "装飾画像",
      caption: "",
      sourceOffset: 0,
      sourceEnd: 0,
    },
    {
      src: "https://example.com/chart.png",
      alt: "処理時間の比較グラフ",
      caption: "図1 処理時間",
      sourceOffset: "この結果を図1に示します。\n".length,
      sourceEnd: "この結果を図1に示します。\n図1 処理時間".length,
    },
  ]);
});

test("extractPage returns no content when the page body is unavailable", () => {
  assert.equal(extractPage({ querySelector() { return null; }, body: null }), null);
});

test("extractPage does not duplicate blocks nested in quotes or list items", () => {
  const quote = { tagName: "BLOCKQUOTE", textContent: "引用文" };
  const paragraph = {
    tagName: "P",
    textContent: "引用文",
    parentElement: { closest() { return quote; } },
  };
  const article = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6") return [];
      return [quote, paragraph];
    },
  };
  const document = {
    createElement() { return article; },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) { endElement = element; },
        toString() { return endElement ? "" : "引用文"; },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: "<blockquote><p>引用文</p></blockquote>" }; }
  }

  assert.deepEqual(extractPage(document, FakeDefuddle).readingContext.blocks, [
    { text: "引用文", kind: "quote", level: null, start: 0, end: 3 },
  ]);
});
