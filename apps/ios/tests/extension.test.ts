export {};

import { FakeElement, findElement, findElements } from "./fake-dom";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../../../.build/packages/engine/src/engine.js");

function createSessionStub(commands, options: { init?: () => Promise<void>; ready?: () => boolean } = {}) {
  let nextId = 1;
  const handles = new Map();
  let lastHandle = null;
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
      : {
        kind: "text",
        sourceOffset: flow.units[item.unitIndex]?.start ?? item.sourceOffset,
      };
    return {
      ...state,
      phase: "reading",
      mode: state.mode || "rsvp",
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
    if (position.kind === "figure") {
      return flow.flow.findIndex((item) => item.kind === "figure" && item.figureIndex === position.figureIndex);
    }
    const unitIndex = flow.units.findIndex((unit) => unit.start <= position.sourceOffset && position.sourceOffset < unit.end);
    return flow.flow.findIndex((item) => item.kind === "unit" && item.unitIndex === Math.max(0, unitIndex));
  };
  const api = {
    async init() {
      if (options.init) await options.init();
    },
    ready: () => options.ready?.() ?? true,
    create() {
      const handle = { id: nextId++, state: initialState(), destroyed: false, flow: null };
      handles.set(handle.id, handle);
      lastHandle = handle;
      return handle;
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
      } else if (command.type === "prepareSucceeded") {
        if (previous.phase === "preparing" && previous.requestId === command.requestId) {
          handle.flow = command.flow;
          const playback = previous.preparationHidden ? "paused" : "playing";
          state = stateForFlow({ ...previous, generation: previous.generation + 1, preparationHidden: false }, command.flow, 0, playback);
          effects = playback === "playing"
            ? [{ type: "scheduleTick", generation: state.generation, delayMs: command.flow.units[command.flow.flow[0]?.unitIndex || 0]?.durationMs || 1 }]
            : [{ type: "cancelTimer" }];
        }
      } else if (command.type === "prepareFailed") {
        if (previous.phase === "preparing" && previous.requestId === command.requestId) {
          state = { ...previous, phase: "error", reason: command.reason, generation: previous.generation + 1 };
          effects = [{ type: "cancelTimer" }];
        }
      } else if (command.type === "cancel") {
        if (previous.phase === "preparing" && previous.requestId === command.requestId) {
          state = { ...initialState(), generation: previous.generation + 1 };
          effects = [{ type: "cancelTimer" }];
        }
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
        state = stateForFlow({ ...previous, mode: command.type === "switchToText" ? "text" : "rsvp", generation: previous.generation + 1 }, handle.flow, target, playback);
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
      handles.delete(handle.id);
      handle.destroyed = true;
    },
    snapshot() {
      return lastHandle?.state;
    },
  };
  return api;
}

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "ReaderExtension", "Resources", "manifest.json");

function fireNextTimer(timers) {
  const [timerId, timer] = [...timers.entries()][0];
  timers.delete(timerId);
  timer.callback();
}

function fireTimerWithDelay(timers, delay) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
  assert.ok(entry, `timer with ${delay}ms delay is scheduled`);
  timers.delete(entry[0]);
  entry[1].callback();
}

test("Safari extension loads reader resources in dependency order", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: [
      "defuddle.js",
      "session-wasm-module.js",
      "session.js",
      "engine.js",
      "extractor.js",
      "icons.js",
      "viewer.js",
      "reader_session_bg.wasm",
    ],
    matches: ["<all_urls>"],
  }]);
  assert.deepEqual(manifest.content_scripts[0].js, ["bootstrap.js"]);
});

test("Xcode project embeds every manifest script in the extension", () => {
  const project = fs.readFileSync(path.join(root, "reader.xcodeproj", "project.pbxproj"), "utf8");
  assert.match(project, /defuddle\.js in Resources/);
  assert.match(project, /session-wasm-module\.js in Resources/);
  assert.match(project, /session\.js in Resources/);
  assert.match(project, /reader_session_bg\.wasm in Resources/);
  assert.match(project, /reader-session-dependencies\.txt in Resources/);
  assert.match(project, /engine\.js in Resources/);
  assert.match(project, /extractor\.js in Resources/);
  assert.match(project, /icons\.js in Resources/);
  assert.match(project, /viewer\.js in Resources/);
  assert.match(project, /bootstrap\.js in Resources/);
  assert.match(project, /reader-extension\.appex in Embed Foundation Extensions/);
  assert.equal(project.includes("RELEASE_CHECKLIST.md"), false);
});

test("Safari package includes the locked React runtime notices", () => {
  const session = fs.readFileSync(path.join(root, "ReaderExtension", "Resources", "generated", "session.js"), "utf8");
  assert.equal(session.includes("require("), false);
  assert.match(session, /ReaderReactViewer/u);
  assert.match(session, /createRoot/u);
  const notice = fs.readFileSync(path.join(root, "ReaderExtension", "Resources", "generated", "reader-session-dependencies.txt"), "utf8");
  for (const packageName of ["react@19.2.8", "react-dom@19.2.8", "scheduler@0.27.0", "esbuild@0.28.2"]) {
    assert.match(notice, new RegExp(`${packageName.replace(/[.]/gu, "\\.")}\\nDeclared license: MIT`, "u"));
  }
  assert.match(notice, /Permission is hereby granted, free of charge/u);
});

test("Safari viewer leaves loading and rendering to ReaderView", () => {
  const source = fs.readFileSync(path.join(root, "ReaderExtension", "Resources", "viewer", "viewer.ts"), "utf8");
  for (const symbol of ["createLaunchFeedback", "revealLaunchProgress", "finishLaunchProgress", "launchProgress.element", "launchProgress.animation", "showRewindFeedback", "global.ReaderIcons.create", "feedback.append"]) {
    assert.equal(source.includes(symbol), false, `obsolete Safari renderer symbol: ${symbol}`);
  }
});

test("Safari React harness preserves DOM move and hierarchy semantics", () => {
  const root = new FakeElement("div");
  const first = new FakeElement("div");
  const second = new FakeElement("div");
  const child = new FakeElement("span");
  root.append(first, second);
  first.append(child);
  second.append(child);
  assert.equal(first.children.includes(child), false);
  assert.equal(second.children.includes(child), true);
  assert.equal(second.insertBefore(child, child), child);
  assert.deepEqual(second.children, [child]);
  assert.throws(() => child.append(root), /invalid DOM hierarchy/u);
});

