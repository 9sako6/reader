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
    this.clientWidth = 1000;
    this.clientHeight = 500;
    this.scrollWidth = 1000;
    this.scrollTop = 0;
    this.rect = null;
    this.inert = false;
    this.hidden = false;
    this.disabled = false;
    this.ownerDocument = null;
    this.listeners = new Map();
    this.animations = [];
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      child.ownerDocument ||= this.ownerDocument;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
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

  getBoundingClientRect() {
    return this.rect || { top: 0, bottom: 100, left: 0, right: 390, width: 390, height: 100 };
  }

  getClientRects() {
    return this.hidden ? [] : [{}];
  }

  contains(element) {
    if (element === this) return true;
    return this.children.some((child) => child.contains(element));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

function findElement(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function findElements(root, predicate) {
  if (!root) return [];
  const matches = predicate(root) ? [root] : [];
  for (const child of root.children) matches.push(...findElements(child, predicate));
  return matches;
}

function revealLoading(timers) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === 100);
  assert.ok(entry, "the loading bar reveal is scheduled after 100ms");
  timers.delete(entry[0]);
  entry[1].callback();
}

function createOutlineReaderHarness() {
  const headingBeforeSelection = new FakeElement("h1", "記事タイトル");
  const headingInSelection = new FakeElement("h2", "次の節");
  const documentElement = new FakeElement("html");
  const documentListeners = new Map();
  let resizeCallback = null;
  const document = {
    documentElement,
    activeElement: null,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
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
  documentElement.ownerDocument = document;
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
  let currentTime = 0;
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
    Date: {
      now() {
        return currentTime;
      },
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

  return {
    document,
    documentElement,
    selection,
    timers,
    messageListener,
    resizeDisplay() {
      resizeCallback();
    },
    enableReducedMotion() {
      reduceMotion = true;
    },
    advanceTime(milliseconds) {
      currentTime += milliseconds;
    },
  };
}

test("reader replaces loading only for the matching request", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "request-1" });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  messageListener({ type: "START_RSVP", text: "最初の節です。次の節です。", requestId: "stale-request" });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  revealLoading(timers);
  const loadingOverlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElement(loadingOverlay, (element) => element.attributes["data-reader-loading-bar"] === "true"));
  messageListener({ type: "START_RSVP", text: "最初の節です。次の節です。", requestId: "request-1" });
  assert.ok(findElement(loadingOverlay, (element) => element.attributes["data-reader-stage"] === "true"));
});

test("reader omits loading and cover transition when preparation finishes at 0ms", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "zero-ms-request" });
  messageListener({ type: "START_RSVP", text: "0msの本文です。", requestId: "zero-ms-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const stage = findElement(overlay, (element) => element.attributes["data-reader-stage"] === "true");
  assert.equal(stage.animations.length, 0);
  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-loading-bar"] === "true"), null);
});

test("reader omits loading and cover transition when preparation finishes at 99ms", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "ninety-nine-ms-request" });
  harness.advanceTime(99);
  messageListener({ type: "START_RSVP", text: "99msの本文です。", requestId: "ninety-nine-ms-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const stage = findElement(overlay, (element) => element.attributes["data-reader-stage"] === "true");
  assert.equal(stage.animations.length, 0);
  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-loading-bar"] === "true"), null);
});

test("reader reveals the bar and uses a cover transition when preparation finishes at 100ms", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "one-hundred-ms-request" });
  harness.advanceTime(100);
  messageListener({ type: "START_RSVP", text: "100msの本文です。", requestId: "one-hundred-ms-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const bar = findElement(overlay, (element) => element.attributes["data-reader-loading-bar"] === "true");
  const indicator = findElement(overlay, (element) => element.attributes["data-reader-loading-indicator"] === "true");
  const stage = findElement(overlay, (element) => element.attributes["data-reader-stage"] === "true");
  assert.ok(bar);
  assert.ok(indicator.animations.some(({ keyframes }) => keyframes.at(-1)?.transform === "translateX(0) scaleX(1)"));
  assert.equal(stage.animations.at(-1).options.duration, 220);
});

test("reader reveals the bar and uses a cover transition when preparation finishes at 1200ms", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "twelve-hundred-ms-request" });
  harness.advanceTime(1200);
  messageListener({ type: "START_RSVP", text: "1200msの本文です。", requestId: "twelve-hundred-ms-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElement(overlay, (element) => element.attributes["data-reader-loading-bar"] === "true"));
  const stage = findElement(overlay, (element) => element.attributes["data-reader-stage"] === "true");
  assert.equal(stage.animations.at(-1).options.duration, 220);
});

