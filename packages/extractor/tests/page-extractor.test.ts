export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  fromPage: extractPage,
  fromPageAsync: extractPageAsync,
  fromText,
} = require("../../../.build/packages/extractor/src/extractor.js");

function createLanguagePageFixture(language) {
  const paragraphText = "ページ本文です。";
  const textNode = { nodeType: 3, nodeValue: paragraphText, childNodes: [] };
  const paragraph = {
    nodeType: 1,
    tagName: "P",
    textContent: paragraphText,
    childNodes: [textNode],
    parentElement: { closest() { return null; } },
  };
  const contentRoot = {
    nodeType: 11,
    childNodes: [paragraph],
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6" || selector === "img") return [];
      return [paragraph];
    },
  };
  const template = { content: contentRoot, innerHTML: "" };
  const document = {
    documentElement: { lang: language },
    createElement(tagName) {
      return tagName === "template" ? template : contentRoot;
    },
    createRange() {
      return {
        selectNodeContents() {},
        setEndBefore() {},
        toString() { return paragraphText; },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: `<p>${paragraphText}</p>` }; }
  }
  return { document, Defuddle: FakeDefuddle };
}

function createTextNode(value) {
  return { nodeType: 3, nodeValue: value, childNodes: [], textContent: value };
}

function selectorMatches(element, selector) {
  return selector
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .includes(String(element.tagName || "").toUpperCase());
}