function createSafariReaderHarness(
  engine = Engine,
  language = "ja",
  options: { pageOwnedHost?: boolean; init?: () => Promise<void>; ready?: () => boolean; mountFailsOnce?: boolean; reducedMotion?: boolean } = {},
) {
  const documentElement = new FakeElement("html");
  documentElement.lang = language;
  const body = new FakeElement("body");
  documentElement.append(body);
  if (options.pageOwnedHost) {
    const pageOwnedHost = new FakeElement("div");
    pageOwnedHost.id = "__reader-host";
    pageOwnedHost.textContent = "ページ側の要素";
    body.append(pageOwnedHost);
  }
  const createdElements: FakeElement[] = [];
  const documentListeners = new Map();
  const document = {
    nodeType: 9,
    documentElement,
    body,
    defaultView: null,
    activeElement: null,
    title: "",
    visibilityState: "visible",
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = document;
      createdElements.push(element);
      return element;
    },
    createElementNS(_namespace, tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = document;
      element.namespaceURI = _namespace;
      createdElements.push(element);
      return element;
    },
    createTextNode(value) {
      const node = new FakeElement("#text", value);
      node.nodeType = 3;
      node.nodeName = "#text";
      node.ownerDocument = document;
      return node;
    },
    createComment(value) {
      const node = new FakeElement("#comment", value);
      node.nodeType = 8;
      node.nodeName = "#comment";
      node.ownerDocument = document;
      return node;
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
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
  const leadingSentence = "画像より前にあるとても長い文章をここで読んでいます。";
  const caption = "図1";
  const followingSentence = "画像の後です。";
  const laterSentence = "さらに後の文章です。";
  const figureOffset = 27;
  const figureEnd = 29;
  const followingOffset = 30;
  const laterOffset = 38;
  const text = `${leadingSentence}\n${caption}\n${followingSentence}\n${laterSentence}`;
  const content = {
    text,
    readingContext: {
      language,
      title: "",
      blocks: [
        { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: 26 },
        { text: followingSentence, kind: "paragraph", level: null, start: 30, end: 37 },
        { text: laterSentence, kind: "paragraph", level: null, start: 38, end: 48 },
      ],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [{
        src: "https://example.com/figure.png",
        srcset: "https://example.com/figure@1x.png 1x, https://example.com/figure@2x.png 2x",
        sizes: "100vw",
        alt: "本文画像",
        caption,
        sourceOffset: figureOffset,
        sourceEnd: figureEnd,
      }],
    },
  };
  let activeContent = content;
  let nextTimerId = 1;
  const timers = new Map();
  let launchFeedbackDuringExtraction = null;
  let extractionCount = 0;
  let now = 0;
  const performanceMarks = [];
  const sessionCommands = [];
  const globalListeners = new Map();
  const animationFrames = [];
  const session = createSessionStub(sessionCommands, options);
  const context: any = {
    document,
    location: { href: "https://example.com/articles/first" },
    Engine: engine,
    Extractor: {
      fromPage: () => {
        extractionCount += 1;
        now = 120;
        launchFeedbackDuringExtraction = findElement(
          documentElement,
          (element) => element.className === "launch-feedback",
        );
        return activeContent;
      },
    },
    ReaderIcons: { create: () => new FakeElement("svg") },
    Defuddle: class {},
    innerWidth: 390,
    innerHeight: 844,
    scrollY: 0,
    console,
    performance: {
      mark(name) {
        performanceMarks.push(name);
      },
      now() {
        return now;
      },
    },
    __READER_PERFORMANCE_ENABLED: true,
    Date: { now: () => now },
    matchMedia: () => ({ matches: options.reducedMotion === true }),
    addEventListener(type, listener) {
      const listeners = globalListeners.get(type) || [];
      listeners.push(listener);
      globalListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      globalListeners.set(
        type,
        (globalListeners.get(type) || []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchEvent(event) {
      for (const listener of globalListeners.get(event.type) || []) listener(event);
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      callback();
      return 1;
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
    scrollTo() {},
  };
  context.globalThis = context;
  context.window = context;
  context.self = context;
  context.navigator = { userAgent: "reader-test" };
  context.HTMLIFrameElement = class {};
  context.Element = FakeElement;
  context.HTMLElement = FakeElement;
  context.SVGElement = FakeElement;
  context.Node = FakeElement;
  context.Text = FakeElement;
  context.Comment = FakeElement;
  context.Document = Object;
  context.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  context.queueMicrotask = (callback) => Promise.resolve().then(callback);
  context.MessageChannel = class {
    port1 = { onmessage: null };
    port2 = { postMessage: () => Promise.resolve().then(() => this.port1.onmessage?.({ data: null })) };
  };
  document.defaultView = context;
  const sessionSource = fs.readFileSync(
    path.join(root, "ReaderExtension", "Resources", "generated", "session.js"),
    "utf8",
  );
  vm.runInNewContext(sessionSource, context);
  assert.equal(typeof context.ReaderReactViewer?.mount, "function");
  if (options.mountFailsOnce) {
    const mount = context.ReaderReactViewer.mount;
    let failed = false;
    context.ReaderReactViewer.mount = (root) => {
      if (!failed) {
        failed = true;
        throw new Error("reader_view_mount_failed");
      }
      return mount(root);
    };
  }
  context.ReaderSession = session;
  const source = fs.readFileSync(
    path.join(root, "ReaderExtension", "Resources", "generated", "viewer.js"),
    "utf8",
  );
  vm.runInNewContext(source, context);
  context.MobileViewer.install();

  return {
    context,
    documentElement,
    createdElements,
    animationFrames,
    timers,
    launchFeedbackDuringExtraction() {
      return launchFeedbackDuringExtraction;
    },
    extractionCount() {
      return extractionCount;
    },
    performanceMarks() {
      return performanceMarks;
    },
    sessionCommands() {
      return sessionCommands;
    },
    setActiveContent(content) {
      activeContent = content;
    },
    activeContent() {
      return activeContent;
    },
    setVisibilityState(state) {
      document.visibilityState = state;
      document.dispatchEvent({ type: "visibilitychange" });
    },
    listenerCount(type) {
      return (documentListeners.get(type) || []).length;
    },
    sessionState() {
      return session.snapshot();
    },
  };
}

test("Safari reader starts beside a page-owned host and reuses only its owned root", async () => {
  const harness = createSafariReaderHarness(Engine, "ja", { pageOwnedHost: true });
  const { context, documentElement } = harness;
  const pageOwnedHost = findElement(
    documentElement,
    (element) => element.id === "__reader-host" && element.dataset.readerOwned !== "true",
  );

  assert.ok(pageOwnedHost);
  await context.MobileViewer.open();

  const ownedHosts = findElements(
    documentElement,
    (element) => element.dataset.readerOwned === "true",
  );
  assert.equal(ownedHosts.length, 1);
  assert.notEqual(ownedHosts[0], pageOwnedHost);
  assert.ok(findElement(documentElement, (element) => element.className === "reader"));

  context.MobileViewer.close();
  assert.equal(pageOwnedHost.parent?.tagName, "BODY");
  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);

  await context.MobileViewer.open();
  assert.equal(findElements(
    documentElement,
    (element) => element.dataset.readerOwned === "true",
  ).length, 1);
  assert.ok(findElement(documentElement, (element) => element.className === "reader"));
  assert.equal(pageOwnedHost.parent?.tagName, "BODY");
});

test("Safari mounts one React root per open session and removes it on close", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  const reactRoots = () => findElements(
    documentElement,
    (element) => element.attributes["data-reader-react-root"] === "true",
  );

  assert.equal(reactRoots().length, 0);
  await context.MobileViewer.open();
  assert.equal(reactRoots().length, 1);
  assert.equal(harness.performanceMarks().filter((name) => name === "reader:react-init-start").length, 1);
  assert.equal(harness.performanceMarks().filter((name) => name === "reader:react-init-end").length, 1);
  context.MobileViewer.close();
  assert.equal(reactRoots().length, 0);
  await context.MobileViewer.open();
  assert.equal(reactRoots().length, 1);
  assert.equal(harness.performanceMarks().filter((name) => name === "reader:react-init-start").length, 2);
  assert.equal(harness.performanceMarks().filter((name) => name === "reader:react-init-end").length, 2);
  context.MobileViewer.close();
  assert.equal(reactRoots().length, 0);
});

test("Safari removes a failed React mount before reopening", async () => {
  const harness = createSafariReaderHarness(Engine, "ja", { mountFailsOnce: true });
  const { context, documentElement } = harness;
  const reactRoots = () => findElements(
    documentElement,
    (element) => element.attributes["data-reader-react-root"] === "true",
  );

  await assert.rejects(context.MobileViewer.open(), /reader_view_mount_failed/u);
  assert.equal(reactRoots().length, 0);
  await context.MobileViewer.open();
  assert.equal(reactRoots().length, 1);
  context.MobileViewer.close();
  assert.equal(reactRoots().length, 0);
});

test("Safari reader marks startup phases without including page content", async () => {
  const harness = createSafariReaderHarness();
  await harness.context.MobileViewer.open();

  assert.deepEqual(harness.performanceMarks(), [
    "reader:bootstrap-ready",
    "reader:tap",
    "reader:react-init-start",
    "reader:react-init-end",
    "reader:first-feedback",
    "reader:extraction-start",
    "reader:extraction-end",
    "reader:segmentation-end",
    "reader:controls-ready",
    "reader:first-unit",
    "reader:first-render",
  ]);
});

test("Safari attaches visibility lifecycle only while a session is active", async () => {
  const harness = createSafariReaderHarness();

  assert.equal(harness.listenerCount("visibilitychange"), 0);
  await harness.context.MobileViewer.open();
  assert.equal(harness.listenerCount("visibilitychange"), 1);

  harness.setVisibilityState("hidden");
  assert.equal(harness.sessionCommands().at(-1)?.type, "visibilityHidden");

  harness.context.MobileViewer.close();
  assert.equal(harness.listenerCount("visibilitychange"), 0);
  const commandCountAfterClose = harness.sessionCommands().length;
  harness.setVisibilityState("hidden");
  assert.equal(harness.sessionCommands().length, commandCountAfterClose);
});

test("Safari uses heading transitions when scheduling the first unit", async () => {
  const harness = createSafariReaderHarness();
  const text = "短い、次です。";
  harness.setActiveContent({
    text,
    readingContext: {
      ...harness.activeContent().readingContext,
      blocks: [{ text, kind: "paragraph", level: null, start: 0, end: text.length }],
      headings: [{ text: "導入", level: 1 }, { text: "本論", level: 2 }],
      sectionOffsets: [],
      sectionTransitions: [
        { offset: 0, headingIndex: 0 },
        { offset: 3, headingIndex: 1 },
      ],
      initialHeadingIndex: -1,
      figures: [],
    },
  });

  await harness.context.MobileViewer.open();

  const [firstTimer] = [...harness.timers.values()];
  assert.equal(firstTimer?.delay, 612);
  fireNextTimer(harness.timers);
  const [secondTimer] = [...harness.timers.values()];
  assert.equal(secondTimer?.delay, 276);
});

function safariReaderCursor(state) {
  return {
    phase: state?.phase,
    flowIndex: state?.flowIndex,
    sourceOffset: state?.sourceOffset,
    currentKind: state?.currentKind,
  };
}

const safariLateTimerScenarios = [
  {
    name: "pause",
    operate(harness) {
      findElement(
        harness.documentElement,
        (element) => element.attributes["aria-label"] === "一時停止",
      ).dispatchEvent({ type: "click" });
    },
  },
  {
    name: "mode switch",
    operate(harness) {
      findElement(harness.documentElement, (element) => element.textContent === "文章で読む")
        .dispatchEvent({ type: "click" });
    },
  },
  {
    name: "figure",
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
    operate(harness) {
      harness.context.innerWidth = 180;
      harness.context.dispatchEvent({ type: "resize" });
    },
  },
  {
    name: "close",
    operate(harness) {
      harness.context.MobileViewer.close();
    },
  },
  {
    name: "hidden",
    operate(harness) {
      harness.setVisibilityState("hidden");
    },
  },
];

for (const scenario of safariLateTimerScenarios) {
  test(`Safari reader ignores a late callback after ${scenario.name}`, async () => {
    const harness = createSafariReaderHarness();
    await harness.context.MobileViewer.open();

    let lateCallback = scenario.capture?.(harness);
    if (!lateCallback) {
      const entry = [...harness.timers.entries()][0];
      assert.ok(entry);
      harness.timers.delete(entry[0]);
      lateCallback = entry[1].callback;
    }
    scenario.operate(harness);
    const stateAfterOperation = harness.sessionState();
    const cursorAfterOperation = safariReaderCursor(stateAfterOperation);

    lateCallback();

    assert.deepEqual(safariReaderCursor(harness.sessionState()), cursorAfterOperation);
    assert.deepEqual(harness.sessionState(), stateAfterOperation);
  });
}

test("Safari reader shows extraction progress before opening", async () => {
  const harness = createSafariReaderHarness();
  const { context, createdElements } = harness;
  const readerStyle = createdElements.find((element) => element.tagName === "STYLE");
  assert.match(readerStyle.textContent, /\.rsvp-unit \{[^}]*display: grid;[^}]*place-items: center;/u);
  await context.MobileViewer.open();

  const launchFeedbackDuringExtraction = harness.launchFeedbackDuringExtraction();
  assert.ok(launchFeedbackDuringExtraction);
  assert.equal(launchFeedbackDuringExtraction.textContent, "");
  assert.equal(findElement(
    launchFeedbackDuringExtraction,
    (element) => element.className === "launch-tap-feedback",
  ), null);
  const progressTrack = findElement(
    launchFeedbackDuringExtraction,
    (element) => element.className === "launch-progress-track",
  );
  const launchLoader = findElement(
    launchFeedbackDuringExtraction,
    (element) => element.className === "launch-loader",
  );
  const progressIndicator = findElement(
    progressTrack,
    (element) => element.className === "launch-progress-indicator",
  );
  assert.ok(progressTrack);
  assert.ok(progressIndicator);
  assert.equal(launchLoader.style.display, "block");
  assert.equal(launchLoader.style.opacity, "1");
  assert.equal(progressIndicator.animations.length, 1);
  assert.equal(progressIndicator.animations[0].options.iterations, Infinity);
  assert.equal(progressIndicator.animations[0].keyframes[0].transform, "translateX(-100%) scaleX(.35)");
  assert.equal(progressIndicator.animations[0].keyframes[1].transform, "translateX(220%) scaleX(.35)");
  assert.equal(findElement(
    launchFeedbackDuringExtraction,
    (element) => element.className === "launch-status",
  ), null);
  assert.equal(findElement(
    launchFeedbackDuringExtraction,
    (element) => element.textContent === "中止",
  ), null);
});

test("Safari reader keeps RSVP controls visible and preserves the paused state", async () => {
  const { context, documentElement } = createSafariReaderHarness();
  await context.MobileViewer.open();

  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  const backButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "1文戻る",
  );
  const initialPlayButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "一時停止",
  );
  const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
  assert.equal(modeButton.parent.className, "controlbar");
  assert.equal(modeButton.hidden, false);
  assert.equal(backButton.parent.hidden, false);
  assert.equal(initialPlayButton.parent.hidden, false);
  assert.equal(initialPlayButton.attributes["aria-pressed"], "true");

  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1000 });
  assert.equal(backButton.parent.hidden, false);
  const playButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "一時停止",
  );
  assert.ok(playButton);
  playButton.dispatchEvent({ type: "click" });
  assert.equal(playButton.attributes["aria-label"], "再生");
  assert.equal(playButton.attributes["aria-pressed"], "false");
  assert.equal(backButton.parent.hidden, false);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1400 });
  assert.equal(backButton.parent.hidden, false);
  assert.equal(playButton.attributes["aria-label"], "再生");
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1700 });
  assert.equal(backButton.parent.hidden, false);
});

