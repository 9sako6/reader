export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../../../.build/packages/engine/src/engine.js");
const Extractor = require("../../../.build/packages/extractor/src/extractor.js");
const ReaderIcons = require("../../../.build/packages/icons/src/icons.js");

class FakeElement {
  [key: string]: any;

  constructor(tagName, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.style = {};
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.clientWidth = 500;
    this.scrollWidth = 500;
    this.listeners = new Map();
    this.animations = [];
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }

  animate(keyframes, options) {
    const animation = { keyframes, options, finished: Promise.resolve() };
    this.animations.push(animation);
    return animation;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test("reader shows the article outline beside the focal point", () => {
  const headingBeforeSelection = new FakeElement("h1", "記事タイトル");
  const headingInSelection = new FakeElement("h2", "次の節");
  const documentElement = new FakeElement("html");
  const documentListeners = new Map();
  let rangeMeasurementCount = 0;
  let measuredRangeElement = null;
  let resizeCallback = null;
  const document = {
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    createRange() {
      return {
        selectNodeContents(element) {
          measuredRangeElement = element;
        },
        getBoundingClientRect() {
          const assignedFontSize = Number.parseFloat(measuredRangeElement.style.fontSize);
          const fontSize = Number.isFinite(assignedFontSize) ? assignedFontSize : 64;
          const width = rangeMeasurementCount === 0
            ? 1000
            : rangeMeasurementCount === 1
              ? 520
              : fontSize * 18.288;
          rangeMeasurementCount += 1;
          return { width };
        },
        detach() {},
      };
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
    querySelectorAll() {
      return [headingBeforeSelection, headingInSelection];
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) || []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
    },
  };
  let messageListener = null;
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString() {
      return "最初の節です。次の節です。";
    },
    getRangeAt() {
      return {
        comparePoint(element) {
          return element === headingBeforeSelection ? -1 : 0;
        },
        cloneRange() {
          let endElement = null;
          return {
            setEndBefore(element) {
              endElement = element;
            },
            toString() {
              return endElement === headingInSelection ? "最初の節です。" : "";
            },
          };
        },
      };
    },
  };
  let nextTimerId = 1;
  const timers = new Map();
  let reduceMotion = false;
  const context: any = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
    },
    document,
    getSelection() {
      return selection;
    },
    matchMedia() {
      return { matches: reduceMotion };
    },
    getComputedStyle(element) {
      const assignedFontSize = Number.parseFloat(element.style.fontSize);
      return {
        fontSize: Number.isFinite(assignedFontSize) ? `${assignedFontSize}px` : "64px",
        paddingLeft: "12px",
        paddingRight: "12px",
      };
    },
    Engine,
    Extractor,
    ReaderIcons,
    Intl,
    console,
    ResizeObserver: class {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe() {}

      disconnect() {}
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "viewer", "viewer.js"), "utf8");
  vm.runInNewContext(source, context);