test("reader shows the article outline beside the focal point", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;
  const text = "最初の節です。次の節です。";
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "request-1" });
  revealLoading(timers);
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
  assert.equal(display.style.fontSize, "clamp(36px, 4.5vw, 64px)");
  assert.equal(display.style.justifyContent, "center");
  assert.equal(previousContext.textContent, "");
  assert.equal(nextContext.textContent, "次の節です。");
  assert.equal(nextContext.style.opacity, "0.26");
  assert.equal(nextContext.style.WebkitLineClamp, "2");
  assert.deepEqual(Array.from(nextContext.animations[0].keyframes, ({ opacity }) => opacity), [0.12, 0.26]);
  assert.equal(nextContext.animations[0].options.duration, 120);
});

test("reader splits RSVP units when the available width shrinks without changing font size", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "resize-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "resize-request",
  });
  const display = findElement(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );

  const initialFontSize = display.style.fontSize;
  display.clientWidth = 300;
  harness.resizeDisplay();
  assert.equal(display.style.fontSize, initialFontSize);
  assert.equal(display.style.fontSize, "clamp(36px, 4.5vw, 64px)");
  assert.ok([
    ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(display.textContent),
  ].length <= 4);
  assert.equal(display.style.justifyContent, "center");
});

test("reader renders controls with their literal dimensions", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "controls-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "controls-request",
  });
  const overlay = document.getElementById("__rsvp-reader-root");

  const playPauseButton = findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止");
  const backButton = findElement(overlay, (element) => element.attributes["aria-label"] === "1文戻る");
  const closeButton = findElement(overlay, (element) => element.attributes["aria-label"] === "readerを閉じる");
  const modeButton = findElement(overlay, (element) => element.textContent === "文章で読む");
  const transport = playPauseButton.parent;
  assert.equal(transport.style.gridTemplateColumns, "1fr 56px 1fr");
  assert.equal(transport.style.width, "min(100%, 264px)");
  assert.equal(playPauseButton.style.width, "56px");
  assert.equal(playPauseButton.style.color, "rgba(245,245,247,0.66)");
  assert.equal(backButton.style.width, "52px");
  assert.equal(closeButton.style.width, "44px");
  assert.equal(closeButton.children[0].tagName, "SVG");
  assert.equal(modeButton.style.minWidth, "112px");
  assert.equal(modeButton.parent.attributes["data-reader-topbar"], "true");
});

test("reader marks the dialog and RSVP unit for assistive technology", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "semantics-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "semantics-request",
  });

  const overlay = document.getElementById("__rsvp-reader-root");
  const dialog = findElement(overlay, (element) => element.attributes.role === "dialog");
  const unit = findElement(overlay, (element) => element.attributes["data-reader-unit"] === "true");
  const previous = findElement(overlay, (element) => element.style.bottom === "calc(50% + 82px)");
  assert.equal(dialog.attributes["aria-modal"], "true");
  assert.equal(dialog.attributes["aria-label"], "reader");
  assert.equal(unit.attributes["aria-live"], "off");
  assert.equal(unit.attributes["aria-atomic"], "false");
  assert.equal(previous.attributes["aria-hidden"], "true");
});

test("reader does not scale controls when reduced motion is enabled", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  harness.enableReducedMotion();
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "reduced-control-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "reduced-control-request",
  });

  const overlay = document.getElementById("__rsvp-reader-root");
  const modeButton = findElement(overlay, (element) => element.textContent === "文章で読む");
  const playButton = findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止");
  modeButton.dispatchEvent({ type: "pointerdown" });
  playButton.dispatchEvent({ type: "pointerdown" });
  assert.equal(playButton.attributes["aria-pressed"], "true");
  assert.equal(modeButton.style.scale, undefined);
  assert.equal(playButton.style.scale, undefined);
});

test("reader restores background inert state and launch focus after Escape", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const body = new FakeElement("body");
  body.ownerDocument = document;
  const head = new FakeElement("head");
  head.ownerDocument = document;
  head.inert = true;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(body, head, launchButton);
  launchButton.focus();

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "modal-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "modal-request",
  });
  assert.equal(body.inert, true);
  assert.equal(head.inert, true);
  assert.equal(document.activeElement.attributes["aria-label"], "readerを閉じる");

  document.dispatchEvent({
    type: "keydown",
    key: "Escape",
    target: documentElement,
    preventDefault() {},
  });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  assert.equal(body.inert, false);
  assert.equal(head.inert, true);
  assert.equal(document.activeElement, launchButton);
});

