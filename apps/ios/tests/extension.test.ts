export {};

import { FakeElement, findElement, findElements } from "./fake-dom";

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

test("Safari reader preserves reading flow across gestures, images, and text mode", async () => {
  const documentElement = new FakeElement("html");
  documentElement.lang = "ja";
  const body = new FakeElement("body");
  documentElement.append(body);
  const createdElements: FakeElement[] = [];
  const document = {
    documentElement,
    body,
    title: "",
    createElement(tagName) {
      const element = new FakeElement(tagName);
      createdElements.push(element);
      return element;
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
  };
  const leadingSentence = "画像より前にあるとても長い文章をここで読んでいます。";
  const caption = "図1";
  const followingSentence = "画像の後です。";
  const laterSentence = "さらに後の文章です。";
  const figureOffset = `${leadingSentence}\n`.length;
  const figureEnd = figureOffset + caption.length;
  const followingOffset = figureEnd + 1;
  const laterOffset = followingOffset + followingSentence.length + 1;
  const text = `${leadingSentence}\n${caption}\n${followingSentence}\n${laterSentence}`;
  const content = {
    text,
    readingContext: {
      title: "",
      blocks: [
        { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: leadingSentence.length },
        { text: followingSentence, kind: "paragraph", level: null, start: followingOffset, end: followingOffset + followingSentence.length },
        { text: laterSentence, kind: "paragraph", level: null, start: laterOffset, end: text.length },
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
  let launchFeedbackDuringExtraction = null;
  let extractionCount = 0;
  let now = 0;
  const context: any = {
    document,
    Engine,
    Extractor: {
      fromPage: () => {
        extractionCount += 1;
        now = 120;
        launchFeedbackDuringExtraction = findElement(
          documentElement,
          (element) => element.className === "launch-feedback",
        );
        return content;
      },
    },
    ReaderIcons: { create: () => new FakeElement("svg") },
    Defuddle: class {},
    innerWidth: 390,
    innerHeight: 844,
    scrollY: 0,
    console,
    Date: { now: () => now },
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
  const readerStyle = createdElements.find((element) => element.tagName === "STYLE");
  assert.match(readerStyle.textContent, /\.rsvp-unit \{[^}]*display: grid;[^}]*place-items: center;/u);
  await context.MobileViewer.open();

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
  assert.equal(launchLoader.style.animationDelay, "100ms");
  assert.equal(launchLoader.style.opacity, "1");
  assert.equal(progressIndicator.animations.length, 2);
  assert.equal(progressIndicator.animations[0].options.iterations, 1);
  assert.equal(progressIndicator.animations[0].options.duration, 1200);
  assert.equal(progressIndicator.animations[0].keyframes[0].transform, "scaleX(0)");
  assert.equal(progressIndicator.animations[0].keyframes[1].transform, "scaleX(.94)");
  const completionFrames = progressIndicator.animations[1].keyframes;
  const completionStart = Number.parseFloat(completionFrames[0].transform.slice(7));
  assert.ok(completionStart > 0.09 && completionStart < 0.1);
  assert.equal(completionFrames[completionFrames.length - 1].transform, "scaleX(1)");
  assert.ok(launchFeedbackDuringExtraction.animations.length > 0);

  const modeButton = findElement(documentElement, (element) => element.textContent === "文章で読む");
  const backButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "1文戻る",
  );
  const rsvpView = findElement(documentElement, (element) => element.className === "rsvp-view");
  assert.equal(modeButton.parent.className, "controlbar");
  assert.equal(modeButton.hidden, false);
  assert.equal(backButton.parent.hidden, true);

  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1000 });
  assert.equal(backButton.parent.hidden, false);
  const playButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "一時停止",
  );
  assert.ok(playButton);
  playButton.dispatchEvent({ type: "click" });
  assert.equal(playButton.attributes["aria-label"], "再生");
  assert.equal(backButton.parent.hidden, false);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1400 });
  assert.equal(backButton.parent.hidden, true);
  assert.equal(playButton.attributes["aria-label"], "再生");
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 1700 });
  assert.equal(backButton.parent.hidden, false);

  rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 2000 });
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 2200 });
  const pausedFeedback = findElement(
    documentElement,
    (element) => element.className === "rewind-feedback",
  );
  assert.ok(pausedFeedback);
  assert.equal(pausedFeedback.style.left, "54px");
  assert.equal(pausedFeedback.children.filter((child) => child.className === "rewind-ring").length, 2);
  assert.ok(pausedFeedback.children[0].animations.length > 0);
  assert.equal(backButton.parent.hidden, false);
  assert.equal(timers.size, 0);

  playButton.dispatchEvent({ type: "click" });
  assert.equal(playButton.attributes["aria-label"], "一時停止");
  assert.equal(backButton.parent.hidden, false);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 2600 });
  assert.equal(backButton.parent.hidden, true);
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 52, clientY: 240, timeStamp: 3000 });
  rsvpView.dispatchEvent({ type: "pointerup", clientX: 54, clientY: 242, timeStamp: 3180 });
  assert.equal(backButton.parent.hidden, true);
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.equal(timers.size, 1);

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

  const firstFigure = runUntilFigure();
  assert.ok(firstFigure);
  assert.equal(backButton.parent.hidden, false);
  firstFigure.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 3600 });
  assert.equal(backButton.parent.hidden, true);
  firstFigure.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 3900 });
  assert.equal(backButton.parent.hidden, false);
  backButton.dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.equal(backButton.parent.hidden, false);
  assert.ok(timers.size > 0);

  assert.ok(runUntilFigure());

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
  scroller.dispatchEvent({ type: "pointerdown" });
  modeButton.dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "本文画像"));

  const imagePlayButton = findElement(
    documentElement,
    (element) => element.attributes["aria-label"] === "再生",
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

  context.MobileViewer.close();
  await context.MobileViewer.open();
  assert.equal(extractionCount, 1);
  const launchFeedbacks = createdElements.filter((element) => element.className === "launch-feedback");
  const cachedLaunchFeedback = launchFeedbacks[launchFeedbacks.length - 1];
  const cachedProgressIndicator = findElement(
    cachedLaunchFeedback,
    (element) => element.className === "launch-progress-indicator",
  );
  const cachedLaunchLoader = findElement(
    cachedLaunchFeedback,
    (element) => element.className === "launch-loader",
  );
  assert.equal(cachedProgressIndicator.animations.length, 1);
  assert.notEqual(cachedLaunchLoader.style.opacity, "1");
  assert.equal(cachedLaunchFeedback.animations.length, 0);
});