  const text = selection.toString();
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "request-1" });
  const loadingOverlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElement(loadingOverlay, (element) => element.textContent === "文章を準備しています…"));
  messageListener({ type: "START_RSVP", text, requestId: "stale-request" });
  assert.equal(document.getElementById("__rsvp-reader-root"), loadingOverlay);
  messageListener({ type: "START_RSVP", text, requestId: "request-1" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const minimap = findElement(overlay, (element) => element.tagName === "ASIDE");
  const stage = findElement(overlay, (element) => element.style.display === "grid");
  const activeMarker = findElement(minimap, (element) => element.attributes["aria-current"] === "location");
  const outline = findElement(minimap, (element) => element.attributes["aria-label"] === "記事の構成");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  const previousContext = findElement(
    overlay,
    (element) => element.attributes["aria-hidden"] === "true" && element.style.bottom === "calc(50% + 82px)",
  );
  const nextContext = findElement(
    overlay,
    (element) => element.attributes["aria-hidden"] === "true" && element.style.top === "calc(50% + 82px)",
  );

  assert.equal(stage.style.gridTemplateColumns, "280px minmax(0, 1fr)");
  assert.equal(stage.attributes["data-reader-stage"], "true");
  assert.deepEqual(Array.from(stage.animations[0].keyframes, ({ opacity }) => opacity), [0, 1]);
  assert.equal(stage.animations[0].options.duration, 220);
  assert.equal(stage.animations[0].options.easing, "cubic-bezier(0.22, 1, 0.36, 1)");
  assert.equal(stage.style.columnGap, "32px");
  assert.equal(stage.children[0], minimap);
  assert.equal(minimap.style.position, "relative");
  assert.equal(minimap.attributes["data-reader-minimap"], "true");
  assert.equal(minimap.style.width, "100%");
  assert.equal(outline.children.length, 2);
  assert.equal(outline.children[0].textContent, "記事タイトル");
  assert.equal(outline.children[1].textContent, "次の節");
  assert.equal(outline.style.scrollbarWidth, "none");
  assert.ok(activeMarker);
  assert.equal(activeMarker.style.boxShadow, "none");
  assert.ok(Number.parseFloat(display.style.fontSize) <= 26);
  assert.equal(rangeMeasurementCount, 3);
  assert.equal(display.style.justifyContent, "center");
  assert.equal(previousContext.textContent, "");
  assert.equal(nextContext.textContent, "次の節です。");
  assert.equal(nextContext.style.opacity, "0.26");
  assert.equal(nextContext.style.WebkitLineClamp, "2");
  assert.deepEqual(Array.from(nextContext.animations[0].keyframes, ({ opacity }) => opacity), [0.12, 0.26]);
  assert.equal(nextContext.animations[0].options.duration, 120);

  display.clientWidth = 300;
  resizeCallback();
  assert.ok(Number.parseFloat(display.style.fontSize) <= 15);
  assert.ok(rangeMeasurementCount >= 5);
  assert.equal(display.style.justifyContent, "center");

  const playPauseButton = findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止");
  const backButton = findElement(overlay, (element) => element.attributes["aria-label"] === "1文戻る");
  const closeButton = findElement(overlay, (element) => element.attributes["aria-label"] === "readerを閉じる");
  const modeButton = findElement(overlay, (element) => element.textContent === "文章で読む");
  const transport = playPauseButton.parent;
  assert.equal(transport.style.gridTemplateColumns, "1fr 56px 1fr");
  assert.equal(transport.style.width, "min(100%, 264px)");
  assert.equal(playPauseButton.style.width, "56px");
  assert.equal(backButton.style.width, "52px");
  assert.equal(closeButton.style.width, "44px");
  assert.equal(closeButton.children[0].tagName, "SVG");
  assert.equal(modeButton.style.minWidth, "112px");
  assert.equal(modeButton.parent.attributes["data-reader-topbar"], "true");

  let prevented = false;
  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(playPauseButton.attributes["aria-label"], "再生");
  assert.equal(playPauseButton.style.width, "56px");
  backButton.dispatchEvent({ type: "click" });
  assert.equal(playPauseButton.attributes["aria-label"], "再生");
  assert.equal(timers.size, 0);

  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {},
  });
  const firstTimer = [...timers.values()][0];
  timers.clear();
  firstTimer.callback();
  assert.match(display.textContent, /次の節/);
  assert.equal(previousContext.textContent, "最初の節です。");
  assert.equal(nextContext.textContent, "");
  document.dispatchEvent({
    type: "keydown",
    code: "ArrowLeft",
    target: documentElement,
    preventDefault() {},
  });
  assert.match(display.textContent, /最初の節/);
  assert.equal(previousContext.textContent, "");
  assert.equal(nextContext.textContent, "次の節です。");

  selection.isCollapsed = true;
  const pageReadingContext = {
    headings: [
      { text: "ページタイトル", level: 1 },
      { text: "概要", level: 2 },
    ],
    sectionTransitions: [
      { offset: 0, headingIndex: 0 },
      { offset: 7, headingIndex: 1 },
    ],
    initialHeadingIndex: -1,
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "request-2" });
  messageListener({
    type: "START_RSVP",
    text,
    requestId: "request-2",
    readingContext: pageReadingContext,
  });

  const pageOverlay = document.getElementById("__rsvp-reader-root");
  const pageOutline = findElement(
    pageOverlay,
    (element) => element.attributes["aria-label"] === "記事の構成",
  );
  const pageDisplay = findElement(
    pageOverlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  assert.equal(pageOutline.children[0].textContent, "ページタイトル");
  assert.equal(pageOutline.children[1].style.paddingLeft, "19px");
  assert.equal(pageOutline.children[1].tagName, "BUTTON");

  const pagePlayPauseButton = findElement(pageOverlay, (element) => element.attributes["aria-label"] === "一時停止");
  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {},
  });
  pageOutline.children[1].dispatchEvent({ type: "click" });
  assert.equal(pagePlayPauseButton.attributes["aria-label"], "再生");
  assert.equal(pageOutline.children[1].attributes["aria-current"], "location");
  assert.match(pageDisplay.textContent, /次の節/);

  const pageModeButton = findElement(pageOverlay, (element) => element.textContent === "文章で読む");
  pageModeButton.dispatchEvent({ type: "click" });
  const textShell = findElement(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["data-reader-text-shell"] === "true",
  );
  assert.ok(textShell);
  const textScroller = findElement(
    textShell,
    (element) => element.attributes["data-reader-text-scroller"] === "true",
  );
  const rsvpModeButton = findElement(textShell, (element) => element.textContent === "RSVPで読む");
  assert.ok(textScroller);
  assert.equal(rsvpModeButton.parent.attributes["data-reader-topbar"], "true");
  assert.ok(findElement(textShell, (element) => element.attributes["aria-label"] === "readerを閉じる"));

  reduceMotion = true;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "reduced-motion-request" });
  const reducedLoadingOverlay = document.getElementById("__rsvp-reader-root");
  const reducedIndicator = findElement(
    reducedLoadingOverlay,
    (element) => element.textContent === "文章を準備しています…",
  );
  assert.equal(reducedIndicator.animations.length, 0);
  messageListener({
    type: "START_RSVP",
    text,
    requestId: "reduced-motion-request",
    readingContext: pageReadingContext,
  });
  const reducedStage = findElement(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.style.display === "grid",
  );
  assert.equal(reducedStage.animations.length, 0);
});