test("Safari reader completes hidden preparation without starting playback", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  let resolveExtraction: (value: unknown) => void = () => {};
  context.Extractor.fromPage = () => new Promise((resolve) => {
    resolveExtraction = resolve;
  });

  const opening = context.MobileViewer.open();
  await Promise.resolve();
  harness.setVisibilityState("hidden");
  resolveExtraction(harness.activeContent());
  await opening;

  const playButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "再生",
  );
  assert.ok(playButton);
  assert.equal(timers.size, 0);
  assert.deepEqual(harness.sessionCommands().map(({ type }) => type), [
    "open",
    "visibilityHidden",
    "rebuildUnits",
    "prepareSucceeded",
  ]);
});

test("Safari reader applies queued mode changes after session initialization", async () => {
  let resolveInit: () => void = () => {};
  const initPromise = new Promise<void>((resolve) => {
    resolveInit = resolve;
  });
  const harness = createSafariReaderHarness(Engine, "ja", {
    ready: () => false,
    init: () => initPromise,
  });

  await harness.context.MobileViewer.open();
  const { documentElement } = harness;
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  assert.ok(modeButton);
  modeButton.dispatchEvent({ type: "click" });
  resolveInit();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const resolvedModeButton = findElement(documentElement, (element) => element.className === "mode-button");
  assert.equal(resolvedModeButton.textContent, "RSVPで読む");
  assert.ok(findElement(documentElement, (element) => element.className === "text-view"));
  assert.deepEqual(harness.sessionCommands().map(({ type }) => type), [
    "open",
    "rebuildUnits",
    "prepareSucceeded",
    "switchToText",
  ]);
});

