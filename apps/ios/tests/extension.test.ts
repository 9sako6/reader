export {};

import { FakeElement, findElement, findElements } from "./fake-dom";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Engine = require("../../../.build/packages/engine/src/engine.js");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "ReaderExtension", "Resources", "manifest.json");

function fireNextTimer(timers) {
  const [timerId, timer] = [...timers.entries()][0];
  timers.delete(timerId);
  timer.callback();
}

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
  assert.match(project, /defuddle\.js in Resources/);
  assert.match(project, /engine\.js in Resources/);
  assert.match(project, /extractor\.js in Resources/);
  assert.match(project, /icons\.js in Resources/);
  assert.match(project, /viewer\.js in Resources/);
  assert.match(project, /bootstrap\.js in Resources/);
  assert.match(project, /reader-extension\.appex in Embed Foundation Extensions/);
});

function createSafariReaderHarness(engine = Engine, language = "ja") {
  const documentElement = new FakeElement("html");
  documentElement.lang = language;
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

  return {
    context,
    documentElement,
    createdElements,
    timers,
    launchFeedbackDuringExtraction() {
      return launchFeedbackDuringExtraction;
    },
    extractionCount() {
      return extractionCount;
    },
    setActiveContent(content) {
      activeContent = content;
    },
  };
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
});

test("Safari reader reveals controls and preserves the paused state", async () => {
  const { context, documentElement } = createSafariReaderHarness();
  await context.MobileViewer.open();

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
});

test("Safari reader pauses on an image and can return to the previous sentence", async () => {
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
  assert.equal(backButton.parent.hidden, true);
  firstFigure.dispatchEvent({ type: "pointerup", clientX: 300, clientY: 240, timeStamp: 3900 });
  assert.equal(backButton.parent.hidden, false);
  backButton.dispatchEvent({ type: "click" });
  assert.ok(findElement(documentElement, (element) => element.attributes["aria-label"] === "一時停止"));
  assert.equal(backButton.parent.hidden, false);
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

test("Safari reader maps text viewport positions back to RSVP content", async () => {
  const { context, documentElement, timers } = createSafariReaderHarness();
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
});

test("Safari reader caches one article and extracts again after navigation", async () => {
  const harness = createSafariReaderHarness();
  const { context, documentElement, createdElements } = harness;
  await context.MobileViewer.open();

  context.MobileViewer.close();
  await context.MobileViewer.open();
  assert.equal(harness.extractionCount(), 1);
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

  context.MobileViewer.close();
  context.location.href = "https://example.com/articles/second";
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
});