test("reader keeps a fast error dialog focused and restores inert state after Escape", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const body = new FakeElement("body");
  body.ownerDocument = document;
  const head = new FakeElement("head");
  head.ownerDocument = document;
  head.inert = true;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(body, head, launchButton);
  launchButton.focus();

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "fast-error-request" });
  messageListener({ type: "RSVP_ERROR", requestId: "fast-error-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const closeButton = findElement(overlay, (element) => element.textContent === "閉じる");
  assert.equal(document.activeElement, closeButton);
  assert.equal(body.inert, true);
  assert.equal(head.inert, true);

  let shiftTabPrevented = false;
  document.dispatchEvent({
    type: "keydown",
    key: "Tab",
    shiftKey: true,
    target: closeButton,
    preventDefault() {
      shiftTabPrevented = true;
    },
  });
  assert.equal(shiftTabPrevented, true);
  assert.equal(document.activeElement, closeButton);

  let tabPrevented = false;
  document.dispatchEvent({
    type: "keydown",
    key: "Tab",
    target: closeButton,
    preventDefault() {
      tabPrevented = true;
    },
  });
  assert.equal(tabPrevented, true);
  assert.equal(document.activeElement, closeButton);

  document.dispatchEvent({
    type: "keydown",
    key: "Escape",
    target: closeButton,
    preventDefault() {},
  });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  assert.equal(body.inert, false);
  assert.equal(head.inert, true);
  assert.equal(document.activeElement, launchButton);
});

test("reader does not resurrect a fast error after the stale loading reveal callback runs", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener, timers } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "stale-error-request" });
  const revealTimer = [...timers.values()].find((timer) => timer.delay === 100);
  assert.ok(revealTimer);
  messageListener({ type: "RSVP_ERROR", requestId: "stale-error-request" });
  const errorOverlay = document.getElementById("__rsvp-reader-root");
  assert.ok(errorOverlay);

  revealTimer.callback();
  assert.equal(document.getElementById("__rsvp-reader-root"), errorOverlay);
  assert.equal(documentElement.children.filter((element) => element.id === "__rsvp-reader-root").length, 1);
});

test("reader keeps keyboard focus trapped after switching to text mode", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const body = new FakeElement("body");
  body.ownerDocument = document;
  const head = new FakeElement("head");
  head.ownerDocument = document;
  head.inert = true;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(body, head, launchButton);
  launchButton.focus();

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "text-modal-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "text-modal-request",
  });

  const rsvpOverlay = document.getElementById("__rsvp-reader-root");
  const textModeButton = findElement(rsvpOverlay, (element) => element.textContent === "文章で読む");
  textModeButton.dispatchEvent({ type: "click" });

  const textOverlay = document.getElementById("__rsvp-reader-root");
  const textShell = findElement(
    textOverlay,
    (element) => element.attributes["data-reader-text-shell"] === "true",
  );
  const closeButton = findElement(textShell, (element) => element.attributes["aria-label"] === "readerを閉じる");
  const rsvpModeButton = findElement(textShell, (element) => element.textContent === "RSVPで読む");
  assert.ok(textShell);
  assert.equal(document.activeElement, closeButton);

  rsvpModeButton.focus();
  document.dispatchEvent({
    type: "keydown",
    key: "Tab",
    shiftKey: true,
    target: rsvpModeButton,
    preventDefault() {},
  });
  assert.equal(document.activeElement, closeButton);

  document.dispatchEvent({
    type: "keydown",
    key: "Tab",
    target: closeButton,
    preventDefault() {},
  });
  assert.equal(document.activeElement, rsvpModeButton);

  document.dispatchEvent({
    type: "keydown",
    key: "Escape",
    target: rsvpModeButton,
    preventDefault() {},
  });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  assert.equal(body.inert, false);
  assert.equal(head.inert, true);
  assert.equal(document.activeElement, launchButton);
});

test("reader keyboard controls pause and move between sentence contexts", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, timers, messageListener } = harness;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "keyboard-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "keyboard-request",
  });
  const overlay = document.getElementById("__rsvp-reader-root");
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
  const playPauseButton = findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止");
  const backButton = findElement(overlay, (element) => element.attributes["aria-label"] === "1文戻る");

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
});