test("Safari viewer segments with the ReaderContent language", async () => {
  const locales: string[] = [];
  const engine = {
    ...Engine,
    segmentText(text, locale, boundaries) {
      locales.push(locale);
      return Engine.segmentText(text, locale, boundaries);
    },
  };
  const harness = createSafariReaderHarness(engine, "en-US");

  await harness.context.MobileViewer.open();

  assert.deepEqual(locales, ["en-US"]);
});

test("Safari reader exposes modal semantics, traps keyboard actions, and restores inert state", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  const head = new FakeElement("head");
  documentElement.append(head);
  head.inert = true;
  await context.MobileViewer.open();

  const reader = findElement(documentElement, (element) => element.className === "reader");
  const unit = findElement(documentElement, (element) => element.attributes["data-reader-unit"] === "true");
  const closeButton = findElement(documentElement, (element) => element.attributes["aria-label"] === "readerを閉じる");
  const playButton = findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止");

  assert.equal(reader.attributes.role, "dialog");
  assert.equal(reader.attributes["aria-modal"], "true");
  assert.equal(reader.attributes["aria-label"], "reader");
  assert.equal(unit.attributes["aria-live"], "off");
  assert.equal(unit.attributes["aria-atomic"], "false");
  assert.equal(closeButton, context.document.activeElement);
  assert.equal(documentElement.children.find((element) => element.tagName === "BODY").inert, true);
  assert.equal(head.inert, true);

  let prevented = false;
  context.dispatchEvent({
    type: "keydown",
    code: "Space",
    key: " ",
    target: unit,
    composedPath: () => [unit],
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(playButton.attributes["aria-label"], "再生");

  context.dispatchEvent({
    type: "keydown",
    key: "Escape",
    target: unit,
    composedPath: () => [unit],
    preventDefault() {},
  });
  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(documentElement.children.find((element) => element.tagName === "BODY").inert, false);
  assert.equal(head.inert, true);
  assert.equal(context.document.activeElement.attributes["aria-label"], "readerで読む");
});

test("Safari reader shows rewind feedback without changing pause state", async () => {
  const { context, documentElement, timers } = createSafariReaderHarness();
  await context.MobileViewer.open();
  const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
  const backButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "1文戻る",
  );
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1000 });
  const playButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "一時停止",
  );
  playButton.dispatchEvent({ type: "click" });

  rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 2200 });
  const pausedFeedback = findElement(
    documentElement,
    (element) => element.className === "rewind-feedback",
  );
  assert.ok(pausedFeedback);
  assert.equal(pausedFeedback.style.left, "54px");
  assert.equal(pausedFeedback.style.top, "242px");
  assert.equal(pausedFeedback.children.filter((child) => child.className === "rewind-ring").length, 2);
  const firstRingAnimation = pausedFeedback.children[0].animations[0];
  const secondRingAnimation = pausedFeedback.children[1].animations[0];
  const iconAnimation = pausedFeedback.children[2].animations[0];
  assert.equal(firstRingAnimation.options.duration, 420);
  assert.equal(secondRingAnimation.options.duration, 420);
  assert.equal(secondRingAnimation.options.delay, 80);
  assert.equal(iconAnimation.options.duration, 360);
  assert.equal(firstRingAnimation.keyframes.at(-1).transform, "scale(2.15)");
  assert.equal(iconAnimation.keyframes.at(-1).transform, "translateX(-8px) scale(.96)");
  assert.equal(backButton.parent.hidden, false);
  assert.equal(timers.size, 0);

  playButton.dispatchEvent({ type: "click" });
  assert.equal(playButton.attributes["aria-label"], "一時停止");
  assert.equal(backButton.parent.hidden, false);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 2600 });
  assert.equal(backButton.parent.hidden, false);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 3000 });
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 3180 });
  assert.equal(backButton.parent.hidden, false);
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.equal(timers.size, 1);
});

