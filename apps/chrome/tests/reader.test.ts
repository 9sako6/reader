export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../../../.build/packages/engine/src/engine.js");
const Extractor = require("../../../.build/packages/extractor/src/extractor.js");
const ReaderIcons = require("../../../.build/packages/icons/src/icons.js");
const ReaderViewBundle = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "reader-view", "reader-view.js"), "utf8");

class FakeElement {
  [key: string]: any;

  constructor(tagName, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = tagName === "#shadow-root" ? 11 : tagName === "#text" ? 3 : 1;
    this.nodeName = this.tagName;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this._textContent = String(textContent);
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
    this.shadowRoot = null;
    this.mode = null;
    this.open = false;
    this.showModalCalls = 0;
    this.closeCalls = 0;
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this.nodeType === 3 && this.nodeValue !== undefined
      ? String(this.nodeValue)
      : String(this._textContent);
  }

  set textContent(value) {
    for (const child of this.children || []) child.parent = null;
    if (this.children) this.children = [];
    this._textContent = String(value ?? "");
    if (this.nodeType === 3) this.nodeValue = this._textContent;
  }

  get parentNode() {
    return this.parent;
  }

  get childNodes() {
    return this.children;
  }

  get isConnected() {
    return Boolean(this.parent) || this.nodeType === 9;
  }

  append(...children) {
    for (const child of children) {
      if (child === this || child.contains?.(this)) throw new Error("invalid DOM hierarchy");
      if (child.parent) child.remove();
      child.parent = this;
      child.ownerDocument ||= this.ownerDocument;
      this.children.push(child);
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  insertBefore(child, before) {
    if (child === this || child.contains?.(this)) throw new Error("invalid DOM hierarchy");
    if (child === before) return child;
    if (child.parent) child.remove();
    child.parent = this;
    child.ownerDocument ||= this.ownerDocument;
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    if (!this.children.includes(child)) throw new Error("child is not attached");
    child.remove();
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name.startsWith("data-")) {
      this.dataset[name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = String(value);
    }
    const propertyName = name.toLowerCase() === "srcset" ? "srcset" : name.toLowerCase();
    if (["src", "srcset", "sizes", "alt", "title", "width", "height"].includes(propertyName)) this[propertyName] = value;
    if (name === "hidden") this.hidden = true;
    if (name === "disabled") this.disabled = true;
  }

  setAttributeNS(_namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith("data-")) delete this.dataset[name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())];
    if (name === "hidden") this.hidden = false;
    if (name === "disabled") this.disabled = false;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get nextSibling() {
    if (!this.parent) return null;
    const index = this.parent.children.indexOf(this);
    return index >= 0 ? this.parent.children[index + 1] || null : null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((value) => value.trim());
    return findElements(this, (element) => selectors.some((candidate) => {
      const attribute = candidate.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u);
      if (attribute) return attribute[2] === undefined
        ? element.hasAttribute(attribute[1])
        : element.getAttribute(attribute[1]) === attribute[2];
      if (/^[a-z]+$/iu.test(candidate)) return element.tagName.toLowerCase() === candidate.toLowerCase();
      return false;
    }));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((candidate) => candidate !== listener),
    );
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.bubbles ??= true;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    if (event.bubbles && !event.cancelBubble && this.parent) this.parent.dispatchEvent(event);
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
    for (const child of this.children) child.parent = null;
    this._textContent = "";
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

  attachShadow({ mode }) {
    const shadowRoot = new FakeElement("#shadow-root");
    shadowRoot.mode = mode;
    shadowRoot.host = this;
    shadowRoot.ownerDocument = this.ownerDocument;
    shadowRoot.activeElement = null;
    this.shadowRoot = shadowRoot;
    return shadowRoot;
  }

  showModal() {
    this.showModalCalls += 1;
    this.open = true;
    this.setAttribute("open", "");
  }

  close() {
    this.closeCalls += 1;
    this.open = false;
    delete this.attributes.open;
  }
}

function installTextFigureGeometry() {
  const original = FakeElement.prototype.getBoundingClientRect;
  FakeElement.prototype.getBoundingClientRect = function () {
    if (this.attributes["data-reader-text-scroller"] === "true") {
      return { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
    }
    if (this.attributes["data-reader-text-figure"] === "true") {
      let scroller = this.parent;
      while (scroller && scroller.attributes["data-reader-text-scroller"] !== "true") scroller = scroller.parent;
      const scrollTop = scroller?.scrollTop || 0;
      return { top: 420 - scrollTop, bottom: 540 - scrollTop, left: 0, right: 300, width: 300, height: 120 };
    }
    return original.call(this);
  };
  return () => {
    FakeElement.prototype.getBoundingClientRect = original;
  };
}

function findElement(root, predicate) {
  if (!root) return null;
  if (root.nodeType === 1 && predicate(root)) return root;
  if (root.shadowRoot) {
    const shadowMatch = findElement(root.shadowRoot, predicate);
    if (shadowMatch) return shadowMatch;
  }
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function findElementByText(root, text) {
  if (!root) return null;
  if (root.shadowRoot) {
    const shadowMatch = findElementByText(root.shadowRoot, text);
    if (shadowMatch) return shadowMatch;
  }
  for (const child of root.children) {
    const match = findElementByText(child, text);
    if (match) return match;
  }
  return root.nodeType === 1 && root.textContent === text ? root : null;
}

function findElementContainingText(root, text) {
  if (!root) return null;
  if (root.shadowRoot) {
    const shadowMatch = findElementContainingText(root.shadowRoot, text);
    if (shadowMatch) return shadowMatch;
  }
  for (const child of root.children) {
    const match = findElementContainingText(child, text);
    if (match) return match;
  }
  return root.nodeType === 1 && root.textContent.includes(text) ? root : null;
}

function findElements(root, predicate) {
  if (!root) return [];
  const matches = root.nodeType === 1 && predicate(root) ? [root] : [];
  if (root.shadowRoot) matches.push(...findElements(root.shadowRoot, predicate));
  for (const child of root.children) matches.push(...findElements(child, predicate));
  return matches;
}

function loadReaderView(context, document) {
  document.nodeType = 9;
  document.defaultView = context;
  document.body ||= document.documentElement;
  document.documentElement.ownerDocument ||= document;
  const createElement = document.createElement;
  document.createElement = (tagName) => {
    const element = createElement.call(document, tagName);
    element.ownerDocument ||= document;
    return element;
  };
  document.createTextNode ||= (text) => {
    const node = new FakeElement("#text", text);
    node.ownerDocument = document;
    node.nodeValue = text;
    return node;
  };
  const createElementNS = document.createElementNS;
  document.createElementNS = (namespace, tagName) => {
    const element = createElementNS.call(document, namespace, tagName);
    element.ownerDocument = document;
    return element;
  };
  context.window = context;
  context.self = context;
  context.Node = FakeElement;
  context.HTMLIFrameElement = class {};
  context.navigator ||= { userAgent: "reader-test" };
  context.innerWidth ||= 1000;
  context.performance ||= { now: () => 0 };
  context.queueMicrotask ||= (callback) => Promise.resolve().then(callback);
  class FakeMessageChannel {
    port1: { onmessage: ((event: unknown) => void) | null };
    port2: { postMessage: () => void };

    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: () => Promise.resolve().then(() => this.port1.onmessage?.({ data: null })),
      };
    }
  }
  context.MessageChannel ||= FakeMessageChannel;
  context.addEventListener ||= (...args) => document.addEventListener(...args);
  context.removeEventListener ||= (...args) => document.removeEventListener(...args);
  context.dispatchEvent ||= (...args) => document.dispatchEvent(...args);
  vm.runInNewContext(ReaderViewBundle, context);
}

function revealLoading(timers) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === 100);
  assert.ok(entry, "the loading bar reveal is scheduled after 100ms");
  timers.delete(entry[0]);
  entry[1].callback();
}