test("reader varies linguistic timing while preserving baseline effective WPM", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "viewer", "viewer.js"), "utf8");

  const documentElement = new FakeElement("html");
  const document = {
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  let messageListener = null;
  let nextTimerId = 1;
  const timers = new Map();
  const context: any = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
    },
    document,
    getSelection() {
      return { rangeCount: 0, isCollapsed: true };
    },
    matchMedia() {
      return { matches: false };
    },
    getComputedStyle() {
      return { fontSize: "64px" };
    },
    Engine,
    Extractor,
    ReaderIcons,
    Intl,
    console,
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  const text = "短い、長い文章のまとまりです。次です。";
  const readingContext = {
    headings: [
      { text: "導入", level: 1 },
      { text: "本論", level: 2 },
    ],
    sectionTransitions: [
      { offset: 0, headingIndex: 0 },
      { offset: 3, headingIndex: 1 },
    ],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "timing-request" });
  messageListener({ type: "START_RSVP", text, requestId: "timing-request", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  assert.equal(display.textContent, "短い、");
  const [firstTimerId, firstTimer] = [...timers.entries()][0];
  assert.equal(firstTimer.delay, 612);
  timers.delete(firstTimerId);
  firstTimer.callback();

  assert.equal(display.textContent, "長い文章のまとまりです。");
  const secondTimer = [...timers.values()][0];
  assert.equal(secondTimer.delay, 828);

  const baselineText = [
    "ソフトウェア設計では、変更理由を一つの場所に集めます。",
    "依存関係を減らすと、修正の影響範囲を予測しやすくなります。",
    "テストは利用者から見える振る舞いを確かめ、内部実装だけには依存しません。",
    "文章の区切りでは十分に休止し、短い語句は自然な速さで提示します。",
    "見出しが変わる場所では、次の内容を理解するための余白を設けます。",
  ].join("");
  const baselineContext = {
    headings: [
      { text: "設計", level: 1 },
      { text: "検証", level: 2 },
    ],
    sectionTransitions: [
      { offset: 0, headingIndex: 0 },
      { offset: baselineText.indexOf("テスト"), headingIndex: 1 },
    ],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "baseline-request" });
  messageListener({
    type: "START_RSVP",
    text: baselineText,
    requestId: "baseline-request",
    readingContext: baselineContext,
  });

  let elapsedMs = 0;
  let scheduledUnitCount = 0;
  while (timers.size > 0) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    elapsedMs += timer.delay;
    scheduledUnitCount += 1;
    timer.callback();
    assert.ok(scheduledUnitCount < 100);
  }

  const graphemeCount = [
    ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(baselineText),
  ].length;
  const charactersPerMinute = graphemeCount * 60000 / elapsedMs;
  const equivalentWordsPerMinute = charactersPerMinute / 2.43;
  assert.ok(charactersPerMinute >= 925 && charactersPerMinute <= 950);
  assert.ok(equivalentWordsPerMinute >= 380 && equivalentWordsPerMinute <= 395);
});

