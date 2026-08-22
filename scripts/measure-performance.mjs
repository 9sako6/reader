import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(repositoryRoot, "test-results/performance/reader.json");
const generatedRoot = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated");
const scripts = ["defuddle.js", "engine.js", "extractor.js", "icons.js", "viewer.js"]
  .map((name) => resolve(generatedRoot, name));
const nodeCounts = [1000, 10_000, 50_000];
const fixtures = [
  { name: "short-article", nodeCount: 1000, extraction: "dominant" },
  { name: "long-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "dominant-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "defuddle-fallback", nodeCount: 10_000, extraction: "fallback" },
];

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] || 0;
}

function medianReport(runs) {
  const numericKeys = [
    "bootstrapMs",
    "tapToFirstFeedbackMs",
    "extractionMs",
    "tapToFirstRenderMs",
    "nodeCount",
    "dominantArticleMs",
    "defuddleMs",
    "indexMs",
    "contextMs",
  ];
  return Object.fromEntries(numericKeys.map((key) => [key, median(runs.map((run) => run[key]))]));
}

async function measurePage(browser, fixture) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(120_000);
  try {
    await page.setContent("<!doctype html><html lang=\"ja\"><head></head><body></body></html>");
    for (const script of scripts) await page.addScriptTag({ path: script });
    return await page.evaluate(({ nodeCount, extraction }) => {
      const sourceMarkup = (() => {
        const rootTag = extraction === "dominant" ? "article" : "main";
        const spanCount = Math.max(3, nodeCount - 4);
        const paragraphs = ["<p>", "<p>", "<p>"];
        for (let index = 0; index < spanCount; index += 1) {
          paragraphs[index % 3] += "<span>読みやすい文章です。</span>";
        }
        return `<${rootTag}>${paragraphs.map((value) => `${value}</p>`).join("")}</${rootTag}>`;
      })();
      const fallbackMarkup = extraction === "fallback" ? sourceMarkup.replace(/^<main>|<\/main>$/gu, "") : sourceMarkup;
      document.body.innerHTML = sourceMarkup;
      class FixtureDefuddle {
        parse() {
          return { content: fallbackMarkup, title: "" };
        }
      }
      globalThis.Defuddle = FixtureDefuddle;
      globalThis.__READER_PERFORMANCE_ENABLED = true;
      const beforeInstall = performance.now();
      globalThis.MobileViewer.install();
      const openPromise = globalThis.MobileViewer.open();
      return openPromise.then(() => {
        const mark = (name) => performance.getEntriesByName(name, "mark").at(-1)?.startTime;
        const tap = mark("reader:tap");
        const firstFeedback = mark("reader:first-feedback");
        const extractionStart = mark("reader:extraction-start");
        const extractionEnd = mark("reader:extraction-end");
        const firstRender = mark("reader:first-render");
        const metrics = globalThis.__READER_PERFORMANCE_LAST_METRICS || {};
        return {
          bootstrapMs: Math.max(0, (mark("reader:bootstrap-ready") || beforeInstall) - beforeInstall),
          tapToFirstFeedbackMs: Math.max(0, (firstFeedback || tap || 0) - (tap || 0)),
          extractionMs: Math.max(0, (extractionEnd || extractionStart || 0) - (extractionStart || 0)),
          tapToFirstRenderMs: Math.max(0, (firstRender || tap || 0) - (tap || 0)),
          nodeCount: document.querySelectorAll("*").length,
          dominantArticleMs: metrics.dominantArticleMs || 0,
          defuddleMs: metrics.defuddleMs || 0,
          indexMs: metrics.indexMs || 0,
          contextMs: metrics.contextMs || 0,
        };
      });
    }, fixture);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const fixtureReports = {};
  for (const fixture of fixtures) {
    const runs = [];
    for (let run = 0; run < 3; run += 1) runs.push(await measurePage(browser, fixture));
    fixtureReports[fixture.name] = { runs, median: medianReport(runs) };
  }

  const nodeReports = {};
  for (const nodeCount of nodeCounts) {
    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      runs.push(await measurePage(browser, { name: `nodes-${nodeCount}`, nodeCount, extraction: "dominant" }));
    }
    nodeReports[String(nodeCount)] = { runs, median: medianReport(runs) };
  }

  const report = { fixtures: fixtureReports, nodeBenchmarks: nodeReports };
  await mkdir(resolve(repositoryRoot, "test-results/performance"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
