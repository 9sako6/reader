const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { extractPage } = require("../packages/web-reader/src/page-extractor.js");

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
      title: "記事タイトル",
      sectionOffsets: [0, 13],
      blocks: [
        { text: "記事タイトル", kind: "heading", level: 1, start: 0, end: 6 },
        { text: "次の節", kind: "heading", level: 2, start: 13, end: 16 },
      ],
    },
  });
  assert.equal(defuddleOptions.useAsync, false);
  assert.equal(defuddleOptions.removeExactSelectors, true);
  assert.equal(defuddleOptions.removeLowScoring, true);
  assert.equal(defuddleOptions.removeImages, true);
  assert.equal(readerOverlayRemoved, true);
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