test("reader pauses on an article image and keeps it in the text view", async () => {
  const documentElement = new FakeElement("html");
  const documentListeners = new Map();
  const document = {
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) || []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
    },
  };
  let messageListener = null;
  let nextTimerId = 1;
  const timers = new Map();
  const context: any = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
    },
    document,
    getSelection() {
      return { rangeCount: 0, isCollapsed: true };
    },
    matchMedia() {
      return { matches: false };
    },
    getComputedStyle() {
      return { fontSize: "64px" };
    },
    Engine,
    Extractor,
    ReaderIcons,
    Intl,
    console,
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "viewer", "viewer.js"), "utf8");
  vm.runInNewContext(source, context);

  const leadingSentence = "結果を図1に示します。";
  const captionText = "図1 処理時間";
  const nextSentence = "次の説明です。";
  const figureOffset = `${leadingSentence}\n`.length;
  const figureEnd = figureOffset + captionText.length;
  const text = `${leadingSentence}\n${captionText}\n${nextSentence}`;
  const readingContext = {
    blocks: [
      { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: leadingSentence.length },
      { text: nextSentence, kind: "paragraph", level: null, start: figureEnd + 1, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [
      {
        src: "https://example.com/chart.png",
        alt: "処理時間の比較グラフ",
        caption: captionText,
        sourceOffset: figureOffset,
        sourceEnd: figureEnd,
      },
    ],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-request" });
  messageListener({ type: "START_RSVP", text, requestId: "figure-request", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  let figurePanel = null;
  for (let step = 0; step < 10 && !figurePanel; step += 1) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    figurePanel = findElement(
      overlay,
      (element) => element.attributes["aria-label"] === "本文画像",
    );
  }
  assert.ok(figurePanel);
  const image = findElement(figurePanel, (element) => element.tagName === "IMG");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  const resumeButton = findElement(overlay, (element) => element.attributes["aria-label"] === "再生");
  assert.equal(image.src, "https://example.com/chart.png");
  assert.equal(image.alt, "処理時間の比較グラフ");
  assert.ok(findElement(figurePanel, (element) => element.textContent === "図1 処理時間"));
  assert.ok(resumeButton);
  assert.equal(findElement(figurePanel, (element) => element.tagName === "BUTTON"), null);
  const imageSurface = findElement(
    figurePanel,
    (element) => element.attributes["data-reader-image-surface"] === "true",
  );
  const veil = findElement(
    figurePanel,
    (element) => element.attributes["data-reader-image-veil"] === "true",
  );
  assert.equal(veil.style.opacity, "1");
  imageSurface.dispatchEvent({ type: "pointerdown" });
  assert.equal(veil.style.opacity, "0");
  imageSurface.dispatchEvent({ type: "pointerup" });
  assert.equal(veil.style.opacity, "1");
  assert.equal(timers.size, 0);
  assert.deepEqual(Array.from(figurePanel.animations[0].keyframes, ({ opacity }) => opacity), [0, 1]);
  assert.equal(figurePanel.animations[0].options.duration, 180);
  assert.deepEqual(Array.from(display.animations.at(-1).keyframes, ({ opacity }) => opacity), [1, 0]);

  const backButton = findElement(overlay, (element) => element.attributes["aria-label"] === "1文戻る");
  backButton.dispatchEvent({ type: "click" });
  await Promise.resolve();
  assert.equal(findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像"), null);
  assert.match(display.textContent, /結果を/);
  assert.ok(findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.ok(timers.size > 0);
  figurePanel = null;
  for (let step = 0; step < 10 && !figurePanel; step += 1) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    figurePanel = findElement(
      overlay,
      (element) => element.attributes["aria-label"] === "本文画像",
    );
  }
  assert.ok(figurePanel);

  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {},
  });
  await Promise.resolve();
  assert.equal(findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像"), null);
  assert.match(display.textContent, /^次の/u);
  assert.deepEqual(Array.from(display.animations.at(-1).keyframes, ({ opacity }) => opacity), [0, 1]);
  assert.ok(timers.size > 0);

  const textModeButton = findElement(overlay, (element) => element.textContent === "文章で読む");
  textModeButton.dispatchEvent({ type: "click" });
  const textFigure = findElement(
    overlay,
    (element) => element.attributes["data-reader-text-figure"] === "true",
  );
  const textImage = findElement(textFigure, (element) => element.tagName === "IMG");
  const textVeil = findElement(
    textFigure,
    (element) => element.attributes["data-reader-image-veil"] === "true",
  );
  assert.equal(textImage.src, "https://example.com/chart.png");
  assert.equal(textVeil.style.background, "rgba(0,0,0,0.46)");
  assert.ok(findElement(textFigure, (element) => element.textContent === "図1 処理時間"));
});