test("Safari React rewind feedback keeps a newer animation after a stale completion", async () => {
  const originalAnimate = FakeElement.prototype.animate;
  const finishers: Array<() => void> = [];
  FakeElement.prototype.animate = function (this: FakeElement, keyframes: any, options: any) {
    const animation = originalAnimate.call(this, keyframes, options);
    if (this.className === "rewind-ring" || this.tagName === "SVG") {
      let finish: () => void = () => {};
      animation.finished = new Promise<void>((resolve) => { finish = resolve; });
      finishers.push(finish);
    }
    return animation;
  };
  let context: any = null;
  try {
    const harness = createSafariReaderHarness();
    context = harness.context;
    const { documentElement, timers } = harness;
    await context.MobileViewer.open();
    let rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 2200 });
    const firstFeedback = findElement(documentElement, (element) => element.className === "rewind-feedback");
    assert.ok(firstFeedback);
    assert.equal(finishers.length, 3);

    rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 62, clientY: 250, timeStamp: 3000 });
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 64, clientY: 252, timeStamp: 3200 });
    const secondFeedback = findElement(documentElement, (element) => element.className === "rewind-feedback");
    assert.ok(secondFeedback);
    assert.notEqual(secondFeedback, firstFeedback);
    assert.equal(finishers.length, 6);

    finishers.slice(0, 3).forEach((finish) => finish());
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(findElement(documentElement, (element) => element.className === "rewind-feedback"), secondFeedback);

    finishers.slice(3).forEach((finish) => finish());
    await new Promise<void>((resolve) => setImmediate(resolve));
    fireTimerWithDelay(timers, 0);
    assert.equal(findElement(documentElement, (element) => element.className === "rewind-feedback"), null);
  } finally {
    context?.MobileViewer.close();
    FakeElement.prototype.animate = originalAnimate;
  }
});

test("Safari React rewind feedback ignores an unfinished animation after close", async () => {
  const originalAnimate = FakeElement.prototype.animate;
  const finishers: Array<() => void> = [];
  FakeElement.prototype.animate = function (this: FakeElement, keyframes: any, options: any) {
    const animation = originalAnimate.call(this, keyframes, options);
    if (this.className === "rewind-ring" || this.tagName === "SVG") {
      let finish: () => void = () => {};
      animation.finished = new Promise<void>((resolve) => { finish = resolve; });
      finishers.push(finish);
    }
    return animation;
  };
  let context: any = null;
  try {
    const harness = createSafariReaderHarness();
    context = harness.context;
    const { documentElement } = harness;
    await context.MobileViewer.open();
    const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 2200 });
    assert.equal(finishers.length, 3);
    context.MobileViewer.close();
    assert.equal(findElement(documentElement, (element) => element.className === "rewind-feedback"), null);
    finishers.forEach((finish) => finish());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
    assert.equal(findElement(documentElement, (element) => element.className === "rewind-feedback"), null);
  } finally {
    context?.MobileViewer.close();
    FakeElement.prototype.animate = originalAnimate;
  }
});

test("Safari React rewind feedback keeps the reduced-motion animation contract", async () => {
  const harness = createSafariReaderHarness(Engine, "ja", { reducedMotion: true });
  const { context, documentElement, timers } = harness;
  try {
    await context.MobileViewer.open();
    const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });
    rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 2200 });
    const feedback = findElement(documentElement, (element) => element.className === "rewind-feedback");
    const firstRingAnimation = feedback.children[0].animations[0];
    const secondRingAnimation = feedback.children[1].animations[0];
    const iconAnimation = feedback.children[2].animations[0];
    assert.equal(firstRingAnimation.options.duration, 160);
    assert.equal(secondRingAnimation.options.duration, 160);
    assert.equal(secondRingAnimation.options.delay, 0);
    assert.equal(iconAnimation.options.duration, 160);
    assert.equal(firstRingAnimation.keyframes.at(-1).transform, undefined);
    assert.equal(iconAnimation.keyframes.at(-1).transform, undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    fireTimerWithDelay(timers, 0);
    assert.equal(findElement(documentElement, (element) => element.className === "rewind-feedback"), null);
  } finally {
    context.MobileViewer.close();
  }
});

test("Safari reader pauses after returning from an image to the previous sentence", async () => {
  const { context, documentElement, timers } = createSafariReaderHarness();
  await context.MobileViewer.open();
  const backButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "1文戻る",
  );

  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  const firstFigure = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "本文画像",
  );
  assert.ok(firstFigure);
  assert.equal(backButton.parent.hidden, false);
  firstFigure.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 3600 });
  assert.equal(backButton.parent.hidden, false);
  firstFigure.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 3900 });
  assert.equal(backButton.parent.hidden, false);
  backButton.dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "再生"));
  assert.equal(backButton.parent.hidden, false);
  assert.equal(timers.size, 0);
  findElement(documentElement, (element) => element.attributes["aria-label"] === "再生").dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.ok(timers.size > 0);

  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  assert.ok(findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "本文画像",
  ));
});