test("reader follows page headings and switches to text mode", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, selection, messageListener } = harness;
  const text = "最初の節です。次の節です。";

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
});

test("reader uses sentence and figure markers to preserve a shared position", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  const text = "前の文です。図の前です。\n図1\n図の後です。";
  const figureOffset = "前の文です。図の前です。".length + 1;
  const readingContext = {
    language: "ja",
    title: "",
    blocks: [
      { text: "前の文です。図の前です。", kind: "paragraph", level: null, start: 0, end: figureOffset - 1 },
      { text: "図の後です。", kind: "paragraph", level: null, start: figureOffset + 3, end: text.length },
    ],
    headings: [],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/figure.png",
      alt: "図1",
      caption: "図1",
      sourceOffset: figureOffset,
      sourceEnd: figureOffset + 2,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "position-request" });
  messageListener({ type: "START_RSVP", text, requestId: "position-request", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  const modeButton = findElement(overlay, (element) => element.textContent === "文章で読む");
  modeButton.dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const textMarkers = findElements(textShell, (element) => element.dataset.readerPositionKind === "text");
  const figureMarker = findElement(textShell, (element) => element.dataset.readerPositionKind === "figure");
  const scroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const textModeButton = findElement(textShell, (element) => element.textContent === "RSVPで読む");

  assert.equal(textMarkers.length, 3);
  assert.equal(figureMarker.dataset.figureIndex, "0");
  assert.equal(figureMarker.dataset.sourceStart, String(figureOffset));
  scroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  textMarkers[0].rect = { top: -120, bottom: -20, left: 0, right: 300, width: 300, height: 100 };
  textMarkers[1].rect = { top: -80, bottom: 20, left: 0, right: 300, width: 300, height: 100 };
  figureMarker.rect = { top: 120, bottom: 260, left: 0, right: 300, width: 300, height: 140 };
  textMarkers[2].rect = { top: 540, bottom: 640, left: 0, right: 300, width: 300, height: 100 };
  scroller.dispatchEvent({ type: "scroll" });
  textModeButton.dispatchEvent({ type: "click" });

  const figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(figurePanel);
  assert.equal(figurePanel.dataset.figureIndex, "0");
  assert.equal(figurePanel.dataset.sourceStart, String(figureOffset));
});

test("reader disables loading and stage animations for reduced motion", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
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

  harness.enableReducedMotion();
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "reduced-motion-request" });
  revealLoading(harness.timers);
  const reducedLoadingOverlay = document.getElementById("__rsvp-reader-root");
  const reducedIndicator = findElement(
    reducedLoadingOverlay,
    (element) => element.attributes["data-reader-loading-indicator"] === "true",
  );
  assert.equal(reducedIndicator.animations.length, 0);
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "reduced-motion-request",
    readingContext: pageReadingContext,
  });
  const reducedStage = findElement(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.style.display === "grid",
  );
  assert.equal(reducedStage.animations.length, 0);
});

function createTimingReaderHarness(engine = Engine) {
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
    Engine: engine,
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

  return { document, messageListener, timers };
}

test("reader varies timing for punctuation and phrase length", () => {
  const { document, messageListener, timers } = createTimingReaderHarness();

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
});

test("Chrome viewer segments with the ReaderContent language", () => {
  const locales: string[] = [];
  const engine = {
    ...Engine,
    segmentText(text, locale, boundaries) {
      locales.push(locale);
      return Engine.segmentText(text, locale, boundaries);
    },
  };
  const { messageListener } = createTimingReaderHarness(engine);
  const readingContext = {
    language: "en-US",
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [],
  };

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "locale-request" });
  messageListener({
    type: "START_RSVP",
    text: "First sentence. Next sentence.",
    requestId: "locale-request",
    readingContext,
  });

  assert.deepEqual(locales, ["en-US"]);
});

