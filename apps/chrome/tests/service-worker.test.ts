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
    finishExtraction: null,
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
      onInstalled: {
        addListener(listener) {
          harness.listeners.installed = listener;
        },
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
        if (options.func) {
          reportExtractionStarted();
          return new Promise((resolve) => {
            harness.finishExtraction = () => resolve([{ result: harness.extractionResult }]);
          });
        }
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
    path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "service-worker.js"),
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
  assert.deepEqual(Array.from(harness.scriptCalls[0].files), [
    "engine.js",
    "extractor.js",
    "icons.js",
    "viewer.js",
  ]);
  assert.equal(harness.messages[0].tabId, 7);
  assert.equal(harness.messages[0].message.type, "SHOW_RSVP_LOADING");
  assert.equal(typeof harness.finishExtraction, "function");

  harness.finishExtraction();
  await actionPromise;

  assert.deepEqual(Array.from(harness.scriptCalls[1].files), [
    "vendor/defuddle/defuddle.js",
    "extractor.js",
  ]);
  assert.equal(harness.messages[1].tabId, 7);
  assert.equal(harness.messages[1].message.type, "START_RSVP");
  assert.equal(harness.messages[1].message.text, "記事本文");
  assert.equal(harness.messages[1].message.readingContext.headings[0].text, "記事タイトル");
  assert.equal("morphologyTokens" in harness.messages[1].message, false);
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
  assert.deepEqual(Array.from(harness.scriptCalls[0].files), [
    "engine.js",
    "extractor.js",
    "icons.js",
    "viewer.js",
  ]);
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
});