function createSessionStub(commands, options: { initFails?: boolean } = {}) {
  let nextId = 1;
  let lastHandle = null;
  const handles = new Set();
  const initialState = () => ({
    phase: "idle",
    mode: "rsvp",
    playback: "paused",
    flowIndex: 0,
    flowLength: 0,
    generation: 0,
    sourceOffset: 0,
    currentKind: "none",
    requestId: "",
    timerPending: false,
    contentPresent: false,
    preparationHidden: false,
  });
  const stateForFlow = (state, flow, index, playback) => {
    const item = flow.flow[index];
    if (!item) return { ...state, flowIndex: index, currentKind: "none", playback, timerPending: false };
    const position = item.kind === "figure"
      ? { kind: "figure", sourceOffset: item.sourceOffset, figureIndex: item.figureIndex }
      : { kind: "text", sourceOffset: flow.units[item.unitIndex]?.start ?? item.sourceOffset };
    return {
      ...state,
      phase: "reading",
      playback,
      flowIndex: index,
      flowLength: flow.flow.length,
      sourceOffset: position.sourceOffset,
      currentKind: item.kind,
      position,
      unitIndex: item.kind === "unit" ? item.unitIndex : undefined,
      figureIndex: item.kind === "figure" ? item.figureIndex : undefined,
      timerPending: playback === "playing",
      contentPresent: true,
    };
  };
  const flowIndexForPosition = (flow, position) => {
    if (position.kind === "figure") return flow.flow.findIndex((item) => item.kind === "figure" && item.figureIndex === position.figureIndex);
    const unitIndex = flow.units.findIndex((unit) => unit.start <= position.sourceOffset && position.sourceOffset < unit.end);
    return flow.flow.findIndex((item) => item.kind === "unit" && item.unitIndex === Math.max(0, unitIndex));
  };
  return {
    async init() {
      if (options.initFails) throw new Error("wasm unavailable");
    },
    ready: () => !options.initFails,
    create() {
      lastHandle = { id: nextId++, state: initialState(), destroyed: false, flow: null };
      handles.add(lastHandle);
      return lastHandle;
    },
    dispatch(handle, command) {
      if (handle.destroyed) throw new Error("destroyed");
      commands.push(command);
      const previous = handle.state;
      let state = previous;
      let effects = [];
      if (command.type === "open" && previous.phase !== "ended") {
        state = { ...initialState(), phase: "preparing", requestId: command.requestId, generation: previous.generation + 1 };
        if (previous.phase === "reading") effects = [{ type: "cancelTimer" }];
      } else if (command.type === "prepareSucceeded" && previous.phase === "preparing" && previous.requestId === command.requestId) {
        handle.flow = command.flow;
        const playback = previous.preparationHidden ? "paused" : "playing";
        state = stateForFlow({ ...previous, generation: previous.generation + 1, preparationHidden: false }, command.flow, 0, playback);
        effects = playback === "playing"
          ? [{ type: "scheduleTick", generation: state.generation, delayMs: command.flow.units[command.flow.flow[0]?.unitIndex || 0]?.durationMs || 1 }]
          : [{ type: "cancelTimer" }];
      } else if (command.type === "prepareFailed" && previous.phase === "preparing" && previous.requestId === command.requestId) {
        state = { ...previous, phase: "error", reason: command.reason, generation: previous.generation + 1 };
        effects = [{ type: "cancelTimer" }];
      } else if (command.type === "cancel" && previous.phase === "preparing" && previous.requestId === command.requestId) {
        state = { ...initialState(), generation: previous.generation + 1 };
        effects = [{ type: "cancelTimer" }];
      } else if (command.type === "close") {
        state = { ...initialState(), phase: "ended", generation: previous.generation + 1 };
        effects = [{ type: "cancelTimer" }];
      } else if (command.type === "play" && previous.phase === "reading" && previous.currentKind === "unit") {
        state = { ...previous, playback: "playing", timerPending: true, generation: previous.generation + 1 };
        effects = [{ type: "scheduleTick", generation: state.generation, delayMs: handle.flow.units[previous.unitIndex]?.durationMs || 1 }];
      } else if (command.type === "pause" && previous.phase === "reading") {
        state = { ...previous, playback: "paused", timerPending: false, generation: previous.generation + 1 };
        effects = [{ type: "cancelTimer" }];
      } else if (command.type === "tick" && previous.phase === "reading" && previous.playback === "playing" && previous.generation === command.generation) {
        const nextIndex = previous.flowIndex + 1;
        const nextItem = handle.flow?.flow[nextIndex];
        if (!nextItem) {
          state = { ...previous, playback: "paused", timerPending: false, generation: previous.generation + 1 };
          effects = [{ type: "cancelTimer" }];
        } else {
          state = stateForFlow({ ...previous, generation: previous.generation + 1 }, handle.flow, nextIndex, nextItem.kind === "figure" ? "paused" : "playing");
          effects = nextItem.kind === "figure"
            ? [{ type: "cancelTimer" }]
            : [{ type: "scheduleTick", generation: state.generation, delayMs: handle.flow.units[nextItem.unitIndex]?.durationMs || 1 }];
        }
      } else if (command.type === "previousSentence" && previous.phase === "reading") {
        const target = handle.flow.flow.findIndex((item) => item.kind === "unit");
        const playback = previous.playback === "playing" ? "playing" : "paused";
        state = stateForFlow({ ...previous, generation: previous.generation + 1 }, handle.flow, Math.max(0, target), playback);
        effects = [{ type: "cancelTimer" }];
        if (playback === "playing") effects.push({ type: "scheduleTick", generation: state.generation, delayMs: handle.flow.units[state.unitIndex]?.durationMs || 1 });
      } else if ((command.type === "switchToText" || command.type === "switchToRsvp") && previous.phase === "reading") {
        const index = flowIndexForPosition(handle.flow, command.position);
        const target = Math.max(0, index);
        const playback = command.type === "switchToText"
          ? "paused"
          : handle.flow.flow[target]?.kind === "figure" ? "paused" : "playing";
        state = stateForFlow({ ...previous, generation: previous.generation + 1 }, handle.flow, target, playback);
        state = { ...state, mode: command.type === "switchToText" ? "text" : "rsvp", position: command.position, sourceOffset: command.position.sourceOffset };
        effects = [{ type: "cancelTimer" }];
        if (playback === "playing") effects.push({ type: "scheduleTick", generation: state.generation, delayMs: handle.flow.units[state.unitIndex]?.durationMs || 1 });
      } else if (command.type === "resumeFromFigure" && previous.phase === "reading" && previous.currentKind === "figure") {
        const nextIndex = previous.flowIndex + 1;
        const nextItem = handle.flow.flow[nextIndex];
        const playback = nextItem?.kind === "figure" ? "paused" : "playing";
        state = stateForFlow({ ...previous, generation: previous.generation + 1 }, handle.flow, nextIndex, playback);
        effects = playback === "playing"
          ? [{ type: "scheduleTick", generation: state.generation, delayMs: handle.flow.units[state.unitIndex]?.durationMs || 1 }]
          : [{ type: "cancelTimer" }];
      } else if (command.type === "rebuildUnits" && previous.phase === "reading") {
        handle.flow = { ...handle.flow, units: command.units };
        const playback = previous.playback;
        state = { ...previous, generation: previous.generation + 1 };
        effects = playback === "playing"
          ? [{ type: "scheduleTick", generation: state.generation, delayMs: command.units[state.unitIndex]?.durationMs || 1 }]
          : [{ type: "cancelTimer" }];
      } else if (command.type === "visibilityHidden" && previous.phase === "preparing" && !previous.preparationHidden) {
        state = { ...previous, preparationHidden: true, generation: previous.generation + 1 };
      } else if (command.type === "visibilityHidden" && previous.phase === "reading") {
        state = { ...previous, playback: "paused", timerPending: false, generation: previous.generation + 1 };
        effects = [{ type: "cancelTimer" }];
      }
      handle.state = state;
      return { state, effects };
    },
    destroy(handle) {
      handle.destroyed = true;
      handles.delete(handle);
    },
    liveHandleCount() {
      return handles.size;
    },
    snapshot() {
      return lastHandle?.state;
    },
  };
}

function createOutlineReaderHarness(options: { initFails?: boolean; mountFailsOnce?: boolean; unmountFailsOnce?: boolean } = {}) {
  const headingBeforeSelection = new FakeElement("h1", "記事タイトル");
  const headingInSelection = new FakeElement("h2", "次の節");
  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  const documentListeners = new Map();
  let resizeCallback = null;
  let resizeObserverLiveCount = 0;
  const document = {
    documentElement,
    body,
    activeElement: null,
    visibilityState: "visible",
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
  body.ownerDocument = document;
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
  let currentScrollX = 0;
  let currentScrollY = 0;
  let reduceMotion = false;
  const runtimeMessages = [];
  const sessionCommands = [];
  const session = createSessionStub(sessionCommands, options);
  const context: any = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve();
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
    ReaderSession: session,
    Intl,
    console,
    scrollTo(position) {
      currentScrollX = position.left;
      currentScrollY = position.top;
    },
    ResizeObserver: class {
      active: boolean;

      constructor(callback) {
        resizeCallback = callback;
        resizeObserverLiveCount += 1;
        this.active = true;
      }

      observe() {}

      disconnect() {
        if (this.active) {
          this.active = false;
          resizeObserverLiveCount -= 1;
        }
      }
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
  Object.defineProperties(context, {
    scrollX: { get: () => currentScrollX },
    scrollY: { get: () => currentScrollY },
  });
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "viewer", "viewer.js"), "utf8");
  loadReaderView(context, document);
  let reactMountCount = 0;
  let reactUnmountCount = 0;
  const originalReactMount = context.ReaderReactViewer.mount;
  context.ReaderReactViewer.mount = (host) => {
    const mount = originalReactMount(host);
    reactMountCount += 1;
    return {
      ...mount,
      unmount() {
        reactUnmountCount += 1;
        return mount.unmount();
      },
    };
  };
  if (options.mountFailsOnce) {
    const mount = context.ReaderReactViewer.mount;
    let failed = false;
    context.ReaderReactViewer.mount = (host) => {
      if (!failed) {
        failed = true;
        throw new Error("reader_view_mount_failed");
      }
      return mount(host);
    };
  }
  let unmountFailed = false;
  if (options.unmountFailsOnce) {
    const mount = context.ReaderReactViewer.mount;
    context.ReaderReactViewer.mount = (host) => {
      const mounted = mount(host);
      return {
        ...mounted,
        unmount() {
          mounted.unmount();
          if (!unmountFailed) {
            unmountFailed = true;
            throw new Error("reader_view_unmount_failed");
          }
        },
      };
    };
  }
  vm.runInNewContext(source, context);

  return {
    document,
    documentElement,
    body,
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
    setScrollPosition(left, top) {
      currentScrollX = left;
      currentScrollY = top;
    },
    setVisibilityState(state) {
      document.visibilityState = state;
      document.dispatchEvent({ type: "visibilitychange" });
    },
    listenerCount(type) {
      return (documentListeners.get(type) || []).length;
    },
    liveHandleCount() {
      return session.liveHandleCount();
    },
    reactMountCount() {
      return reactMountCount;
    },
    reactUnmountCount() {
      return reactUnmountCount;
    },
    resizeObserverLiveCount() {
      return resizeObserverLiveCount;
    },
    sessionState() {
      return session.snapshot();
    },
    scrollPosition() {
      return { left: currentScrollX, top: currentScrollY };
    },
    runtimeMessages,
    sessionCommands,
  };
}

