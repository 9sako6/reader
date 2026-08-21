const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { extractPage } = require("../page-extractor.js");

test("vendored Defuddle bundle exposes its browser constructor", () => {
  const context = {};
  context.self = context;
  const source = fs.readFileSync(
    path.join(__dirname, "..", "vendor", "defuddle", "defuddle.js"),
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

test("extractPage keeps only figures referenced by the article text", () => {
  const caption = { textContent: "図1 処理時間" };
  const figure = {
    querySelector(selector) {
      return selector === "figcaption" ? caption : null;
    },
  };
  const referencedImage = {
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
      if (selector === "img") return [referencedImage, decorativeImage];
      return [];
    },
  };
  const rawText = "この結果を図1に示します。\n図1 処理時間\n次の説明です。";
  const prefixes = new Map([
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
      src: "https://example.com/chart.png",
      alt: "処理時間の比較グラフ",
      caption: "図1 処理時間",
      referenceSentence: "この結果を図1に示します。",
      referenceEnd: "この結果を図1に示します。".length,
    },
  ]);
});

test("extractPage returns no content when the page body is unavailable", () => {
  assert.equal(extractPage({ querySelector() { return null; }, body: null }), null);
});