test("Safari figure surface is keyboard accessible and keeps a failed image recoverable", async () => {
  const { context, documentElement, timers } = createSafariReaderHarness();
  await context.MobileViewer.open();
  let figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  while (!figurePanel) {
    fireNextTimer(timers);
    figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  }

  const surface = findElement(figurePanel, (element) => element.attributes["data-reader-image-surface"] === "true");
  const veil = findElement(figurePanel, (element) => element.attributes["data-reader-image-veil"] === "true");
  const image = findElement(figurePanel, (element) => element.tagName === "IMG");
  assert.equal(surface.tagName, "BUTTON");
  assert.equal(surface.attributes["aria-pressed"], "false");
  assert.equal(surface.attributes["aria-label"], "画像を明るく表示");
  surface.dispatchEvent({ type: "click" });
  assert.equal(veil.style.opacity, "0");
  assert.equal(surface.attributes["aria-pressed"], "true");
  assert.equal(surface.attributes["aria-label"], "画像を暗く表示");

  fireTimerWithDelay(timers, 100);
  assert.equal(findElement(figurePanel, (element) => element.attributes["data-reader-figure-status"] === "true").hidden, false);
  image.dispatchEvent({ type: "error" });
  assert.equal(findElement(figurePanel, (element) => element.attributes["data-reader-figure-status"] === "true").textContent, "画像を読み込めませんでした");
  const resume = findElement(documentElement, (element) => element.attributes["aria-label"] === "続きを読む");
  assert.ok(resume);
  resume.dispatchEvent({ type: "click" });
  assert.match(findElement(documentElement, (element) => element.className.startsWith("rsvp-unit")).textContent, /画像の後/u);
});

test("Safari reader maps text viewport positions back to RSVP content", async () => {
  const { context, documentElement, timers, createdElements } = createSafariReaderHarness();
  await context.MobileViewer.open();
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  assert.ok(findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "本文画像",
  ));

  modeButton.dispatchEvent({ type: "click" });
  const scroller = findElement(documentElement, (element) => element.className === "text-view");
  const anchors = findElements(
    scroller,
    (element) => element.attributes["data-reader-text-anchor"] === "true",
  );
  assert.equal(modeButton.textContent, "RSVPで読む");
  assert.equal(modeButton.hidden, false);
  assert.equal(anchors.length, 3);
  scroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  anchors[0].rect = { top: -120, bottom: -20, left: 20, right: 370, width: 350, height: 100 };
  anchors[1].rect = { top: 520, bottom: 620, left: 20, right: 370, width: 350, height: 100 };
  anchors[2].rect = { top: 640, bottom: 740, left: 20, right: 370, width: 350, height: 100 };
  const textFigure = findElement(scroller, (element) => element.className === "article-figure");
  assert.ok(textFigure);
  textFigure.rect = { top: -24, bottom: 276, left: 20, right: 370, width: 350, height: 300 };
  const imageCountBeforeRsvp = createdElements.filter((element) => element.tagName === "IMG" && element.src === "https://example.com/figure.png").length;
  scroller.dispatchEvent({ type: "pointerdown" });
  modeButton.dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像"));
  assert.equal(
    createdElements.filter((element) => element.tagName === "IMG" && element.src === "https://example.com/figure.png").length,
    imageCountBeforeRsvp + 1,
  );
  assert.equal(findElements(documentElement, (element) => element.className === "rsvp-figure").length, 1);

  const imagePlayButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "続きを読む",
  );
  assert.ok(imagePlayButton);
  imagePlayButton.dispatchEvent({ type: "click" });
  const unitAfterImage = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.match(unitAfterImage.textContent, /画像の後/u);

  modeButton.dispatchEvent({ type: "click" });
  const roundTripScroller = findElement(documentElement, (element) => element.className === "text-view");
  const roundTripAnchors = findElements(
    roundTripScroller,
    (element) => element.attributes["data-reader-text-anchor"] === "true",
  );
  roundTripScroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  roundTripAnchors[0].rect = { top: -120, bottom: -20, left: 20, right: 370, width: 350, height: 100 };
  roundTripAnchors[1].rect = { top: -24, bottom: 76, left: 20, right: 370, width: 350, height: 100 };
  roundTripAnchors[2].rect = { top: 520, bottom: 620, left: 20, right: 370, width: 350, height: 100 };
  const roundTripFigure = findElement(roundTripScroller, (element) => element.className === "article-figure");
  roundTripFigure.rect = { top: 520, bottom: 820, left: 20, right: 370, width: 350, height: 300 };
  modeButton.dispatchEvent({ type: "click" });
  const unitAfterRoundTrip = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.match(unitAfterRoundTrip.textContent, /画像の後/u);

  modeButton.dispatchEvent({ type: "click" });
  const resumedScroller = findElement(documentElement, (element) => element.className === "text-view");
  const resumedAnchors = findElements(
    resumedScroller,
    (element) => element.attributes["data-reader-text-anchor"] === "true",
  );
  resumedScroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  resumedAnchors[0].rect = { top: -120, bottom: -20, left: 20, right: 370, width: 350, height: 100 };
  resumedAnchors[1].rect = { top: -24, bottom: 76, left: 20, right: 370, width: 350, height: 100 };
  resumedAnchors[2].rect = { top: 520, bottom: 620, left: 20, right: 370, width: 350, height: 100 };
  const resumedFigure = findElement(resumedScroller, (element) => element.className === "article-figure");
  resumedFigure.rect = { top: 520, bottom: 820, left: 20, right: 370, width: 350, height: 300 };
  resumedScroller.dispatchEvent({ type: "pointerdown" });
  modeButton.dispatchEvent({ type: "click" });
  const resumedUnit = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.match(resumedUnit.textContent, /画像の後/u);
  assert.equal(modeButton.textContent, "文章で読む");
  assert.equal(modeButton.hidden, false);

  modeButton.dispatchEvent({ type: "click" });
  const laterScroller = findElement(documentElement, (element) => element.className === "text-view");
  const laterAnchors = findElements(
    laterScroller,
    (element) => element.attributes["data-reader-text-anchor"] === "true",
  );
  laterScroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  laterScroller.scrollTop = 900;
  laterAnchors[0].rect = { top: -320, bottom: -220, left: 20, right: 370, width: 350, height: 100 };
  laterAnchors[1].rect = { top: -140, bottom: -40, left: 20, right: 370, width: 350, height: 100 };
  laterAnchors[2].rect = { top: -24, bottom: 76, left: 20, right: 370, width: 350, height: 100 };
  const laterFigure = findElement(laterScroller, (element) => element.className === "article-figure");
  laterFigure.rect = { top: -500, bottom: -200, left: 20, right: 370, width: 350, height: 300 };
  modeButton.dispatchEvent({ type: "click" });
  const laterUnit = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.match(laterUnit.textContent, /さらに後/u);

  modeButton.dispatchEvent({ type: "click" });
  const completeSentenceScroller = findElement(documentElement, (element) => element.className === "text-view");
  const completeSentenceAnchors = findElements(
    completeSentenceScroller,
    (element) => element.attributes["data-reader-text-anchor"] === "true",
  );
  completeSentenceScroller.rect = { top: 0, bottom: 500, left: 0, right: 390, width: 390, height: 500 };
  completeSentenceAnchors[0].rect = { top: -320, bottom: -220, left: 20, right: 370, width: 350, height: 100 };
  completeSentenceAnchors[1].rect = { top: -24, bottom: 76, left: 20, right: 370, width: 350, height: 100 };
  completeSentenceAnchors[2].rect = { top: 112, bottom: 212, left: 20, right: 370, width: 350, height: 100 };
  const completeSentenceFigure = findElement(completeSentenceScroller, (element) => element.className === "article-figure");
  completeSentenceFigure.rect = { top: 640, bottom: 940, left: 20, right: 370, width: 350, height: 300 };
  modeButton.dispatchEvent({ type: "click" });
  const firstCompleteUnit = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.match(firstCompleteUnit.textContent, /さらに後/u);
});