test("Chrome React harness preserves attribute presence and DOM move semantics", () => {
  const root = new FakeElement("div");
  const first = new FakeElement("div");
  const second = new FakeElement("div");
  const child = new FakeElement("span");
  first.setAttribute("data-reader-marker", "true");
  root.append(first, second);
  first.append(child);
  assert.deepEqual(root.querySelectorAll("[data-reader-marker]"), [first]);
  assert.deepEqual(root.querySelectorAll("[data-reader-missing]"), []);
  second.append(child);
  assert.equal(first.children.includes(child), false);
  assert.equal(second.children.includes(child), true);
  assert.equal(child.parentNode, second);
  assert.equal(second.insertBefore(child, child), child);
  assert.deepEqual(second.children, [child]);
});

test("Chrome viewer leaves rendering to ReaderView", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "viewer", "viewer.ts"), "utf8");
  for (const symbol of [
    "createTopbar",
    "createMinimap",
    "createButton",
    "createTextBlock",
    "createTextFigure",
    "createVeiledImageSurface",
    "createFigureStatus",
    "scheduleFigureLoadingIndicator",
    "renderCurrentUnit",
    "applyUnitStyle",
    "updateMinimap",
    "fadeContext",
    "renderCurrentFlowItem",
    "showFigure",
    "loadingLayer",
    "progressLabel",
    "playbackState",
    "currentUnitIndex",
    "nextFigureIndex",
  ]) {
    assert.equal(source.includes(symbol), false, `obsolete Chrome renderer symbol: ${symbol}`);
  }
});

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
  assert.equal(indicator.animations.some(({ keyframes }) => keyframes.at(-1)?.transform === "translateX(0) scaleX(1)"), false);
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

test("reader keeps the 100ms loading state to an indeterminate bar", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "bar-only-request" });
  revealLoading(timers);
  const overlay = document.getElementById("__rsvp-reader-root");

  assert.ok(findElement(overlay, (element) => element.attributes["data-reader-loading-bar"] === "true"));
  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-loading-label"] === "true"), null);
  assert.equal(findElementByText(overlay, "中止"), null);
});

test("reader adds slow preparation status and a cancel action at 400ms", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "slow-request" });
  revealLoading(timers);
  const slowTimer = [...timers.entries()].find(([, timer]) => timer.delay === 400);
  assert.ok(slowTimer);
  timers.delete(slowTimer[0]);
  slowTimer[1].callback();

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.equal(
    findElement(overlay, (element) => element.attributes["data-reader-loading-label"] === "true").textContent,
    "文章を準備しています",
  );
  assert.ok(findElementByText(overlay, "中止"));
});

test("reader cancel closes loading and sends the request id to the service worker", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers, runtimeMessages, sessionCommands } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "cancel-request" });
  revealLoading(timers);
  const slowTimer = [...timers.entries()].find(([, timer]) => timer.delay === 400);
  timers.delete(slowTimer[0]);
  slowTimer[1].callback();
  findElementByText(document.getElementById("__rsvp-reader-root"), "中止").dispatchEvent({ type: "click" });

  assert.equal(runtimeMessages.length, 1);
  assert.equal(runtimeMessages[0].type, "CANCEL_RSVP");
  assert.equal(runtimeMessages[0].requestId, "cancel-request");
  assert.deepEqual(sessionCommands.map(({ type }) => type), ["open", "cancel", "close"]);
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
});

test("reader locks the source page during loading and restores overflow after cancel", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, body, messageListener, timers } = harness;
  documentElement.style.overflow = "scroll";
  body.style.overflow = "auto";
  harness.setScrollPosition(16, 480);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "loading-scroll-lock" });

  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");
  assert.deepEqual(harness.scrollPosition(), { left: 16, top: 480 });

  revealLoading(timers);
  const slowTimer = [...timers.entries()].find(([, timer]) => timer.delay === 400);
  assert.ok(slowTimer);
  timers.delete(slowTimer[0]);
  slowTimer[1].callback();
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.textContent === "中止")
    .dispatchEvent({ type: "click" });

  assert.equal(documentElement.style.overflow, "scroll");
  assert.equal(body.style.overflow, "auto");
  assert.deepEqual(harness.scrollPosition(), { left: 16, top: 480 });
});

test("reader locks the source page while ready and restores inline overflow and scroll on close", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, body, messageListener } = harness;
  documentElement.style.overflow = "scroll";
  body.style.overflow = "auto";
  harness.setScrollPosition(24, 640);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "ready-scroll-lock" });
  messageListener({ type: "START_RSVP", text: "表示中も元ページを固定します。", requestId: "ready-scroll-lock" });

  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");
  assert.deepEqual(harness.scrollPosition(), { left: 24, top: 640 });

  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });

  assert.equal(documentElement.style.overflow, "scroll");
  assert.equal(body.style.overflow, "auto");
  assert.deepEqual(harness.scrollPosition(), { left: 24, top: 640 });
});

test("reader locks the source page on an error and restores empty inline overflow on return", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, body, messageListener } = harness;
  harness.setScrollPosition(0, 320);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "error-scroll-lock" });
  messageListener({ type: "RSVP_ERROR", requestId: "error-scroll-lock", reason: "unsupported_page" });

  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");

  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.textContent === "元に戻る")
    .dispatchEvent({ type: "click" });

  assert.equal(documentElement.style.overflow, undefined);
  assert.equal(body.style.overflow, undefined);
  assert.deepEqual(harness.scrollPosition(), { left: 0, top: 320 });
});

test("reader preserves one source lock when a ready request is replaced and then closed", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, body, messageListener } = harness;
  documentElement.style.overflow = "overlay";
  body.style.overflow = "clip";
  harness.setScrollPosition(32, 720);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "first-scroll-lock" });
  messageListener({ type: "START_RSVP", text: "最初の表示です。", requestId: "first-scroll-lock" });
  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "second-scroll-lock" });
  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");
  messageListener({ type: "START_RSVP", text: "次の表示です。", requestId: "second-scroll-lock" });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });

  assert.equal(documentElement.style.overflow, "overlay");
  assert.equal(body.style.overflow, "clip");
  assert.deepEqual(harness.scrollPosition(), { left: 32, top: 720 });
});

test("reader restores the source lock when close cleanup throws", () => {
  const harness = createOutlineReaderHarness({ unmountFailsOnce: true });
  const { document, documentElement, body, messageListener } = harness;
  documentElement.style.overflow = "scroll";
  body.style.overflow = "auto";
  harness.setScrollPosition(40, 560);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "exception-scroll-lock" });
  messageListener({ type: "START_RSVP", text: "終了処理で例外が起きます。", requestId: "exception-scroll-lock" });

  assert.throws(
    () => messageListener({ type: "SHOW_RSVP_LOADING", requestId: "exception-replacement" }),
    /reader_view_unmount_failed/,
  );
  assert.equal(documentElement.style.overflow, "scroll");
  assert.equal(body.style.overflow, "auto");
  assert.deepEqual(harness.scrollPosition(), { left: 40, top: 560 });
});

test("reader attaches visibility lifecycle only while a session is active", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener, sessionCommands } = harness;

  assert.equal(harness.listenerCount("visibilitychange"), 0);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "lifecycle-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の本文です。次の文です。",
    requestId: "lifecycle-request",
  });

  assert.equal(harness.listenerCount("visibilitychange"), 1);
  harness.setVisibilityState("hidden");
  assert.equal(sessionCommands.at(-1)?.type, "visibilityHidden");

  const closeButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "readerを閉じる",
  );
  closeButton.dispatchEvent({ type: "click" });
  assert.equal(harness.listenerCount("visibilitychange"), 0);

  const commandCountAfterClose = sessionCommands.length;
  document.visibilityState = "hidden";
  document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(sessionCommands.length, commandCountAfterClose);
});

test("reader stays paused at the same position after visibility returns", () => {
  const harness = createOutlineReaderHarness();
  harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "visibility-round-trip" });
  harness.messageListener({
    type: "START_RSVP",
    text: "可視性が変わっても現在位置を維持します。次の文です。",
    requestId: "visibility-round-trip",
  });

  harness.setVisibilityState("hidden");
  const hiddenState = harness.sessionState();
  assert.equal(hiddenState.playback, "paused");
  assert.equal(harness.timers.size, 0);

  harness.setVisibilityState("visible");
  assert.deepEqual(harness.sessionState(), hiddenState);
  assert.equal(harness.timers.size, 0);
});

function readerCursor(state) {
  return {
    phase: state?.phase,
    flowIndex: state?.flowIndex,
    sourceOffset: state?.sourceOffset,
    currentKind: state?.currentKind,
  };
}