function createElementNode(tagName, children = [], attributes: any = {}) {
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    parentElement: null,
    currentSrc: attributes.currentSrc,
    src: attributes.src,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const descendants = [];
      const visit = (candidate) => {
        for (const child of candidate.childNodes || []) {
          if (child.nodeType !== 3) {
            if (selectorMatches(child, selector)) descendants.push(child);
            visit(child);
          }
        }
      };
      visit(this);
      return descendants;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (selectorMatches(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
  };
  for (const child of children) child.parentElement = node;
  Object.defineProperty(node, "textContent", {
    get() {
      return children.map((child) => child.nodeType === 3 ? child.nodeValue : child.textContent || "").join("");
    },
  });
  return node;
}

function createFixturePage(children) {
  const root = createElementNode("ROOT", children);
  const stats = { rangeCalls: 0 };
  const document = {
    createElement() {
      return root;
    },
    createRange() {
      stats.rangeCalls += 1;
      throw new Error("unexpected Range fallback");
    },
  };
  class FakeDefuddle {
    parse() {
      return { content: "<fixture></fixture>" };
    }
  }
  return { document, Defuddle: FakeDefuddle, stats };
}

function assertReaderContentRanges(content) {
  for (const block of content.readingContext.blocks) {
    assert.ok(0 <= block.start && block.start <= block.end);
    assert.ok(block.end <= content.text.length);
    assert.equal(content.text.slice(block.start, block.end), block.text);
  }

  for (const figure of content.readingContext.figures) {
    assert.ok(0 <= figure.sourceOffset);
    assert.ok(figure.sourceOffset <= figure.sourceEnd);
    assert.ok(figure.sourceEnd <= content.text.length);
  }

  assert.deepEqual(
    [...content.readingContext.sectionOffsets].sort((left, right) => left - right),
    content.readingContext.sectionOffsets,
  );
}

test("fromText produces the same Content contract as page extraction", () => {
  assert.deepEqual(fromText("  選択した文章  "), {
    text: "選択した文章",
    readingContext: {
      language: "ja",
      title: "",
      blocks: [],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    },
  });
});

test("fromText returns no content for whitespace", () => {
  assert.equal(fromText("  "), null);
});

test("fromText keeps a valid BCP 47-like language and rejects empty or malformed values", () => {
  assert.equal(fromText("本文", { language: "en-US" }).readingContext.language, "en-US");
  assert.equal(fromText("本文", { language: "  " }).readingContext.language, "ja");
  assert.equal(fromText("本文", { language: "not a language" }).readingContext.language, "ja");
});

test("extractPage keeps a br inside a block in the canonical source range", () => {
  const paragraph = createElementNode("p", [
    createTextNode("foo"),
    createElementNode("br"),
    createTextNode("bar"),
  ]);
  const { document, Defuddle, stats } = createFixturePage([paragraph]);

  const result = extractPage(document, Defuddle);

  assert.equal(result.text, "foo\nbar");
  assert.deepEqual(result.readingContext.blocks, [
    { text: "foo\nbar", kind: "paragraph", level: null, start: 0, end: 7 },
  ]);
  assert.equal(stats.rangeCalls, 0);
  assertReaderContentRanges(result);
});

test("extractPage shares canonical ranges across nested blocks and figures", () => {
  const firstParagraph = createElementNode("p", [
    createTextNode("foo"),
    createElementNode("br"),
    createTextNode("bar"),
  ]);
  const repeatedBreakParagraph = createElementNode("p", [
    createTextNode("foo"),
    createElementNode("br"),
    createElementNode("br"),
    createTextNode("bar"),
  ]);
  const inlineParagraph = createElementNode("p", [
    createTextNode("前"),
    createElementNode("strong", [createTextNode("強調")]),
    createTextNode("後"),
  ]);
  const quote = createElementNode("blockquote", [
    createElementNode("p", [
      createTextNode("引用"),
      createElementNode("br"),
      createTextNode("続き"),
    ]),
  ]);
  const list = createElementNode("ul", [
    createElementNode("li", [createElementNode("p", [createTextNode("項目")])]),
  ]);
  const preformatted = createElementNode("pre", [createTextNode("line 1\n  line 2")]);
  const table = createElementNode("table", [
    createElementNode("tr", [
      createElementNode("td", [createTextNode("セル1")]),
      createElementNode("td", [createTextNode("セル2")]),
    ]),
  ]);
  const caption = createElementNode("figcaption", [
    createTextNode("図1"),
    createElementNode("br"),
    createTextNode("続き"),
  ]);
  const captionFigure = createElementNode("figure", [
    createElementNode("img", [], {
      currentSrc: "https://example.com/caption.png",
      src: "https://example.com/caption.png",
      srcset: "https://example.com/caption-2x.png 2x",
      sizes: "(max-width: 600px) 100vw, 600px",
      width: "1200",
      height: "800",
      alt: "キャプション画像",
    }),
    caption,
  ]);
  const imageOnlyFigure = createElementNode("figure", [
    createElementNode("img", [], {
      currentSrc: "https://example.com/only.png",
      src: "https://example.com/only.png",
      alt: "本文画像",
    }),
  ]);
  const { document, Defuddle, stats } = createFixturePage([
    createTextNode(" \n"),
    firstParagraph,
    repeatedBreakParagraph,
    inlineParagraph,
    quote,
    list,
    preformatted,
    table,
    captionFigure,
    imageOnlyFigure,
    createTextNode(" \n"),
  ]);

  const result = extractPage(document, Defuddle);

  assert.equal(result.text, "foo\nbar\nfoo\nbar\n前強調後\n引用\n続き\n項目\nline 1\n  line 2\nセル1セル2\n図1\n続き");
  assert.deepEqual(result.readingContext.blocks, [
    { text: "foo\nbar", kind: "paragraph", level: null, start: 0, end: 7 },
    { text: "foo\nbar", kind: "paragraph", level: null, start: 8, end: 15 },
    { text: "前強調後", kind: "paragraph", level: null, start: 16, end: 20 },
    { text: "引用\n続き", kind: "quote", level: null, start: 21, end: 26 },
    { text: "項目", kind: "paragraph", level: null, start: 27, end: 29 },
    { text: "line 1\n  line 2", kind: "preformatted", level: null, start: 30, end: 45 },
  ]);
  assert.deepEqual(result.readingContext.figures, [
    {
      src: "https://example.com/caption.png",
      srcset: "https://example.com/caption-2x.png 2x",
      sizes: "(max-width: 600px) 100vw, 600px",
      width: 1200,
      height: 800,
      alt: "キャプション画像",
      caption: "図1続き",
      sourceOffset: 53,
      sourceEnd: 58,
    },
    {
      src: "https://example.com/only.png",
      alt: "本文画像",
      caption: "",
      sourceOffset: 58,
      sourceEnd: 58,
    },
  ]);
  assert.equal(result.text.slice(53, 58), "図1\n続き");
  assert.equal(stats.rangeCalls, 0);
  assertReaderContentRanges(result);
});

test("extractPage uses the indexed heading range for section offsets", () => {
  const heading = createElementNode("h2", [createTextNode("見出し")]);
  const paragraph = createElementNode("p", [createTextNode("本文")]);
  const { document, Defuddle, stats } = createFixturePage([
    createTextNode(" \n"),
    heading,
    paragraph,
    createTextNode(" \n"),
  ]);

  const result = extractPage(document, Defuddle);

  assert.equal(result.text, "見出し\n本文");
  assert.deepEqual(result.readingContext.sectionOffsets, [0]);
  assert.deepEqual(result.readingContext.sectionTransitions, [{ offset: 0, headingIndex: 0 }]);
  assert.deepEqual(result.readingContext.blocks, [
    { text: "見出し", kind: "heading", level: 2, start: 0, end: 3 },
    { text: "本文", kind: "paragraph", level: null, start: 4, end: 6 },
  ]);
  assert.equal(stats.rangeCalls, 0);
  assertReaderContentRanges(result);
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
  let defuddleDocument = null;
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
    documentElement: { lang: "en-US" },
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
      defuddleDocument = sourceDocument;
      defuddleOptions = options;
    }

    parse() {
      return { content: "<h1>記事タイトル</h1><p>本文です。</p><h2>次の節</h2><p>続きです。</p>" };
    }
  }

  assert.deepEqual(extractPage(document, FakeDefuddle), {
    text: "記事タイトル\n本文です。\n次の節\n続きです。",
    readingContext: {
      language: "en-US",
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
  assert.equal(defuddleDocument, document);
  assert.equal(defuddleOptions.useAsync, false);
  assert.equal(defuddleOptions.removeExactSelectors, true);
  assert.equal(defuddleOptions.removeLowScoring, true);
  assert.equal(defuddleOptions.removeImages, false);
  assert.equal(readerOverlayRemoved, true);
});

test("extractPage removes an owned reader node before considering a colliding root id", () => {
  let ownedRemoved = false;
  let collidingIdRemoved = false;
  const text = "本文です。";
  const textNode = { nodeType: 3, nodeValue: text, childNodes: [] };
  const paragraph = {
    nodeType: 1,
    tagName: "P",
    childNodes: [textNode],
    parentElement: { closest() { return null; } },
    textContent: text,
  };
  const contentRoot = {
    nodeType: 11,
    childNodes: [paragraph],
    querySelector(selector) {
      if (selector === '[data-reader-owned="true"]') {
        return { remove() { ownedRemoved = true; } };
      }
      if (selector === "#__rsvp-reader-root") {
        return { remove() { collidingIdRemoved = true; } };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6" || selector === "img") return [];
      return [paragraph];
    },
  };
  const document = {
    documentElement: { lang: "ja" },
    body: null,
    querySelectorAll() { return []; },
    createElement() { return contentRoot; },
    createRange() {
      return {
        selectNodeContents() {},
        setEndBefore() {},
        toString() { return text; },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: `<p>${text}</p>` }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.equal(result.text, text);
  assert.equal(ownedRemoved, true);
  assert.equal(collidingIdRemoved, false);
});

test("fromPage falls back to Japanese when html lang is empty", () => {
  const { document, Defuddle } = createLanguagePageFixture("");
  const result = extractPage(document, Defuddle);

  assert.equal(result.readingContext.language, "ja");
});

test("fromPage falls back to Japanese when html lang is malformed", () => {
  const { document, Defuddle } = createLanguagePageFixture("en_US");
  const result = extractPage(document, Defuddle);

  assert.equal(result.readingContext.language, "ja");
});

test("fromPageAsync reports preparation phases and keeps the page extraction contract", async () => {
  const { document, Defuddle } = createLanguagePageFixture("en-US");
  const phases = [];

  const result = await extractPageAsync(document, Defuddle, {
    onPhase(phase) {
      phases.push(phase);
    },
  });

  assert.equal(result.text, "ページ本文です。");
  assert.deepEqual(phases, [
    "dominant_article",
    "defuddle_parse",
    "canonical_text",
    "blocks_figures",
  ]);
});

test("fromPageAsync rejects with AbortError before committing a later phase", async () => {
  const { document, Defuddle } = createLanguagePageFixture("en-US");
  const controller = new AbortController();

  await assert.rejects(
    extractPageAsync(document, Defuddle, {
      onPhase(phase) {
        if (phase === "dominant_article") controller.abort();
      },
      signal: controller.signal,
    }),
    (error) => error?.name === "AbortError",
  );
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
    getAttribute(name) {
      return name === "alt" ? "装飾画像" : null;
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
      sourceOffset: 14,
      sourceEnd: 21,
    },
  ]);
});

test("extractPage keeps only positive image dimensions and optional attributes", () => {
  const images = [
    createElementNode("img", [], {
      currentSrc: "https://example.com/valid.png",
      src: "https://example.com/fallback.png",
      srcset: "valid.png 1x",
      sizes: "100vw",
      width: "640",
      height: "360",
      alt: "有効な画像",
    }),
    createElementNode("img", [], {
      src: "https://example.com/invalid.png",
      width: "0",
      height: "-10",
      alt: "不正な寸法",
    }),
  ];
  const article = {
    querySelectorAll(selector) {
      if (selector === "img") return images;
      return [];
    },
  };
  const document = {
    createElement() { return article; },
    createRange() {
      return {
        selectNodeContents() {},
        setEndBefore() {},
        toString() { return "本文"; },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: "<p>本文</p>" }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.deepEqual(result.readingContext.figures.map(({ src, srcset, sizes, width, height }) => ({
    src,
    srcset,
    sizes,
    width,
    height,
  })), [
    {
      src: "https://example.com/valid.png",
      srcset: "valid.png 1x",
      sizes: "100vw",
      width: 640,
      height: 360,
    },
    {
      src: "https://example.com/invalid.png",
      srcset: undefined,
      sizes: undefined,
      width: undefined,
      height: undefined,
    },
  ]);
});

test("extractPage preserves a sentence boundary between adjacent blocks", () => {
  const textNode = (value) => ({ nodeType: 3, nodeValue: value, childNodes: [] });
  const firstText = "First sentence.";
  const secondText = "Second sentence.";
  const first = {
    nodeType: 1,
    tagName: "P",
    textContent: firstText,
    childNodes: [textNode(firstText)],
    parentElement: { closest() { return null; } },
  };
  const second = {
    nodeType: 1,
    tagName: "P",
    textContent: secondText,
    childNodes: [textNode(secondText)],
    parentElement: { closest() { return null; } },
  };
  const contentRoot = {
    nodeType: 1,
    childNodes: [first, second],
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6" || selector === "img") return [];
      return [first, second];
    },
  };
  const document = {
    createElement() { return contentRoot; },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) { endElement = element; },
        toString() { return endElement === second ? firstText : `${firstText}${secondText}`; },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: `<p>${firstText}</p><p>${secondText}</p>` }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.equal(result.text, "First sentence.\nSecond sentence.");
  assert.equal(result.readingContext.blocks[1].start, 16);
});

test("extractPage indexes many blocks and figures without rescanning the full prefix", () => {
  const textNode = (value) => ({ nodeType: 3, nodeValue: value, childNodes: [] });
  const paragraphs = [];
  const images = [];
  const children = [];
  for (let index = 0; index < 12; index += 1) {
    const paragraphText = `段落${index}です。`;
    const paragraph = {
      nodeType: 1,
      tagName: "P",
      textContent: paragraphText,
      childNodes: [textNode(paragraphText)],
      parentElement: { closest() { return null; } },
    };
    const captionText = `図${index}`;
    const caption = {
      nodeType: 1,
      tagName: "FIGCAPTION",
      textContent: captionText,
      childNodes: [textNode(captionText)],
    };
    const figure = {
      nodeType: 1,
      tagName: "FIGURE",
      textContent: captionText,
      childNodes: [caption],
      querySelector(selector) { return selector === "figcaption" ? caption : null; },
    };
    const image = {
      currentSrc: `https://example.com/${index}.png`,
      src: `https://example.com/${index}.png`,
      closest() { return figure; },
      getAttribute(name) { return name === "alt" ? `画像${index}` : null; },
    };
    paragraphs.push(paragraph);
    images.push(image);
    children.push(paragraph, textNode("\n"), figure, textNode("\n"));
  }
  const rawText = children.map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent).join("");
  const contentRoot = {
    nodeType: 11,
    childNodes: children,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6") return [];
      if (selector === "img") return images;
      return paragraphs;
    },
  };
  const article = { ...contentRoot, nodeType: 1, innerHTML: "" };
  const template = { content: contentRoot, innerHTML: "" };
  let rangeCalls = 0;
  const document = {
    createElement(tagName) { return tagName === "template" ? template : article; },
    createRange() {
      rangeCalls += 1;
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) { endElement = element; },
        toString() {
          if (!endElement) return rawText;
          const index = children.indexOf(endElement);
          return children.slice(0, index).map((node) => (
            node.nodeType === 3 ? node.nodeValue : node.textContent
          )).join("");
        },
      };
    },
  };
  class FakeDefuddle {
    parse() { return { content: "<p>many blocks and figures</p>" }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.ok(result);
  assert.equal(result.readingContext.blocks.length, 12);
  assert.equal(result.readingContext.figures.length, 12);
  assert.equal(rangeCalls, 0);
});

test("extractPage bypasses full-page parsing for one dominant semantic article", () => {
  const paragraphText = "すぐに読み始められる本文です。";
  const paragraph = {
    tagName: "P",
    textContent: paragraphText,
    parentElement: { closest() { return null; } },
  };
  const parsedRoot = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6" || selector === "img") return [];
      return [paragraph];
    },
  };
  const longArticleText = paragraphText.repeat(80);
  const article = {
    innerHTML: `<p>${paragraphText}</p>`,
    textContent: longArticleText,
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === "p, li, blockquote, pre" ? [paragraph, paragraph, paragraph] : []; },
    cloneNode() {
      return {
        innerHTML: this.innerHTML,
        querySelector: this.querySelector,
        querySelectorAll() { return []; },
      };
    },
  };
  const rawText = paragraphText;
  const document = {
    title: "高速な記事",
    body: { textContent: `${longArticleText}サイトナビ` },
    querySelectorAll(selector) { return selector === "article" ? [article] : []; },
    createElement() { return parsedRoot; },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) { endElement = element; },
        toString() { return endElement ? "" : rawText; },
      };
    },
  };
  let defuddleCalls = 0;
  class FakeDefuddle {
    constructor() { defuddleCalls += 1; }
    parse() { return { content: article.innerHTML }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.equal(defuddleCalls, 0);
  assert.equal(result.text, paragraphText);
  assert.equal(result.readingContext.blocks[0].text, paragraphText);
});