test("Safari reader uses shared text and figure position markers", async () => {
  const { context, documentElement } = createSafariReaderHarness();
  await context.MobileViewer.open();
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  modeButton.dispatchEvent({ type: "click" });

  const scroller = findElement(documentElement, (element) => element.className === "text-view");
  const anchors = findElements(scroller, (element) => element.attributes["data-reader-text-anchor"] === "true");
  const figureMarker = findElement(scroller, (element) => element.dataset.readerPositionKind === "figure");
  assert.equal(anchors.length, 3);
  assert.equal(figureMarker.dataset.figureIndex, "0");
  assert.equal(figureMarker.dataset.sourceStart, "27");
  assert.ok(anchors.every((anchor) => anchor.dataset.readerPositionKind === "text"));

  scroller.rect = { top: 0, bottom: 500, left: 20, right: 370, width: 350, height: 500 };
  anchors[0].rect = { top: -160, bottom: -60, left: 20, right: 370, width: 350, height: 100 };
  anchors[1].rect = { top: -120, bottom: -20, left: 20, right: 370, width: 350, height: 100 };
  figureMarker.rect = { top: 120, bottom: 260, left: 20, right: 370, width: 350, height: 140 };
  anchors[2].rect = { top: 280, bottom: 380, left: 20, right: 370, width: 350, height: 100 };
  scroller.scrollTop = 120;
  scroller.dispatchEvent({ type: "scroll" });
  modeButton.dispatchEvent({ type: "click" });

  const figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  assert.ok(figurePanel);
  assert.equal(figurePanel.dataset.figureIndex, "0");
  assert.equal(figurePanel.dataset.sourceStart, "27");
});

test("Safari reader preserves the text marker when an earlier responsive text image changes layout", async () => {
  const { context, documentElement, timers } = createSafariReaderHarness();
  await context.MobileViewer.open();
  let figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  while (!figurePanel) {
    fireNextTimer(timers);
    figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  }
  const figureImage = findElement(figurePanel, (element) => element.tagName === "IMG");
  figureImage.dispatchEvent({ type: "error" });
  findElement(documentElement, (element) => element.attributes["aria-label"] === "続きを読む").dispatchEvent({ type: "click" });
  findElement(documentElement, (element) => element.textContent === "文章で読む").dispatchEvent({ type: "click" });

  const scroller = findElement(documentElement, (element) => element.className === "text-view");
  const afterImageMarker = findElement(
    scroller,
    (element) => element.dataset.readerPositionKind === "text"
      && Number(element.dataset.sourceStart) > 27,
  );
  const textFigure = findElement(scroller, (element) => element.className === "article-figure");
  const textImage = findElement(textFigure, (element) => element.tagName === "IMG");
  assert.ok(scroller && afterImageMarker && textImage);
  assert.equal(textImage.srcset, "https://example.com/figure@1x.png 1x, https://example.com/figure@2x.png 2x");
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

test("Safari reader leaves scroll position unchanged for a text image below the marker", async () => {
  const { context, documentElement } = createSafariReaderHarness();
  await context.MobileViewer.open();
  findElement(documentElement, (element) => element.textContent === "文章で読む").dispatchEvent({ type: "click" });
  const scroller = findElement(documentElement, (element) => element.className === "text-view");
  const textFigure = findElement(scroller, (element) => element.className === "article-figure");
  const textImage = findElement(textFigure, (element) => element.tagName === "IMG");
  assert.ok(scroller && textImage);
  const initialScrollTop = scroller.scrollTop;
  textImage.dispatchEvent({ type: "load" });
  assert.equal(scroller.scrollTop, initialScrollTop);
});

test("Safari reader ignores a clipped figure even when its center is readable", async () => {
  const { context, documentElement } = createSafariReaderHarness();
  await context.MobileViewer.open();
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  modeButton.dispatchEvent({ type: "click" });

  const scroller = findElement(documentElement, (element) => element.className === "text-view");
  const anchors = findElements(scroller, (element) => element.attributes["data-reader-text-anchor"] === "true");
  const figureMarker = findElement(scroller, (element) => element.className === "article-figure");
  scroller.rect = { top: 0, bottom: 500, left: 20, right: 370, width: 350, height: 500 };
  anchors[0].rect = { top: -160, bottom: -60, left: 20, right: 370, width: 350, height: 100 };
  anchors[1].rect = { top: 280, bottom: 380, left: 20, right: 370, width: 350, height: 100 };
  figureMarker.rect = { top: 20, bottom: 220, left: 20, right: 370, width: 350, height: 200 };
  anchors[2].rect = { top: 540, bottom: 640, left: 20, right: 370, width: 350, height: 100 };
  scroller.scrollTop = 120;
  scroller.dispatchEvent({ type: "scroll" });
  modeButton.dispatchEvent({ type: "click" });

  const figurePanel = findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像");
  const unit = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  assert.equal(figurePanel, null);
  assert.equal(unit.dataset.readerPositionKind, "text");
  assert.equal(unit.dataset.sourceStart, "30");
});

test("Safari reader discards the closed article and extracts fresh content", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  await context.MobileViewer.open();

  context.MobileViewer.close();
  harness.setActiveContent({
    text: "別の記事の本文です。",
    readingContext: {
      title: "別の記事",
      blocks: [{
        text: "別の記事の本文です。",
        kind: "paragraph",
        level: null,
        start: 0,
        end: 10,
      }],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    },
  });
  await context.MobileViewer.open();
  assert.equal(harness.extractionCount(), 2);
  const secondArticleUnit = findElement(
    documentElement,
    (element) => element.className.startsWith("rsvp-unit"),
  );
  assert.match(secondArticleUnit.textContent, /別の記事/u);
  assert.equal(findElement(
    documentElement,
    (element) => element.className.startsWith("rsvp-unit") && /画像より前/u.test(element.textContent),
  ), null);
});

test("Safari reader destroys autoplay state when closed", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();

  assert.equal(timers.size, 1);
  context.MobileViewer.close();

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(timers.size, 0);
  assert.equal(findElement(documentElement, (element) => element.className === "entry").hidden, false);
});