const chromeLateTimerScenarios = [
  {
    name: "pause",
    createHarness: () => createOutlineReaderHarness(),
    start(harness) {
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-pause" });
      harness.messageListener({ type: "START_RSVP", text: "最初の本文です。次の文です。", requestId: "late-pause" });
    },
    capture(harness) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      return entry[1].callback;
    },
    operate(harness) {
      const overlay = harness.document.getElementById("__rsvp-reader-root");
      findElement(overlay, (element) => element.attributes["aria-label"] === "一時停止")
        .dispatchEvent({ type: "click" });
    },
  },
  {
    name: "mode switch",
    createHarness: () => createOutlineReaderHarness(),
    start(harness) {
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-mode" });
      harness.messageListener({ type: "START_RSVP", text: "最初の本文です。次の文です。", requestId: "late-mode" });
    },
    capture(harness) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      return entry[1].callback;
    },
    operate(harness) {
      const overlay = harness.document.getElementById("__rsvp-reader-root");
      findElementByText(overlay, "文章で読む")
        .dispatchEvent({ type: "click" });
    },
  },
  {
    name: "figure",
    createHarness: () => createFigureReaderHarness(),
    start(harness) {
      const text = "結果を図1に示します。\n図1\n次の説明です。";
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-figure" });
      harness.messageListener({
        type: "START_RSVP",
        text,
        requestId: "late-figure",
        readingContext: {
          blocks: [
            { text: "結果を図1に示します。", kind: "paragraph", level: null, start: 0, end: 11 },
            { text: "次の説明です。", kind: "paragraph", level: null, start: 15, end: text.length },
          ],
          headings: [],
          sectionTransitions: [],
          initialHeadingIndex: -1,
          figures: [{
            src: "https://example.com/late.png",
            alt: "遅い画像",
            caption: "図1",
            sourceOffset: 12,
            sourceEnd: 14,
          }],
        },
      });
    },
    capture(harness) {
      let lateCallback = null;
      while (harness.sessionState()?.currentKind !== "figure") {
        const entry = [...harness.timers.entries()][0];
        assert.ok(entry, "figure is reached before playback timers end");
        harness.timers.delete(entry[0]);
        lateCallback = entry[1].callback;
        lateCallback();
      }
      assert.ok(lateCallback);
      return lateCallback;
    },
    operate(harness) {
      assert.equal(harness.sessionState()?.currentKind, "figure");
    },
  },
  {
    name: "resize",
    createHarness: () => createOutlineReaderHarness(),
    start(harness) {
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-resize" });
      harness.messageListener({ type: "START_RSVP", text: "最初の本文です。次の文です。", requestId: "late-resize" });
    },
    capture(harness) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      return entry[1].callback;
    },
    operate(harness) {
      const overlay = harness.document.getElementById("__rsvp-reader-root");
      const display = findElement(
        overlay,
        (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
      );
      display.clientWidth = 300;
      harness.resizeDisplay();
    },
  },
  {
    name: "close",
    createHarness: () => createOutlineReaderHarness(),
    start(harness) {
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-close" });
      harness.messageListener({ type: "START_RSVP", text: "最初の本文です。次の文です。", requestId: "late-close" });
    },
    capture(harness) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      return entry[1].callback;
    },
    operate(harness) {
      const overlay = harness.document.getElementById("__rsvp-reader-root");
      findElement(overlay, (element) => element.attributes["aria-label"] === "readerを閉じる")
        .dispatchEvent({ type: "click" });
    },
  },
  {
    name: "hidden",
    createHarness: () => createOutlineReaderHarness(),
    start(harness) {
      harness.messageListener({ type: "SHOW_RSVP_LOADING", requestId: "late-hidden" });
      harness.messageListener({ type: "START_RSVP", text: "最初の本文です。次の文です。", requestId: "late-hidden" });
    },
    capture(harness) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      return entry[1].callback;
    },
    operate(harness) {
      harness.setVisibilityState("hidden");
    },
  },
];

for (const scenario of chromeLateTimerScenarios) {
  test(`reader ignores a late callback after ${scenario.name}`, () => {
    const harness = scenario.createHarness();
    scenario.start(harness);
    const lateCallback = scenario.capture(harness);
    scenario.operate(harness);
    const stateAfterOperation = harness.sessionState();
    const cursorAfterOperation = readerCursor(stateAfterOperation);

    lateCallback();

    assert.deepEqual(readerCursor(harness.sessionState()), cursorAfterOperation);
    assert.deepEqual(harness.sessionState(), stateAfterOperation);
  });
}

test("reader renders content-not-found errors with retry and return actions", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "error-request" });
  messageListener({ type: "RSVP_ERROR", requestId: "error-request", reason: "content_not_found" });

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElementByText(overlay, "文章を読み取れませんでした"));
  const retry = findElementByText(overlay, "やり直す");
  const returnButton = findElementByText(overlay, "元に戻る");
  assert.ok(retry);
  assert.ok(returnButton);
});

test("reader renders unsupported-page errors with retry and return actions", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "unsupported-request" });
  messageListener({ type: "RSVP_ERROR", requestId: "unsupported-request", reason: "unsupported_page" });

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElementByText(overlay, "このページはまだ開けません"));
  assert.ok(findElementByText(overlay, "やり直す"));
  assert.ok(findElementByText(overlay, "元に戻る"));
});

test("reader renders extraction-failed errors with retry and return actions", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "extraction-request" });
  messageListener({ type: "RSVP_ERROR", requestId: "extraction-request", reason: "extraction_failed" });

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElementByText(overlay, "文章を準備できませんでした"));
  assert.ok(findElementByText(overlay, "やり直す"));
  assert.ok(findElementByText(overlay, "元に戻る"));
});

test("reader rejects a delayed start after session initialization fails", async () => {
  const harness = createOutlineReaderHarness({ initFails: true });
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "failed-session-request" });
  await Promise.resolve();
  await Promise.resolve();

  const overlay = document.getElementById("__rsvp-reader-root");
  assert.ok(findElementByText(overlay, "文章を準備できませんでした"));
  messageListener({
    type: "START_RSVP",
    text: "遅延して届いた本文です。",
    requestId: "failed-session-request",
  });

  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-stage"] === "true"), null);
  assert.ok(findElementByText(overlay, "やり直す"));
});

test("reader retries a classified error without replacing its launch focus", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener, runtimeMessages } = harness;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(launchButton);
  launchButton.focus();

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "error-request" });
  messageListener({ type: "RSVP_ERROR", requestId: "error-request", reason: "unsupported_page" });
  findElementByText(document.getElementById("__rsvp-reader-root"), "やり直す").dispatchEvent({ type: "click" });

  assert.equal(runtimeMessages[0].type, "RETRY_RSVP");
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "retry-request" });
  messageListener({ type: "START_RSVP", text: "再試行後の本文です。", requestId: "retry-request" });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる").dispatchEvent({ type: "click" });

  assert.equal(document.activeElement, launchButton);
});

test("reader preserves launch focus and source scroll when request B replaces preparing request A", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener, timers } = harness;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(launchButton);
  launchButton.focus();
  harness.setScrollPosition(12, 320);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "preparing-request-a" });
  revealLoading(timers);
  const slowTimer = [...timers.entries()].find(([, timer]) => timer.delay === 400);
  assert.ok(slowTimer);
  timers.delete(slowTimer[0]);
  slowTimer[1].callback();
  assert.equal(document.activeElement.textContent, "中止");

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "preparing-request-b" });
  messageListener({ type: "START_RSVP", text: "Bの本文です。", requestId: "preparing-request-b" });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる").dispatchEvent({ type: "click" });

  assert.equal(document.activeElement, launchButton);
  assert.deepEqual(harness.scrollPosition(), { left: 12, top: 320 });
});

test("reader preserves launch focus and source scroll when ready request A is reopened", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const launchButton = new FakeElement("button");
  launchButton.ownerDocument = document;
  documentElement.append(launchButton);
  launchButton.focus();
  harness.setScrollPosition(24, 640);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "ready-request-a" });
  messageListener({ type: "START_RSVP", text: "Aの本文です。", requestId: "ready-request-a" });
  assert.equal(document.activeElement.attributes["aria-label"], "readerを閉じる");

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "ready-request-b" });
  messageListener({ type: "START_RSVP", text: "Bの本文です。", requestId: "ready-request-b" });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる").dispatchEvent({ type: "click" });

  assert.equal(document.activeElement, launchButton);
  assert.deepEqual(harness.scrollPosition(), { left: 24, top: 640 });
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
  const modeButton = findElementByText(overlay, "文章で読む");
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

test("reader owns an open shadow root and presents its internal dialog in the top layer", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "shadow-dialog-request" });
  messageListener({
    type: "START_RSVP",
    text: "Shadow DOM内の本文です。",
    requestId: "shadow-dialog-request",
  });

  const host = document.getElementById("__rsvp-reader-root");
  assert.ok(host);
  assert.equal(host.dataset.readerOwned, "true");
  assert.ok(host.shadowRoot);
  assert.equal(host.shadowRoot.mode, "open");

  const dialog = findElement(host, (element) => element.tagName === "DIALOG");
  assert.ok(dialog);
  assert.notEqual(dialog, host);
  assert.equal(dialog.attributes["aria-label"], "reader");
  assert.equal(dialog.attributes["aria-modal"], "true");
  assert.equal(dialog.showModalCalls, 1);
  assert.equal(dialog.open, true);
  assert.equal(host.style.pointerEvents, "none");
  assert.equal(dialog.style.pointerEvents, "auto");
});

test("reader cleanup removes only its owned host when the page already uses the root id", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const pageElement = new FakeElement("div");
  pageElement.ownerDocument = document;
  pageElement.id = "__rsvp-reader-root";
  pageElement.textContent = "元ページの要素";
  documentElement.append(pageElement);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "same-id-request" });
  messageListener({
    type: "START_RSVP",
    text: "同名IDがあってもReaderを閉じられます。",
    requestId: "same-id-request",
  });

  const host = documentElement.children.find((element) => element.dataset.readerOwned === "true");
  assert.ok(host);
  const closeButton = findElement(host, (element) => element.attributes["aria-label"] === "readerを閉じる");
  closeButton.dispatchEvent({ type: "click" });

  assert.equal(pageElement.parent, documentElement);
  assert.equal(pageElement.textContent, "元ページの要素");
  assert.equal(host.parent, null);
});

