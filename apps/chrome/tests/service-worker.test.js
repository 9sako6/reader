const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("service worker registers selection and whole-page entry points", async () => {
  const listeners = {};
  let createdMenu = null;
  const scriptCalls = [];
  const messages = [];
  let finishExtraction = null;
  const readingContext = {
    headings: [{ text: "記事タイトル", level: 1 }],
    sectionTransitions: [{ offset: 0, headingIndex: 0 }],
    initialHeadingIndex: -1,
  };
  let extractionResult = { text: "記事本文", readingContext };
  const chrome = {
    runtime: {
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          listeners.actionClicked = listener;
        },
      },
    },
    scripting: {
      async executeScript(options) {
        scriptCalls.push(options);
        if (options.func) {
          return new Promise((resolve) => {
            finishExtraction = () => resolve([{ result: extractionResult }]);
          });
        }
        return [];
      },
    },
    tabs: {
      async sendMessage(tabId, message) {
        messages.push({ tabId, message });
      },
    },
    contextMenus: {
      removeAll(callback) {
        callback();
      },
      create(menu) {
        createdMenu = menu;
      },
      onClicked: {
        addListener(listener) {
          listeners.clicked = listener;
        },
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".build", "apps", "chrome", "src", "service-worker.js"), "utf8");
  assert.doesNotMatch(source, /KAGOME|Kagome|kagome|WebAssembly|wasm/);
  assert.doesNotMatch(source, /PREPARE_RSVP/);

  vm.runInNewContext(source, {
    chrome,
    console: { ...console, error() {} },
    setTimeout,
    clearTimeout,
  });

  assert.equal(typeof listeners.installed, "function");
  assert.equal(typeof listeners.clicked, "function");
  assert.equal(typeof listeners.actionClicked, "function");
  listeners.installed();
  assert.equal(createdMenu.id, "read-selection-rsvp");
  assert.equal(createdMenu.title, "RSVPで読む");
  assert.equal(createdMenu.contexts.join(","), "selection");

  const actionPromise = listeners.actionClicked({ id: 7 });
  while (!finishExtraction) await Promise.resolve();
  assert.equal(
    scriptCalls[0].files.join(","),
    "engine.js,extractor.js,viewer.js",
  );
  assert.equal(messages[0].tabId, 7);
  assert.equal(messages[0].message.type, "SHOW_RSVP_LOADING");

  finishExtraction();
  await actionPromise;
  assert.equal(
    scriptCalls[1].files.join(","),
    "vendor/defuddle/defuddle.js,extractor.js",
  );
  assert.equal(messages[0].tabId, 7);
  assert.equal(messages[1].message.type, "START_RSVP");
  assert.equal(messages[1].message.readingContext.headings[0].text, "記事タイトル");
  assert.equal("morphologyTokens" in messages[1].message, false);

  await listeners.clicked(
    { menuItemId: "read-selection-rsvp", selectionText: "選択した本文" },
    { id: 8 },
  );
  assert.equal(messages[2].message.type, "SHOW_RSVP_LOADING");
  assert.equal(messages[3].message.type, "START_RSVP");
  assert.equal(messages[3].message.text, "選択した本文");

  extractionResult = null;
  finishExtraction = null;
  const emptyActionPromise = listeners.actionClicked({ id: 9 });
  while (!finishExtraction) await Promise.resolve();
  assert.equal(messages[4].message.type, "SHOW_RSVP_LOADING");
  finishExtraction();
  await emptyActionPromise;
  assert.equal(messages[5].message.type, "RSVP_ERROR");
  assert.equal(messages[5].message.requestId, messages[4].message.requestId);
});