test("reader preserves the literal baseline effective reading rate", () => {
  const { messageListener, timers } = createTimingReaderHarness();

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
      { offset: 56, headingIndex: 1 },
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

function createFigureReaderHarness() {
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

  return { document, documentElement, messageListener, timers };
}

test("reader pauses on an article image and exposes its context", () => {
  const { document, messageListener, timers } = createFigureReaderHarness();

  const leadingSentence = "結果を図1に示します。";
  const captionText = "図1 処理時間";
  const nextSentence = "次の説明です。";
  const figureOffset = 12;
  const figureEnd = 19;
  const text = `${leadingSentence}\n${captionText}\n${nextSentence}`;
  const readingContext = {
    blocks: [
      { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: 11 },
      { text: nextSentence, kind: "paragraph", level: null, start: 20, end: 27 },
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
  const [firstTimerId, firstTimer] = [...timers.entries()][0];
  timers.delete(firstTimerId);
  firstTimer.callback();
  const [secondTimerId, secondTimer] = [...timers.entries()][0];
  timers.delete(secondTimerId);
  secondTimer.callback();
  let figurePanel = findElement(
    overlay,
    (element) => element.attributes["aria-label"] === "本文画像",
  );
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
});

test("reader returns from an image to the previous sentence and resumes after the image", async () => {
  const { document, documentElement, messageListener, timers } = createFigureReaderHarness();
  const readingContext = {
    blocks: [
      { text: "結果を図1に示します。", kind: "paragraph", level: null, start: 0, end: 11 },
      { text: "次の説明です。", kind: "paragraph", level: null, start: 20, end: 27 },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [
      {
        src: "https://example.com/chart.png",
        alt: "処理時間の比較グラフ",
        caption: "図1 処理時間",
        sourceOffset: 12,
        sourceEnd: 19,
      },
    ],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-navigation-request" });
  messageListener({
    type: "START_RSVP",
    text: "結果を図1に示します。\n図1 処理時間\n次の説明です。",
    requestId: "figure-navigation-request",
    readingContext,
  });
  const overlay = document.getElementById("__rsvp-reader-root");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  const [firstTimerId, firstTimer] = [...timers.entries()][0];
  timers.delete(firstTimerId);
  firstTimer.callback();
  const [secondTimerId, secondTimer] = [...timers.entries()][0];
  timers.delete(secondTimerId);
  secondTimer.callback();
  let figurePanel = findElement(
    overlay,
    (element) => element.attributes["aria-label"] === "本文画像",
  );
  assert.ok(figurePanel);

  const backButton = findElement(overlay, (element) => element.attributes["aria-label"] === "1文戻る");
  backButton.dispatchEvent({ type: "click" });
  await Promise.resolve();
  assert.equal(findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像"), null);
  assert.match(display.textContent, /結果を/);
  assert.ok(findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.ok(timers.size > 0);
  const [returnFirstTimerId, returnFirstTimer] = [...timers.entries()][0];
  timers.delete(returnFirstTimerId);
  returnFirstTimer.callback();
  const [returnSecondTimerId, returnSecondTimer] = [...timers.entries()][0];
  timers.delete(returnSecondTimerId);
  returnSecondTimer.callback();
  figurePanel = findElement(
    overlay,
    (element) => element.attributes["aria-label"] === "本文画像",
  );
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
});

test("reader keeps the article image and veil in text mode", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const readingContext = {
    blocks: [
      { text: "結果を図1に示します。", kind: "paragraph", level: null, start: 0, end: 11 },
      { text: "次の説明です。", kind: "paragraph", level: null, start: 20, end: 27 },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [
      {
        src: "https://example.com/chart.png",
        alt: "処理時間の比較グラフ",
        caption: "図1 処理時間",
        sourceOffset: 12,
        sourceEnd: 19,
      },
    ],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-text-request" });
  messageListener({
    type: "START_RSVP",
    text: "結果を図1に示します。\n図1 処理時間\n次の説明です。",
    requestId: "figure-text-request",
    readingContext,
  });
  const overlay = document.getElementById("__rsvp-reader-root");

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

test("reader removes closed content, ignores a saved timer, and reopens fresh content", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "cleanup-first" });
  messageListener({
    type: "START_RSVP",
    text: "最初の本文です。次の文です。",
    requestId: "cleanup-first",
  });

  const firstOverlay = document.getElementById("__rsvp-reader-root");
  const savedTimerCallback = [...timers.values()][0].callback;
  const closeButton = findElement(firstOverlay, (element) => element.attributes["aria-label"] === "readerを閉じる");
  closeButton.dispatchEvent({ type: "click" });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);

  savedTimerCallback();
  assert.equal(document.getElementById("__rsvp-reader-root"), null);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "cleanup-second" });
  messageListener({
    type: "START_RSVP",
    text: "新しい本文です。",
    requestId: "cleanup-second",
  });
  const secondOverlay = document.getElementById("__rsvp-reader-root");
  const secondDisplay = findElement(
    secondOverlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  assert.match(secondDisplay.textContent, /新しい本文/u);
  assert.equal(findElement(secondOverlay, (element) => /最初の本文/u.test(element.textContent)), null);
});