test("reader cancel closes the dialog once and remains safe when Escape follows", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "cancel-dialog-request" });
  messageListener({
    type: "START_RSVP",
    text: "cancelイベントの本文です。",
    requestId: "cancel-dialog-request",
  });

  const host = document.getElementById("__rsvp-reader-root");
  const dialog = findElement(host, (element) => element.tagName === "DIALOG");
  let prevented = false;
  dialog.dispatchEvent({
    type: "cancel",
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
  assert.equal(dialog.closeCalls, 1);
  assert.equal(host.parent, null);

  document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {} });
  assert.equal(dialog.closeCalls, 1);
});

test("reader removes its focus listener when the dialog closes", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "focus-cleanup-request" });
  messageListener({
    type: "START_RSVP",
    text: "focus listenerのcleanupを確認します。",
    requestId: "focus-cleanup-request",
  });

  const host = document.getElementById("__rsvp-reader-root");
  const dialog = findElement(host, (element) => element.tagName === "DIALOG");
  assert.equal(dialog.listeners.get("focusin")?.length, 1);

  const closeButton = findElement(host, (element) => element.attributes["aria-label"] === "readerを閉じる");
  closeButton.dispatchEvent({ type: "click" });
  assert.equal(dialog.listeners.get("focusin")?.length, 0);
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
  const modeButton = findElementByText(overlay, "文章で読む");
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
  const closeButton = findElementByText(overlay, "元に戻る");
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
  assert.equal(document.activeElement.textContent, "やり直す");

  let tabPrevented = false;
  document.dispatchEvent({
    type: "keydown",
    key: "Tab",
    target: document.activeElement,
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

test("reader removes a failed React mount before reopening", () => {
  const harness = createOutlineReaderHarness({ mountFailsOnce: true });
  const { document, documentElement, messageListener, timers } = harness;
  const reactRoots = () => findElements(
    documentElement,
    (element) => element.attributes["data-reader-react-root"] === "true",
  );

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "mount-failure-request" });
  const revealTimer = [...timers.values()].find((timer) => timer.delay === 100);
  assert.ok(revealTimer);
  assert.throws(() => revealTimer.callback(), /reader_view_mount_failed/u);
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  assert.equal(documentElement.children.filter((element) => element.id === "__rsvp-reader-root").length, 0);
  assert.equal(reactRoots().length, 0);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "mount-reopen-request" });
  messageListener({ type: "START_RSVP", text: "再開後の本文です。", requestId: "mount-reopen-request" });
  assert.ok(document.getElementById("__rsvp-reader-root"));
  assert.equal(documentElement.children.filter((element) => element.id === "__rsvp-reader-root").length, 1);
  assert.equal(reactRoots().length, 1);
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる").dispatchEvent({ type: "click" });
  assert.equal(document.getElementById("__rsvp-reader-root"), null);
  assert.equal(reactRoots().length, 0);
});

test("reader releases the Session handle with each React mount", () => {
  const harness = createOutlineReaderHarness();
  const { document, documentElement, messageListener } = harness;
  const reactRoots = () => findElements(
    documentElement,
    (element) => element.attributes["data-reader-react-root"] === "true",
  );

  assert.equal(harness.liveHandleCount(), 0);
  assert.equal(harness.reactMountCount(), 0);
  assert.equal(harness.reactUnmountCount(), 0);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "resource-first" });
  messageListener({ type: "START_RSVP", text: "一回目の本文です。", requestId: "resource-first" });
  assert.equal(harness.liveHandleCount(), 1);
  assert.equal(harness.reactMountCount(), 1);
  assert.equal(reactRoots().length, 1);

  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.equal(harness.liveHandleCount(), 0);
  assert.equal(harness.reactMountCount(), harness.reactUnmountCount());
  assert.equal(reactRoots().length, 0);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "resource-second" });
  messageListener({ type: "START_RSVP", text: "二回目の本文です。", requestId: "resource-second" });
  assert.equal(harness.liveHandleCount(), 1);
  assert.equal(harness.reactMountCount(), 2);
  assert.equal(reactRoots().length, 1);

  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.equal(harness.liveHandleCount(), 0);
  assert.equal(harness.reactMountCount(), harness.reactUnmountCount());
  assert.equal(reactRoots().length, 0);
});

test("reader disconnects its ResizeObserver across close and reopen", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;

  assert.equal(harness.resizeObserverLiveCount(), 0);
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "resize-resource-first" });
  messageListener({ type: "START_RSVP", text: "サイズを監視する本文です。", requestId: "resize-resource-first" });
  assert.equal(harness.resizeObserverLiveCount(), 1);

  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.equal(harness.resizeObserverLiveCount(), 0);

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "resize-resource-second" });
  messageListener({ type: "START_RSVP", text: "再開後も一つだけ監視します。", requestId: "resize-resource-second" });
  assert.equal(harness.resizeObserverLiveCount(), 1);
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.equal(harness.resizeObserverLiveCount(), 0);
});

test("reader restores document listeners without multiplying them on reopen", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  const listenerCounts = () => ({
    visibility: harness.listenerCount("visibilitychange"),
    keydown: harness.listenerCount("keydown"),
  });

  assert.deepEqual(listenerCounts(), { visibility: 0, keydown: 0 });
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "listener-resource-first" });
  messageListener({ type: "START_RSVP", text: "リスナーを確認する本文です。", requestId: "listener-resource-first" });
  assert.deepEqual(listenerCounts(), { visibility: 1, keydown: 1 });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.deepEqual(listenerCounts(), { visibility: 0, keydown: 0 });

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "listener-resource-second" });
  messageListener({ type: "START_RSVP", text: "再開後のリスナーです。", requestId: "listener-resource-second" });
  assert.deepEqual(listenerCounts(), { visibility: 1, keydown: 1 });
  findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
    .dispatchEvent({ type: "click" });
  assert.deepEqual(listenerCounts(), { visibility: 0, keydown: 0 });
});

test("reader ignores a pending animation completion after close", async () => {
  const originalAnimate = FakeElement.prototype.animate;
  const finishers = [];
  FakeElement.prototype.animate = function (keyframes, options) {
    const animation = originalAnimate.call(this, keyframes, options);
    animation.finished = new Promise((resolve) => finishers.push(resolve));
    return animation;
  };
  try {
    const harness = createOutlineReaderHarness();
    const { document, documentElement, messageListener, timers } = harness;
    messageListener({ type: "SHOW_RSVP_LOADING", requestId: "animation-resource" });
    revealLoading(timers);
    const slowEntry = [...timers.entries()].find(([, timer]) => timer.delay === 400);
    assert.ok(slowEntry);
    timers.delete(slowEntry[0]);
    slowEntry[1].callback();
    assert.ok(finishers.length > 0);
    findElement(document.getElementById("__rsvp-reader-root"), (element) => element.attributes["aria-label"] === "readerを閉じる")
      .dispatchEvent({ type: "click" });
    assert.equal(harness.liveHandleCount(), 0);
    finishers.forEach((finish) => finish());
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(findElement(documentElement, (element) => element.attributes["data-reader-react-root"] === "true"), null);
    assert.equal(document.getElementById("__rsvp-reader-root"), null);
    assert.equal(harness.liveHandleCount(), 0);
  } finally {
    FakeElement.prototype.animate = originalAnimate;
  }
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
  const textModeButton = findElementByText(rsvpOverlay, "文章で読む");
  textModeButton.dispatchEvent({ type: "click" });

  const textOverlay = document.getElementById("__rsvp-reader-root");
  const textShell = findElement(
    textOverlay,
    (element) => element.attributes["data-reader-text-shell"] === "true",
  );
  const closeButton = findElement(textShell, (element) => element.attributes["aria-label"] === "readerを閉じる");
  const rsvpModeButton = findElementByText(textShell, "RSVPで読む");
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

test("reader restores the RSVP mode control and follows session autoplay", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, sessionCommands } = harness;

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "mode-focus-request" });
  messageListener({
    type: "START_RSVP",
    text: "最初の節です。次の節です。",
    requestId: "mode-focus-request",
  });
  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textOverlay = document.getElementById("__rsvp-reader-root");
  const textModeButton = findElementByText(textOverlay, "RSVPで読む");
  textModeButton.focus();
  textModeButton.dispatchEvent({ type: "click" });

  const rsvpModeButton = findElementByText(document.getElementById("__rsvp-reader-root"), "文章で読む");
  assert.equal(document.activeElement, rsvpModeButton);
  assert.deepEqual(
    sessionCommands
      .filter(({ type }) => type === "switchToText" || type === "switchToRsvp" || type === "pause")
      .map(({ type }) => type),
    ["switchToText", "switchToRsvp"],
  );
  assert.equal(sessionCommands.filter(({ type }) => type === "play").length, 0);
  assert.equal(findElement(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["aria-label"] === "一時停止",
  ).attributes["aria-pressed"], "true");
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

  const pageModeButton = findElementByText(pageOverlay, "文章で読む");
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
  const rsvpModeButton = findElementByText(textShell, "RSVPで読む");
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
  const modeButton = findElementByText(overlay, "文章で読む");
  modeButton.dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const textMarkers = findElements(textShell, (element) => element.dataset.readerPositionKind === "text");
  const figureMarker = findElement(textShell, (element) => element.dataset.readerPositionKind === "figure");
  const scroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const textModeButton = findElementByText(textShell, "RSVPで読む");

  assert.equal(textMarkers.length, 3);
  assert.equal(figureMarker.dataset.figureIndex, "0");
  assert.equal(figureMarker.dataset.sourceStart, String(figureOffset));
  scroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  textMarkers[0].rect = { top: -120, bottom: -20, left: 0, right: 300, width: 300, height: 100 };
  textMarkers[1].rect = { top: -80, bottom: 20, left: 0, right: 300, width: 300, height: 100 };
  figureMarker.rect = { top: 120, bottom: 260, left: 0, right: 300, width: 300, height: 140 };
  textMarkers[2].rect = { top: 280, bottom: 380, left: 0, right: 300, width: 300, height: 100 };
  scroller.dispatchEvent({ type: "scroll" });
  textModeButton.dispatchEvent({ type: "click" });

  const figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(figurePanel);
  assert.equal(figurePanel.dataset.figureIndex, "0");
  assert.equal(figurePanel.dataset.sourceStart, String(figureOffset));
});

