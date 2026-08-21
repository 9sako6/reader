export {};

import { FakeElement, findElement } from "./fake-dom";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../../../.build/packages/engine/src/engine.js");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "ReaderExtension", "Resources", "manifest.json");

test("Safari extension loads reader resources in dependency order", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "defuddle.js",
    "engine.js",
    "extractor.js",
    "icons.js",
    "viewer.js",
    "bootstrap.js",
  ]);
});

test("Xcode project embeds every manifest script in the extension", () => {
  const project = fs.readFileSync(path.join(root, "reader.xcodeproj", "project.pbxproj"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const script of manifest.content_scripts[0].js) {
    assert.match(project, new RegExp(`${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} in Resources`));
  }
  assert.match(project, /reader-extension\.appex in Embed Foundation Extensions/);
});

test("Safari reader shows an image again after returning to the preceding sentence", async () => {
  const documentElement = new FakeElement("html");
  documentElement.lang = "ja";
  const body = new FakeElement("body");
  documentElement.append(body);
  const document = {
    documentElement,
    body,
    title: "",
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
  };
  const leadingSentence = "画像の前です。";
  const caption = "図1";
  const followingSentence = "画像の後です。";
  const figureOffset = `${leadingSentence}\n`.length;
  const figureEnd = figureOffset + caption.length;
  const text = `${leadingSentence}\n${caption}\n${followingSentence}`;
  const content = {
    text,
    readingContext: {
      title: "",
      blocks: [
        { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: leadingSentence.length },
        { text: followingSentence, kind: "paragraph", level: null, start: figureEnd + 1, end: text.length },
      ],
      headings: [],
      sectionOffsets: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [{
        src: "https://example.com/figure.png",
        alt: "本文画像",
        caption,
        sourceOffset: figureOffset,
        sourceEnd: figureEnd,
      }],
    },
  };
  let nextTimerId = 1;
  const timers = new Map();
  const context: any = {
    document,
    Engine,
    Extractor: { fromPage: () => content },
    ReaderIcons: { create: () => new FakeElement("svg") },
    Defuddle: class {},
    innerWidth: 390,
    scrollY: 0,
    console,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    requestAnimationFrame(callback) {
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
  const source = fs.readFileSync(
    path.join(root, "ReaderExtension", "Resources", "generated", "viewer.js"),
    "utf8",
  );
  vm.runInNewContext(source, context);
  context.MobileViewer.install();
  await context.MobileViewer.open();

  const runUntilFigure = () => {
    for (let step = 0; step < 10; step += 1) {
      const figure = findElement(
        documentElement,
        (element) => element.attributes["aria-label"] === "本文画像",
      );
      if (figure) return figure;
      const nextTimer = [...timers.entries()][0];
      assert.ok(nextTimer);
      const [timerId, timer] = nextTimer;
      timers.delete(timerId);
      timer.callback();
    }
    return null;
  };

  assert.ok(runUntilFigure());
  findElement(documentElement, (element) => element.attributes["aria-label"] === "再生")
    .dispatchEvent({ type: "click" });
  findElement(documentElement, (element) => element.attributes["aria-label"] === "1文戻る")
    .dispatchEvent({ type: "click" });
  findElement(documentElement, (element) => element.attributes["aria-label"] === "再生")
    .dispatchEvent({ type: "click" });

  assert.ok(runUntilFigure());
});