test("extractPage excludes responsive article branches hidden by active CSS", () => {
  const paragraphText = "表示中の本文です。";
  const paragraphNode = { nodeType: 3, nodeValue: paragraphText, childNodes: [] };
  const paragraph = {
    nodeType: 1,
    tagName: "P",
    textContent: paragraphText,
    childNodes: [paragraphNode],
    parentElement: { closest() { return null; } },
  };
  const visibleImage = {
    currentSrc: "https://example.com/visible.png",
    src: "https://example.com/visible.png",
    closest() { return null; },
    getAttribute() { return "表示画像"; },
  };
  const hiddenImage = {
    currentSrc: "https://example.com/hidden.png",
    src: "https://example.com/hidden.png",
    closest() { return null; },
    getAttribute() { return "非表示画像"; },
  };
  let hiddenCloneRemoved = false;
  const parsedRoot = {
    nodeType: 1,
    childNodes: [paragraph],
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3, h4, h5, h6") return [];
      if (selector === "img") return hiddenCloneRemoved ? [visibleImage] : [visibleImage, hiddenImage];
      return [paragraph];
    },
  };
  const visibleSource = { parentElement: null };
  const hiddenSource = { parentElement: null };
  const visibleClone = { remove() {} };
  const hiddenClone = { remove() { hiddenCloneRemoved = true; } };
  const longArticleText = paragraphText.repeat(100);
  const article = {
    textContent: longArticleText,
    parentElement: { closest() { return null; } },
    querySelectorAll(selector) {
      if (selector === "p, li, blockquote, pre") return [paragraph, paragraph, paragraph];
      if (selector === "*") return [visibleSource, hiddenSource];
      return [];
    },
    cloneNode() {
      return {
        innerHTML: `<p>${paragraphText}</p>`,
        querySelector() { return null; },
        querySelectorAll(selector) {
          return selector === "*" ? [visibleClone, hiddenClone] : [];
        },
      };
    },
  };
  visibleSource.parentElement = article;
  hiddenSource.parentElement = article;
  const document = {
    title: "レスポンシブ記事",
    body: { textContent: `${longArticleText}ナビゲーション` },
    defaultView: {
      getComputedStyle(element) {
        return { display: element === hiddenSource ? "none" : "block" };
      },
    },
    querySelectorAll(selector) { return selector === "article" ? [article] : []; },
    createElement() { return parsedRoot; },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) { endElement = element; },
        toString() { return endElement ? "" : paragraphText; },
      };
    },
  };
  let defuddleCalls = 0;
  class FakeDefuddle {
    constructor() { defuddleCalls += 1; }
    parse() { return { content: "<p>表示中の本文です。</p>" }; }
  }

  const result = extractPage(document, FakeDefuddle);

  assert.equal(defuddleCalls, 0);
  assert.equal(hiddenCloneRemoved, true);
  assert.deepEqual(result.readingContext.figures.map((figure) => figure.src), [
    "https://example.com/visible.png",
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