test("Safari reader ignores a saved playback timer after close and reopen", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();
  const savedPlaybackCallback = [...timers.values()][0].callback;

  context.MobileViewer.close();
  await context.MobileViewer.open();
  const unit = findElement(documentElement, (element) => element.className.startsWith("rsvp-unit"));
  const progress = findElement(documentElement, (element) => element.className === "progress");
  const unitText = unit.textContent;
  const progressText = progress.textContent;
  savedPlaybackCallback();

  assert.equal(unit.textContent, unitText);
  assert.equal(progress.textContent, progressText);
  assert.equal(timers.size, 1);
  context.MobileViewer.close();
  assert.equal(timers.size, 0);
});

test("Safari reader ignores a saved text restore frame after close", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, animationFrames } = harness;
  await context.MobileViewer.open();
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  modeButton.dispatchEvent({ type: "click" });
  const savedRestoreFrame = animationFrames.at(-1);

  context.MobileViewer.close();
  assert.doesNotThrow(() => savedRestoreFrame());
  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
});

test("Safari reader restores source page state when closed repeatedly", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  const body = documentElement.children[0];
  const handle = findElement(documentElement, (element) => element.className === "entry");
  documentElement.style.overflow = "scroll";
  body.style.overflow = "auto";
  context.scrollY = 240;

  await context.MobileViewer.open();
  context.MobileViewer.close();
  context.MobileViewer.close();

  assert.equal(documentElement.style.overflow, "scroll");
  assert.equal(body.style.overflow, "auto");
  assert.equal(handle.focused, true);
});

test("Safari reader pauses without destroying its session in the background", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();

  assert.equal(timers.size, 1);
  harness.setVisibilityState("hidden");
  assert.equal(timers.size, 0);
  assert.ok(findElement(documentElement, (element) => element.className === "reader"));

  harness.setVisibilityState("visible");
  assert.equal(timers.size, 0);
  assert.ok(findElement(documentElement, (element) => element.className === "reader"));
});

test("Safari reader destroys paused text mode state when closed", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();
  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  modeButton.dispatchEvent({ type: "click" });

  assert.ok(findElement(documentElement, (element) => element.className === "text-view"));
  assert.equal(timers.size, 0);
  context.MobileViewer.close();

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(findElement(documentElement, (element) => element.className === "entry").hidden, false);
});

test("Safari keeps one timer and ends paused after a 30-minute-equivalent RSVP flow", async () => {
  const longText = Array.from(
    { length: 1_550 },
    () => "これは三十分相当の長文を検証する文です。",
  ).join("");
  const harness = createSafariReaderHarness();
  harness.setActiveContent({
    text: longText,
    readingContext: {
      language: "ja",
      title: "",
      blocks: [{ text: longText, kind: "paragraph", level: null, start: 0, end: longText.length }],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    },
  });
  await harness.context.MobileViewer.open();

  let elapsedMs = 0;
  let firedTimerCount = 0;
  let maxPendingTimerCount = 0;
  while (harness.timers.size > 0) {
    assert.equal(harness.timers.size, 1);
    const [timerId, timer] = [...harness.timers.entries()][0];
    harness.timers.delete(timerId);
    elapsedMs += timer.delay;
    firedTimerCount += 1;
    timer.callback();
    maxPendingTimerCount = Math.max(maxPendingTimerCount, harness.timers.size);
    assert.ok(firedTimerCount < 10_000);
  }

  const finalState = harness.sessionState();
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

test("Safari reader destroys figure state when closed", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);
  fireNextTimer(timers);

  assert.ok(findElement(documentElement, (element) => element.className === "rsvp-figure"));
  context.MobileViewer.close();

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(findElement(documentElement, (element) => element.className === "rsvp-figure"), null);
  assert.equal(timers.size, 0);
});

test("Safari reader destroys pending double tap state when closed", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  await context.MobileViewer.open();
  const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });

  assert.equal(timers.size, 2);
  context.MobileViewer.close();

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(timers.size, 0);
});

test("Safari reader destroys error state when closed", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  harness.setActiveContent(null);
  await context.MobileViewer.open();

  assert.ok(findElement(documentElement, (element) => element.className === "error"));
  context.MobileViewer.close();

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(findElement(documentElement, (element) => element.className === "entry").hidden, false);
});

test("Safari reader ignores extraction completion after close", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement } = harness;
  let resolveExtraction: (value: unknown) => void = () => {};
  const extraction = new Promise((resolve) => {
    resolveExtraction = resolve;
  });
  context.Extractor.fromPage = () => extraction;

  const opening = context.MobileViewer.open();
  await Promise.resolve();
  context.MobileViewer.close();
  resolveExtraction(harness.activeContent());
  await opening;

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(findElement(documentElement, (element) => element.className === "entry").hidden, false);
});

test("Safari reader exposes a cancel action only for slow preparation", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, timers } = harness;
  let resolveExtraction: (value: unknown) => void = () => {};
  context.Extractor.fromPage = () => new Promise((resolve) => {
    resolveExtraction = resolve;
  });

  const opening = context.MobileViewer.open();
  await Promise.resolve();
  fireTimerWithDelay(timers, 100);
  assert.equal(findElement(documentElement, (element) => element.textContent === "文章を準備しています"), null);
  fireTimerWithDelay(timers, 400);
  const cancelButton = findElement(documentElement, (element) => element.textContent === "中止");
  assert.ok(cancelButton);
  cancelButton.dispatchEvent({ type: "click" });
  resolveExtraction(harness.activeContent());
  await opening;

  assert.equal(findElement(documentElement, (element) => element.className === "reader"), null);
  assert.equal(findElement(documentElement, (element) => element.className === "entry").hidden, false);
  assert.equal(context.document.documentElement.style.overflow, "");
  assert.deepEqual(harness.sessionCommands().map(({ type }) => type), ["open", "cancel", "close"]);
});