test("reader keeps the current figure anchor ahead of earlier readable text", () => {
  const { document, messageListener, timers } = createFigureReaderHarness();
  const text = "前の文です。\n図1\n後の文です。";
  const readingContext = {
    language: "ja",
    title: "",
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/figure.png",
      alt: "図1",
      caption: "図1",
      sourceOffset: 7,
      sourceEnd: 9,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-anchor-request" });
  messageListener({ type: "START_RSVP", text, requestId: "figure-anchor-request", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  while (!findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像")) {
    const entry = [...timers.entries()][0];
    assert.ok(entry);
    timers.delete(entry[0]);
    entry[1].callback();
  }

  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const scroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const textMarkers = findElements(textShell, (element) => element.dataset.readerPositionKind === "text");
  const figureMarker = findElement(textShell, (element) => element.dataset.readerPositionKind === "figure");
  scroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  textMarkers[0].rect = { top: 80, bottom: 120, left: 0, right: 300, width: 300, height: 40 };
  figureMarker.rect = { top: 180, bottom: 320, left: 0, right: 300, width: 300, height: 140 };
  textMarkers[1].rect = { top: 360, bottom: 400, left: 0, right: 300, width: 300, height: 40 };

  findElementByText(textShell, "RSVPで読む").dispatchEvent({ type: "click" });

  const figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(figurePanel);
  assert.equal(figurePanel.dataset.figureIndex, "0");
});

test("reader ignores a clipped figure even when its center is readable", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  const text = "前の文です。図の前です。\n図1\n図の後です。";
  const figureOffset = "前の文です。図の前です。".length + 1;
  const trailingOffset = figureOffset + 3;
  const readingContext = {
    language: "ja",
    title: "",
    blocks: [
      { text: "前の文です。図の前です。", kind: "paragraph", level: null, start: 0, end: figureOffset - 1 },
      { text: "図の後です。", kind: "paragraph", level: null, start: trailingOffset, end: text.length },
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
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "clipped-figure-request" });
  messageListener({ type: "START_RSVP", text, requestId: "clipped-figure-request", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const textMarkers = findElements(textShell, (element) => element.dataset.readerPositionKind === "text");
  const figureMarker = findElement(textShell, (element) => element.dataset.readerPositionKind === "figure");
  const scroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const textModeButton = findElementByText(textShell, "RSVPで読む");

  scroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  textMarkers[0].rect = { top: -160, bottom: -60, left: 0, right: 300, width: 300, height: 100 };
  textMarkers[1].rect = { top: -120, bottom: -20, left: 0, right: 300, width: 300, height: 100 };
  figureMarker.rect = { top: 20, bottom: 220, left: 0, right: 300, width: 300, height: 200 };
  textMarkers[2].rect = { top: 280, bottom: 380, left: 0, right: 300, width: 300, height: 100 };
  scroller.scrollTop = 120;
  scroller.dispatchEvent({ type: "scroll" });
  textModeButton.dispatchEvent({ type: "click" });

  const figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  assert.equal(figurePanel, null);
  assert.equal(display.dataset.readerPositionKind, "text");
  assert.equal(display.dataset.sourceStart, String(trailingOffset));
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
    ReaderSession: createSessionStub([]),
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
  loadReaderView(context, document);
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

test("Chrome schedules the shared heading-transition durations", () => {
  const { messageListener, timers } = createTimingReaderHarness();
  const text = "短い、次です。";
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
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "parity-request" });
  messageListener({ type: "START_RSVP", text, requestId: "parity-request", readingContext });

  const [firstTimerId, firstTimer] = [...timers.entries()][0];
  assert.equal(firstTimer.delay, 612);
  timers.delete(firstTimerId);
  firstTimer.callback();
  const [secondTimer] = [...timers.values()];
  assert.equal(secondTimer.delay, 276);
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

test("reader keeps one timer and ends paused after a 30-minute-equivalent RSVP flow", () => {
  const longText = Array.from(
    { length: 1_550 },
    () => "これは三十分相当の長文を検証する文です。",
  ).join("");
  const { messageListener, timers, sessionState } = createOutlineReaderHarness();
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "long-flow-request" });
  messageListener({ type: "START_RSVP", text: longText, requestId: "long-flow-request" });

  let elapsedMs = 0;
  let firedTimerCount = 0;
  let maxPendingTimerCount = 0;
  while (timers.size > 0) {
    assert.equal(timers.size, 1);
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    elapsedMs += timer.delay;
    firedTimerCount += 1;
    timer.callback();
    maxPendingTimerCount = Math.max(maxPendingTimerCount, timers.size);
    assert.ok(firedTimerCount < 10_000);
  }

  const finalState = sessionState();
  assert.ok(elapsedMs >= 30 * 60 * 1_000);
  assert.ok(firedTimerCount > 3_000);
  assert.equal(maxPendingTimerCount, 1);
  assert.equal(finalState.phase, "reading");
  assert.equal(finalState.playback, "paused");
  assert.equal(finalState.timerPending, false);
  assert.equal(finalState.flowIndex, finalState.flowLength - 1);
  assert.equal(finalState.currentKind, "unit");
  assert.equal(finalState.position.kind, "text");
  assert.equal(finalState.sourceOffset, finalState.position.sourceOffset);
  assert.ok(finalState.sourceOffset > 0 && finalState.sourceOffset < longText.length);
});

test("reader progress reaches 100% when the final RSVP unit completes", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener, timers } = harness;
  const articleText = "これは文です。これは文です。これは文です。";

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "progress-final-unit" });
  messageListener({ type: "START_RSVP", text: articleText, requestId: "progress-final-unit" });

  const progress = findElements(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["data-reader-progress"] === "true",
  )[0];
  assert.ok(progress, "the reader shows one bottom-right progress meter");
  assert.equal(progress.textContent, "0%");

  const [firstTimerId, firstTimer] = [...timers.entries()][0];
  timers.delete(firstTimerId);
  firstTimer.callback();
  assert.equal(progress.textContent, "33%");

  while (timers.size > 0) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
  }

  assert.equal(progress.textContent, "100%");
});

test("reader keeps progress for the same source position across RSVP and text modes", () => {
  const harness = createOutlineReaderHarness();
  const { document, messageListener } = harness;
  const articleText = "これは文です。これは文です。これは文です。";

  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "progress-mode-switch" });
  messageListener({ type: "START_RSVP", text: articleText, requestId: "progress-mode-switch" });

  const rsvpProgress = findElements(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["data-reader-progress"] === "true",
  )[0];
  assert.equal(rsvpProgress.textContent, "0%");
  findElementByText(document.getElementById("__rsvp-reader-root"), "文章で読む")
    .dispatchEvent({ type: "click" });
  assert.equal(findElements(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["data-reader-progress"] === "true",
  )[0].textContent, "0%");

  findElementByText(document.getElementById("__rsvp-reader-root"), "RSVPで読む")
    .dispatchEvent({ type: "click" });
  assert.equal(findElements(
    document.getElementById("__rsvp-reader-root"),
    (element) => element.attributes["data-reader-progress"] === "true",
  )[0].textContent, "0%");
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
  const session = createSessionStub([]);
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
    ReaderSession: session,
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
  loadReaderView(context, document);
  vm.runInNewContext(source, context);

  return {
    document,
    documentElement,
    messageListener,
    timers,
    sessionState() {
      return session.snapshot();
    },
  };
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
  const resumeButton = findElement(overlay, (element) => element.attributes["aria-label"] === "続きを読む");
  const progress = findElements(
    overlay,
    (element) => element.attributes["data-reader-progress"] === "true",
  )[0];
  assert.equal(image.src, "https://example.com/chart.png");
  assert.equal(image.alt, "処理時間の比較グラフ");
  assert.ok(findElementByText(figurePanel, "図1 処理時間"));
  assert.ok(resumeButton);
  assert.equal(progress.textContent, `${Math.round((figureOffset / text.length) * 100)}%`);
  assert.ok(findElement(figurePanel, (element) => element.tagName === "BUTTON"));
  const imageSurface = findElement(
    figurePanel,
    (element) => element.attributes["data-reader-image-surface"] === "true",
  );
  const veil = findElement(
    figurePanel,
    (element) => element.attributes["data-reader-image-veil"] === "true",
  );
  assert.equal(veil.style.opacity, "1");
  assert.equal(imageSurface.attributes["aria-pressed"], "false");
  assert.equal(imageSurface.attributes["aria-label"], "画像を明るく表示");
  imageSurface.dispatchEvent({ type: "click" });
  assert.equal(veil.style.opacity, "0");
  assert.equal(imageSurface.attributes["aria-pressed"], "true");
  assert.equal(imageSurface.attributes["aria-label"], "画像を暗く表示");
  imageSurface.dispatchEvent({ type: "click" });
  assert.equal(veil.style.opacity, "1");
  assert.equal(imageSurface.attributes["aria-pressed"], "false");
  assert.equal(timers.size, 1);
  assert.deepEqual(Array.from(figurePanel.animations[0].keyframes, ({ opacity }) => opacity), [0, 1]);
  assert.equal(figurePanel.animations[0].options.duration, 180);
  assert.deepEqual(Array.from(display.animations.at(-1).keyframes, ({ opacity }) => opacity), [1, 0]);
});

