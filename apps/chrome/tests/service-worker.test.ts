export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createServiceWorkerHarness() {
  let reportExtractionStarted = null;
  const harness: any = {
    listeners: {},
    createdMenu: null,
    scriptCalls: [],
    messages: [],
    runtimeMessages: [],
    sessionHostCreated: false,
    sessionHostOptions: null,
    abortedRequestIds: [],
    extractionRequestIds: [],
    pendingExtractions: new Map(),
    finishExtraction: null,
    rejectExtraction: null,
    finishExtractionFor(requestId) {
      const pending = harness.pendingExtractions.get(requestId);
      if (!pending) return;
      harness.pendingExtractions.delete(requestId);
      pending.resolve([{ result: harness.extractionResult }]);
    },
    rejectExtractionFor(requestId, error) {
      const pending = harness.pendingExtractions.get(requestId);
      if (!pending) return;
      harness.pendingExtractions.delete(requestId);
      pending.reject(error);
    },
    extractionResult: {
      text: "記事本文",
      readingContext: {
        headings: [{ text: "記事タイトル", level: 1 }],
        sectionTransitions: [{ offset: 0, headingIndex: 0 }],
        initialHeadingIndex: -1,
      },
    },
    extractionStarted: new Promise((resolve) => {
      reportExtractionStarted = resolve;
    }),
  };
  const chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://reader/${path}`;
      },
      onInstalled: {
        addListener(listener) {
          harness.listeners.installed = listener;
        },
      },
      onMessage: {
        addListener(listener) {
          harness.listeners.runtimeMessage = listener;
        },
      },
      sendMessage(message) {
        harness.runtimeMessages.push(message);
        return Promise.resolve();
      },
      async getContexts() {
        return harness.sessionHostCreated ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [];
      },
    },
    offscreen: {
      Reason: { WORKERS: "WORKERS" },
      async createDocument(options) {
        harness.sessionHostCreated = true;
        harness.sessionHostOptions = options;
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          harness.listeners.actionClicked = listener;
        },
      },
    },
    scripting: {
      async executeScript(options) {
        harness.scriptCalls.push(options);
        if (options.func && options.func.toString().includes("fromPageAsync")) {
          harness.extractionRequestIds.push(options.args?.[0]);
          reportExtractionStarted();
          return new Promise((resolve, reject) => {
            const requestId = options.args?.[0];
            harness.pendingExtractions.set(requestId, { resolve, reject });
            harness.finishExtraction = () => harness.finishExtractionFor(requestId);
            harness.rejectExtraction = (error) => harness.rejectExtractionFor(requestId, error);
          });
        }
        if (options.func?.toString().includes("__readerRuntimePromise")) return [];
        if (options.func) harness.abortedRequestIds.push(options.args?.[0]);
        return [];
      },
    },
    tabs: {
      async sendMessage(tabId, message) {
        harness.messages.push({ tabId, message });
      },
    },
    contextMenus: {
      removeAll(callback) {
        callback();
      },
      create(menu) {
        harness.createdMenu = menu;
      },
      onClicked: {
        addListener(listener) {
          harness.listeners.clicked = listener;
        },
      },
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", ".build", "browser-runtime", "service-worker.js"),
    "utf8",
  );

  vm.runInNewContext(source, {
    chrome,
    console: { ...console, error() {} },
    setTimeout,
    clearTimeout,
  });

  return harness;
}

test("service worker registers whole-page and selection entry points", () => {
  const harness = createServiceWorkerHarness();

  assert.equal(typeof harness.listeners.installed, "function");
  assert.equal(typeof harness.listeners.clicked, "function");
  assert.equal(typeof harness.listeners.actionClicked, "function");
  harness.listeners.installed();
  assert.equal(harness.createdMenu.id, "read-selection-rsvp");
  assert.equal(harness.createdMenu.title, "RSVPで読む");
  assert.deepEqual(Array.from(harness.createdMenu.contexts), ["selection"]);
});