test("reader reveals figure loading feedback after 100ms and resumes after a load failure", () => {
  const { document, messageListener, timers } = createFigureReaderHarness();
  const text = "前の文です。\n図1\n後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/delayed.png",
      alt: "遅延画像の説明",
      caption: "図1",
      sourceOffset: 7,
      sourceEnd: 9,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-delay" });
  messageListener({ type: "START_RSVP", text, requestId: "figure-delay", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  let figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  while (!figurePanel) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  }

  const status = findElement(figurePanel, (element) => element.attributes["data-reader-figure-status"] === "true");
  const image = findElement(figurePanel, (element) => element.tagName === "IMG");
  assert.equal(status.hidden, true);
  const revealEntry = [...timers.entries()].find(([, timer]) => timer.delay === 100);
  assert.ok(revealEntry);
  timers.delete(revealEntry[0]);
  revealEntry[1].callback();
  assert.equal(status.hidden, false);
  assert.ok(findElement(status, (element) => element.attributes["data-reader-figure-indicator"] === "true"));

  image.dispatchEvent({ type: "error" });
  assert.equal(status.textContent, "画像を読み込めませんでした");
  assert.equal(findElement(figurePanel, (element) => element.attributes["data-reader-figure-description"] === "true").hidden, false);
  const resumeButton = findElement(overlay, (element) => element.attributes["aria-label"] === "続きを読む");
  assert.ok(resumeButton);
  resumeButton.dispatchEvent({ type: "click" });
  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-position-kind"] === "figure"), null);
  assert.match(findElement(overlay, (element) => element.attributes["data-reader-unit"] === "true").textContent, /後の文/u);
});

test("reader ignores a stale figure completion after switching modes", async () => {
  const { document, messageListener, timers } = createFigureReaderHarness();
  const text = "前の文です。\n図1\n後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/slow.png",
      alt: "遅い画像",
      caption: "図1",
      sourceOffset: 7,
      sourceEnd: 9,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-stale" });
  messageListener({ type: "START_RSVP", text, requestId: "figure-stale", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  let oldPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  while (!oldPanel) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    oldPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  }
  const oldImage = findElement(oldPanel, (element) => element.tagName === "IMG");
  const modeButton = findElementByText(overlay, "文章で読む");
  modeButton.dispatchEvent({ type: "click" });
  findElementByText(overlay, "RSVPで読む").dispatchEvent({ type: "click" });
  const currentPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  const currentStatus = findElement(currentPanel, (element) => element.attributes["data-reader-figure-status"] === "true");
  oldImage.dispatchEvent({ type: "load" });
  await Promise.resolve();
  assert.equal(currentStatus.hidden, true);
  assert.equal(currentPanel.dataset.figureIndex, "0");
});

test("reader preserves the order of figures that share one source offset", () => {
  const { document, messageListener, timers } = createFigureReaderHarness();
  const text = "前の文です。図図後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 8, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [
      { src: "https://example.com/one.png", alt: "一枚目", caption: "図A", sourceOffset: 7, sourceEnd: 8 },
      { src: "https://example.com/two.png", alt: "二枚目", caption: "図B", sourceOffset: 7, sourceEnd: 8 },
    ],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "figure-same-offset" });
  messageListener({ type: "START_RSVP", text, requestId: "figure-same-offset", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  let firstPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  while (!firstPanel) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
    firstPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  }
  assert.equal(firstPanel.dataset.figureIndex, "0");
  findElement(overlay, (element) => element.attributes["aria-label"] === "続きを読む").dispatchEvent({ type: "click" });
  const secondPanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.equal(secondPanel.dataset.figureIndex, "1");
  assert.ok(findElementByText(secondPanel, "図B"));
});

test("reader preserves same-offset figure order in text mode", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const text = "前の文です。図図図後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [
      { src: "https://example.com/one.png", alt: "一枚目", caption: "図A", sourceOffset: 7, sourceEnd: 8 },
      { src: "https://example.com/two.png", alt: "二枚目", caption: "図B", sourceOffset: 7, sourceEnd: 8 },
      { src: "https://example.com/three.png", alt: "三枚目", caption: "図C", sourceOffset: 7, sourceEnd: 8 },
    ],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "text-same-offset-figures" });
  messageListener({ type: "START_RSVP", text, requestId: "text-same-offset-figures", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const figureMarkers = findElements(
    textShell,
    (element) => element.dataset.readerPositionKind === "figure",
  );

  assert.deepEqual(figureMarkers.map((element) => element.dataset.figureIndex), ["0", "1", "2"]);
});

test("reader shows an extracted title before a different first block", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const title = "抽出された記事タイトル";
  const text = "本文の最初の段落です。本文の続きです。";
  const readingContext = {
    title,
    blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
    headings: [],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "title-different-block" });
  messageListener({ type: "START_RSVP", text, requestId: "title-different-block", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const titleHeadings = findElements(textShell, (element) => element.tagName === "H1");
  const article = findElement(textShell, (element) => element.tagName === "ARTICLE");

  assert.equal(titleHeadings.length, 1);
  assert.equal(titleHeadings[0].textContent, title);
  assert.deepEqual(article.children.map((element) => element.tagName), ["H1", "P"]);
  assert.equal(findElement(textShell, (element) => element.tagName === "P").children.length, 2);
});

test("reader does not duplicate an extracted title already present in the first h1 block", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const title = "記事の見出し";
  const text = `${title}\n本文です。`;
  const readingContext = {
    title,
    blocks: [
      { text: title, kind: "heading", level: 1, start: 0, end: title.length },
      { text: "本文です。", kind: "paragraph", level: null, start: title.length + 1, end: text.length },
    ],
    headings: [{ text: title, level: 1 }],
    sectionOffsets: [0],
    sectionTransitions: [{ offset: 0, headingIndex: 0 }],
    initialHeadingIndex: 0,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "title-existing-heading" });
  messageListener({ type: "START_RSVP", text, requestId: "title-existing-heading", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const titleHeadings = findElements(textShell, (element) => element.tagName === "H1");

  assert.equal(titleHeadings.length, 1);
});

test("reader omits an empty extracted title", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const text = "選択範囲の本文です。";
  const readingContext = {
    title: "",
    blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
    headings: [],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "title-empty" });
  messageListener({ type: "START_RSVP", text, requestId: "title-empty", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");

  assert.equal(findElements(textShell, (element) => element.tagName === "H1").length, 0);
  assert.ok(findElement(textShell, (element) => element.tagName === "P"));
});

test("reader omits an empty title for a selection range", () => {
  const { document, messageListener } = createOutlineReaderHarness();
  const text = "選択範囲から起動した本文です。";
  const readingContext = {
    title: "",
    blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
    headings: [],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "selection-title-empty" });
  messageListener({ type: "START_RSVP", text, requestId: "selection-title-empty", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");

  assert.equal(findElements(textShell, (element) => element.tagName === "H1").length, 0);
  assert.ok(findElement(textShell, (element) => element.tagName === "P"));
});

test("reader keeps source position and progress unchanged when adding an extracted title", () => {
  const { document, messageListener, sessionState } = createFigureReaderHarness();
  const title = "抽出された記事タイトル";
  const text = "本文の最初の文です。本文の次の文です。";
  const readingContext = {
    title,
    blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
    headings: [],
    sectionOffsets: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "title-position" });
  messageListener({ type: "START_RSVP", text, requestId: "title-position", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  const initialState = sessionState();
  const initialProgress = findElement(overlay, (element) => element.attributes["data-reader-progress"] === "true").textContent;
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
  const titleHeading = findElement(textShell, (element) => element.tagName === "H1");
  const textProgress = findElement(textShell, (element) => element.attributes["data-reader-progress"] === "true");

  assert.ok(titleHeading);
  assert.equal(titleHeading.textContent, title);
  assert.equal(titleHeading.attributes["data-reader-position-kind"], undefined);
  assert.equal(titleHeading.attributes["data-source-start"], undefined);
  assert.equal(textProgress.textContent, initialProgress);
  assert.equal(sessionState().sourceOffset, initialState.sourceOffset);
  assert.equal(sessionState().position.kind, initialState.position.kind);
  assert.equal(sessionState().position.sourceOffset, initialState.position.sourceOffset);

  findElementByText(textShell, "RSVPで読む").dispatchEvent({ type: "click" });
  assert.equal(sessionState().sourceOffset, initialState.sourceOffset);
  assert.equal(sessionState().position.kind, initialState.position.kind);
  assert.equal(sessionState().position.sourceOffset, initialState.position.sourceOffset);
  assert.equal(findElement(overlay, (element) => element.attributes["data-reader-progress"] === "true").textContent, initialProgress);
});

test("reader preserves an article-leading figure through a text round trip", () => {
  const { document, messageListener, sessionState } = createFigureReaderHarness();
  const text = "図A\n本文です。";
  const readingContext = {
    blocks: [
      { text: "本文です。", kind: "paragraph", level: null, start: 3, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/leading.png",
      alt: "先頭画像",
      caption: "図A",
      sourceOffset: 0,
      sourceEnd: 2,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "leading-figure-round-trip" });
  messageListener({ type: "START_RSVP", text, requestId: "leading-figure-round-trip", readingContext });

  const overlay = document.getElementById("__rsvp-reader-root");
  const initialFigure = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(initialFigure);
  assert.equal(initialFigure.dataset.figureIndex, "0");
  assert.equal(sessionState()?.position.kind, "figure");
  assert.equal(sessionState()?.position.sourceOffset, 0);

  const restoreGeometry = installTextFigureGeometry();
  try {
    findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
    const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
    const textFigure = findElement(textShell, (element) => element.attributes["data-reader-text-figure"] === "true");
    const textScroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
    assert.ok(textFigure && textScroller);
    assert.equal(textFigure.dataset.figureIndex, "0");
    assert.equal(textFigure.dataset.sourceStart, "0");
    const firstGeometry = textFigure.getBoundingClientRect();
    const firstScrollerGeometry = textScroller.getBoundingClientRect();
    assert.ok(textScroller.scrollTop > 0);
    assert.ok(firstGeometry.top >= firstScrollerGeometry.top + 72);
    assert.ok(firstGeometry.bottom <= firstScrollerGeometry.bottom - 112);

    findElementByText(textShell, "RSVPで読む").dispatchEvent({ type: "click" });
    const restoredFigure = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
    assert.ok(restoredFigure);
    assert.equal(restoredFigure.dataset.figureIndex, "0");
    assert.equal(sessionState()?.currentKind, "figure");
    assert.equal(sessionState()?.playback, "paused");

    findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
    const restoredTextShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
    const restoredTextFigure = findElement(restoredTextShell, (element) => element.attributes["data-reader-text-figure"] === "true");
    const restoredTextScroller = findElement(restoredTextShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
    assert.ok(restoredTextFigure && restoredTextScroller);
    const restoredGeometry = restoredTextFigure.getBoundingClientRect();
    const restoredScrollerGeometry = restoredTextScroller.getBoundingClientRect();
    assert.ok(restoredTextScroller.scrollTop > 0);
    assert.ok(restoredGeometry.top >= restoredScrollerGeometry.top + 72);
    assert.ok(restoredGeometry.bottom <= restoredScrollerGeometry.bottom - 112);
  } finally {
    restoreGeometry();
  }
});

test("reader preserves an article-ending figure through a text round trip", () => {
  const { document, messageListener, timers, sessionState } = createFigureReaderHarness();
  const leadingText = "本文です。";
  const figureOffset = leadingText.length + 1;
  const text = `${leadingText}\n図A`;
  const readingContext = {
    blocks: [
      { text: leadingText, kind: "paragraph", level: null, start: 0, end: leadingText.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/ending.png",
      alt: "末尾画像",
      caption: "図A",
      sourceOffset: figureOffset,
      sourceEnd: text.length,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "ending-figure-round-trip" });
  messageListener({ type: "START_RSVP", text, requestId: "ending-figure-round-trip", readingContext });

  while (sessionState()?.currentKind !== "figure") {
    const entry = [...timers.entries()][0];
    assert.ok(entry, "the ending figure is reached before playback timers end");
    timers.delete(entry[0]);
    entry[1].callback();
  }
  const overlay = document.getElementById("__rsvp-reader-root");
  const initialFigure = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(initialFigure);
  assert.equal(initialFigure.dataset.figureIndex, "0");
  assert.equal(initialFigure.dataset.sourceStart, String(figureOffset));

  const restoreGeometry = installTextFigureGeometry();
  try {
    findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
    const textShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
    const textFigure = findElement(textShell, (element) => element.attributes["data-reader-text-figure"] === "true");
    const textScroller = findElement(textShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
    assert.ok(textFigure && textScroller);
    assert.equal(textFigure.dataset.figureIndex, "0");
    assert.equal(textFigure.dataset.sourceStart, String(figureOffset));
    const firstGeometry = textFigure.getBoundingClientRect();
    const firstScrollerGeometry = textScroller.getBoundingClientRect();
    assert.ok(textScroller.scrollTop > 0);
    assert.ok(firstGeometry.top >= firstScrollerGeometry.top + 72);
    assert.ok(firstGeometry.bottom <= firstScrollerGeometry.bottom - 112);

    findElementByText(textShell, "RSVPで読む").dispatchEvent({ type: "click" });
    const restoredFigure = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
    assert.ok(restoredFigure);
    assert.equal(restoredFigure.dataset.figureIndex, "0");
    assert.equal(sessionState()?.currentKind, "figure");
    assert.equal(sessionState()?.playback, "paused");

    findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
    const restoredTextShell = findElement(overlay, (element) => element.attributes["data-reader-text-shell"] === "true");
    const restoredTextFigure = findElement(restoredTextShell, (element) => element.attributes["data-reader-text-figure"] === "true");
    const restoredTextScroller = findElement(restoredTextShell, (element) => element.attributes["data-reader-text-scroller"] === "true");
    assert.ok(restoredTextFigure && restoredTextScroller);
    const restoredGeometry = restoredTextFigure.getBoundingClientRect();
    const restoredScrollerGeometry = restoredTextScroller.getBoundingClientRect();
    assert.ok(restoredTextScroller.scrollTop > 0);
    assert.ok(restoredGeometry.top >= restoredScrollerGeometry.top + 72);
    assert.ok(restoredGeometry.bottom <= restoredScrollerGeometry.bottom - 112);
  } finally {
    restoreGeometry();
  }
});

test("reader returns from an image to the previous sentence and stays paused", async () => {
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
  assert.ok(findElement(overlay, (element) => element.attributes["aria-label"] === "再生"));
  assert.equal(timers.size, 0);
  findElement(overlay, (element) => element.attributes["aria-label"] === "再生").dispatchEvent({ type: "click" });
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

  const textModeButton = findElementByText(overlay, "文章で読む");
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
  assert.ok(findElementByText(textFigure, "図1 処理時間"));
});

test("reader preserves the text marker when an earlier responsive text image changes layout", () => {
  const { document, messageListener, timers } = createFigureReaderHarness();
  const text = "前の文です。\n図1\n後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/delayed-text.png",
      srcset: "https://example.com/delayed-text@1x.png 1x, https://example.com/delayed-text@2x.png 2x",
      sizes: "100vw",
      alt: "遅延画像",
      caption: "図1",
      sourceOffset: 7,
      sourceEnd: 9,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "text-correction-before" });
  messageListener({ type: "START_RSVP", text, requestId: "text-correction-before", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  let figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  while (!figurePanel) {
    const entry = [...timers.entries()][0];
    assert.ok(entry);
    timers.delete(entry[0]);
    entry[1].callback();
    figurePanel = findElement(overlay, (element) => element.attributes["aria-label"] === "本文画像");
  }
  const figureImage = findElement(figurePanel, (element) => element.tagName === "IMG");
  figureImage.dispatchEvent({ type: "error" });
  findElement(overlay, (element) => element.attributes["aria-label"] === "続きを読む").dispatchEvent({ type: "click" });
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });

  const scroller = findElement(overlay, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const afterImageMarker = findElement(
    scroller,
    (element) => element.dataset.readerPositionKind === "text"
      && Number(element.dataset.sourceStart) > 7,
  );
  const textFigure = findElement(scroller, (element) => element.attributes["data-reader-text-figure"] === "true");
  const textImage = findElement(textFigure, (element) => element.tagName === "IMG");
  assert.ok(scroller && afterImageMarker && textImage);
  assert.equal(textImage.srcset, "https://example.com/delayed-text@1x.png 1x, https://example.com/delayed-text@2x.png 2x");
  assert.equal(textImage.sizes, "100vw");
  const initialScrollTop = scroller.scrollTop;
  let adjustedScrollTop = initialScrollTop;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => adjustedScrollTop,
    set: (value) => {
      const delta = value - adjustedScrollTop;
      adjustedScrollTop = value;
      afterImageMarker.rect = {
        top: afterImageMarker.rect.top - delta,
        bottom: afterImageMarker.rect.bottom - delta,
        left: 0,
        right: 390,
        width: 390,
        height: 100,
      };
    },
  });
  afterImageMarker.rect = { top: 100, bottom: 200, left: 0, right: 390, width: 390, height: 100 };
  textImage.dispatchEvent({ type: "load" });

  assert.equal(afterImageMarker.getBoundingClientRect().top, 0);
  assert.equal(scroller.scrollTop, initialScrollTop + 100);
});

test("reader leaves scroll position unchanged for a text image below the marker", () => {
  const { document, messageListener } = createFigureReaderHarness();
  const text = "前の文です。\n図1\n後の文です。";
  const readingContext = {
    blocks: [
      { text: "前の文です。", kind: "paragraph", level: null, start: 0, end: 6 },
      { text: "後の文です。", kind: "paragraph", level: null, start: 9, end: text.length },
    ],
    headings: [],
    sectionTransitions: [],
    initialHeadingIndex: -1,
    figures: [{
      src: "https://example.com/later-text.png",
      alt: "後方画像",
      caption: "図1",
      sourceOffset: 7,
      sourceEnd: 9,
    }],
  };
  messageListener({ type: "SHOW_RSVP_LOADING", requestId: "text-correction-after" });
  messageListener({ type: "START_RSVP", text, requestId: "text-correction-after", readingContext });
  const overlay = document.getElementById("__rsvp-reader-root");
  findElementByText(overlay, "文章で読む").dispatchEvent({ type: "click" });
  const scroller = findElement(overlay, (element) => element.attributes["data-reader-text-scroller"] === "true");
  const textFigure = findElement(scroller, (element) => element.attributes["data-reader-text-figure"] === "true");
  const textImage = findElement(textFigure, (element) => element.tagName === "IMG");
  assert.ok(scroller && textImage);
  const initialScrollTop = scroller.scrollTop;
  textImage.dispatchEvent({ type: "load" });
  assert.equal(scroller.scrollTop, initialScrollTop);
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
  assert.equal(findElementContainingText(secondOverlay, "最初の本文"), null);
});