test("toolbar action loads the reader and starts extracted page content", async () => {
  const harness = createServiceWorkerHarness();

  const actionPromise = harness.listeners.actionClicked({ id: 7 });
  await harness.extractionStarted;
  assert.equal(harness.sessionHostOptions.url, "session-host.html");
  assert.deepEqual(Array.from(harness.sessionHostOptions.reasons), ["WORKERS"]);
  assert.equal(
    harness.sessionHostOptions.justification,
    "Run the local ReaderSession worker outside website content security policies.",
  );
  assert.equal(harness.scriptCalls[0].world, "ISOLATED");
  assert.deepEqual(Array.from(harness.scriptCalls[0].args), ["chrome-extension://reader/runtime.js"]);
  assert.match(harness.scriptCalls[0].func.toString(), /import\(/u);
  assert.equal(harness.messages[0].tabId, 7);
  assert.equal(harness.messages[0].message.type, "SHOW_RSVP_LOADING");
  assert.equal(typeof harness.finishExtraction, "function");

  harness.finishExtraction();
  await actionPromise;

  assert.deepEqual(Array.from(harness.scriptCalls[1].files), ["vendor/defuddle/defuddle.js"]);
  const injectedFiles = harness.scriptCalls.flatMap((call) => call.files || []);
  assert.equal(injectedFiles.filter((file) => file === "vendor/defuddle/defuddle.js").length, 1);
  assert.equal(harness.messages[1].tabId, 7);
  assert.equal(harness.messages[1].message.type, "START_RSVP");
  assert.equal(harness.messages[1].message.text, "記事本文");
  assert.equal(harness.messages[1].message.readingContext.headings[0].text, "記事タイトル");
  assert.equal("morphologyTokens" in harness.messages[1].message, false);
  const extractionCall = harness.scriptCalls.find((call) => call.func?.toString().includes("fromPageAsync"));
  assert.equal(extractionCall.world, "ISOLATED");
  assert.deepEqual(Array.from(extractionCall.args), [harness.messages[0].message.requestId]);
  assert.match(extractionCall.func.toString(), /AbortController/u);
  assert.match(extractionCall.func.toString(), /signal:\w+\.signal/u);
});

test("selection action starts the selected text without page extraction", async () => {
  const harness = createServiceWorkerHarness();

  await harness.listeners.clicked(
    { menuItemId: "read-selection-rsvp", selectionText: "選択した本文" },
    { id: 8 },
  );

  assert.equal(harness.messages[0].tabId, 8);
  assert.equal(harness.messages[0].message.type, "SHOW_RSVP_LOADING");
  assert.equal(harness.messages[1].tabId, 8);
  assert.equal(harness.messages[1].message.type, "START_RSVP");
  assert.equal(harness.messages[1].message.text, "選択した本文");
  assert.equal(harness.scriptCalls.length, 1);
  assert.deepEqual(Array.from(harness.scriptCalls[0].args), ["chrome-extension://reader/runtime.js"]);
});

test("toolbar action reports an extraction error for an empty page", async () => {
  const harness = createServiceWorkerHarness();
  harness.extractionResult = null;

  const actionPromise = harness.listeners.actionClicked({ id: 9 });
  await harness.extractionStarted;
  assert.equal(harness.messages[0].message.type, "SHOW_RSVP_LOADING");
  assert.equal(typeof harness.finishExtraction, "function");
  harness.finishExtraction();
  await actionPromise;

  assert.equal(harness.messages[1].message.type, "RSVP_ERROR");
  assert.equal(harness.messages[1].message.requestId, harness.messages[0].message.requestId);
  assert.equal(harness.messages[1].message.reason, "content_not_found");
});

test("service worker aborts cooperative extraction and drops its result after cancel", async () => {
  const harness = createServiceWorkerHarness();

  const actionPromise = harness.listeners.actionClicked({ id: 10 });
  await harness.extractionStarted;
  const loadingMessage = harness.messages[0].message;
  harness.listeners.runtimeMessage(
    { type: "CANCEL_RSVP", requestId: loadingMessage.requestId },
    { tab: { id: 10 } },
  );
  assert.deepEqual(Array.from(harness.abortedRequestIds), [loadingMessage.requestId]);
  harness.rejectExtraction(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  await actionPromise;

  assert.deepEqual(harness.messages.map(({ message }) => message.type), ["SHOW_RSVP_LOADING"]);
});

test("service worker aborts the previous tab extraction when a newer request starts", async () => {
  const harness = createServiceWorkerHarness();

  const firstAction = harness.listeners.actionClicked({ id: 14 });
  await harness.extractionStarted;
  const firstRequestId = harness.messages[0].message.requestId;

  const secondAction = harness.listeners.actionClicked({ id: 14 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.extractionRequestIds.length, 2);
  const secondRequestId = harness.messages[1].message.requestId;
  assert.notEqual(secondRequestId, firstRequestId);
  assert.deepEqual(Array.from(harness.abortedRequestIds), [firstRequestId]);

  harness.extractionResult = { text: "新しい本文", readingContext: {} };
  harness.finishExtractionFor(secondRequestId);
  await secondAction;
  harness.finishExtractionFor(firstRequestId);
  await firstAction;

  assert.deepEqual(harness.messages.map(({ message }) => message.type), [
    "SHOW_RSVP_LOADING",
    "SHOW_RSVP_LOADING",
    "START_RSVP",
  ]);
  assert.equal(harness.messages[2].message.requestId, secondRequestId);
});

test("service worker retries only the matching failed request with a new request id", async () => {
  const harness = createServiceWorkerHarness();
  harness.extractionResult = null;

  const actionPromise = harness.listeners.actionClicked({ id: 11 });
  await harness.extractionStarted;
  const failedRequestId = harness.messages[0].message.requestId;
  harness.finishExtraction();
  await actionPromise;

  harness.listeners.runtimeMessage(
    { type: "RETRY_RSVP", requestId: "stale-request" },
    { tab: { id: 11 } },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.messages.length, 2);

  harness.extractionResult = { text: "再試行本文", readingContext: {} };
  harness.listeners.runtimeMessage(
    { type: "RETRY_RSVP", requestId: failedRequestId },
    { tab: { id: 11 } },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const retriedRequestId = harness.messages[2].message.requestId;
  assert.equal(harness.messages[2].message.type, "SHOW_RSVP_LOADING");
  assert.notEqual(retriedRequestId, failedRequestId);
  harness.finishExtraction();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.messages[3].message.type, "START_RSVP");
  assert.equal(harness.messages[3].message.requestId, retriedRequestId);

  harness.listeners.runtimeMessage(
    { type: "RETRY_RSVP", requestId: failedRequestId },
    { tab: { id: 11 } },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.messages.length, 4);
});

test("service worker releases selection retry data after success and cancel", async () => {
  const successfulHarness = createServiceWorkerHarness();
  await successfulHarness.listeners.clicked(
    { menuItemId: "read-selection-rsvp", selectionText: "保持しない選択本文" },
    { id: 12 },
  );
  const successfulRequestId = successfulHarness.messages[0].message.requestId;
  successfulHarness.listeners.runtimeMessage(
    { type: "RETRY_RSVP", requestId: successfulRequestId },
    { tab: { id: 12 } },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(successfulHarness.messages.length, 2);

  const cancelledHarness = createServiceWorkerHarness();
  await cancelledHarness.listeners.clicked(
    { menuItemId: "read-selection-rsvp", selectionText: "取消後に保持しない選択本文" },
    { id: 13 },
  );
  const cancelledRequestId = cancelledHarness.messages[0].message.requestId;
  cancelledHarness.listeners.runtimeMessage(
    { type: "CANCEL_RSVP", requestId: cancelledRequestId },
    { tab: { id: 13 } },
  );
  cancelledHarness.listeners.runtimeMessage(
    { type: "RETRY_RSVP", requestId: cancelledRequestId },
    { tab: { id: 13 } },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelledHarness.messages.length, 2);
});
