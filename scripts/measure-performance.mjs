import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(repositoryRoot, "test-results/performance/reader.json");
const webPort = Number(process.env.READER_PERFORMANCE_PORT) || 4173;
const baseUrl = `http://127.0.0.1:${webPort}`;
const generatedRoot = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated");
const scripts = ["session-wasm-module.js", "session.js", "defuddle.js", "engine.js", "extractor.js", "icons.js", "viewer.js"]
  .map((name) => resolve(generatedRoot, name));
const nodeCounts = [1000, 10_000, 50_000, 100_000];
const runsPerCase = Number(process.env.READER_PERFORMANCE_RUNS) || 10;
const budgetMargin = 0.25;
const baseline = {
  source: "github-actions/macos-15 run 32590877670 artifact reader-performance-baseline",
  runs: 10,
  margin: budgetMargin,
  conditions: "Chromium headless, 390x844 viewport, 10 runs/case, main-equivalent product artifacts on GitHub Actions macos-15",
  fixtures: {
    "short-article": { tapToFirstUnitMs: 412.6, tapToFirstRenderMs: 413.1, tapToFirstFeedbackMs: 1.5, sessionInitMs: 0 },
    "long-article": { tapToFirstUnitMs: 1089.5, tapToFirstRenderMs: 1090.9, tapToFirstFeedbackMs: 5.9, sessionInitMs: 0 },
    "dominant-article": { tapToFirstUnitMs: 1068.4, tapToFirstRenderMs: 1069.8, tapToFirstFeedbackMs: 5.6, sessionInitMs: 0 },
    "defuddle-fallback": { tapToFirstUnitMs: 1101, tapToFirstRenderMs: 1102.4, tapToFirstFeedbackMs: 5.1, sessionInitMs: 0 },
  },
  nodeBenchmarks: {
    "1000": { tapToFirstUnitMs: 406.6, tapToFirstRenderMs: 407.2, tapToFirstFeedbackMs: 8.5, extractionMs: 152, sessionInitMs: 0 },
    "10000": { tapToFirstUnitMs: 1081.4, tapToFirstRenderMs: 1082.9, tapToFirstFeedbackMs: 5.9, extractionMs: 153.2, sessionInitMs: 0 },
    "50000": { tapToFirstUnitMs: 4313.3, tapToFirstRenderMs: 4318.9, tapToFirstFeedbackMs: 178, extractionMs: 178.1, sessionInitMs: 0 },
    "100000": { tapToFirstUnitMs: 11881.5, tapToFirstRenderMs: 11898.4, tapToFirstFeedbackMs: 53.1, extractionMs: 378.9, sessionInitMs: 0 },
  },
  passive: { bootstrapDecodedBytes: 10210, longTaskCount: 0 },
  retainedHeap: {
    floorBytes: 65_536,
    fixtures: {
      "short-article": 412_068,
      "long-article": 574_960,
      "dominant-article": 574_660,
      "defuddle-fallback": -49_460,
    },
    nodeBenchmarks: { "1000": 412_068, "10000": 577_192, "50000": 1_219_940, "100000": 2_019_188 },
  },
  localSameHostComparison: {
    source: "origin/main product artifacts, local same-host 10-run measurement",
    fixtures: { "short-article": 289.5, "long-article": 834.2, "dominant-article": 831.9, "defuddle-fallback": 872.7 },
    nodeBenchmarks: { "1000": 292.7, "10000": 817.6, "50000": 3415.7, "100000": 6649.4 },
  },
};
const fixtures = [
  { name: "short-article", nodeCount: 1000, extraction: "dominant" },
  { name: "long-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "dominant-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "defuddle-fallback", nodeCount: 10_000, extraction: "fallback" },
];

let fixtureServer = null;
try {
  await fetch(`${baseUrl}/tests/e2e/fixtures/performance.html`);
  } catch {
  fixtureServer = spawn(process.execPath, ["tests/e2e/server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, READER_E2E_PORT: String(webPort) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(`${baseUrl}/tests/e2e/fixtures/performance.html`);
      break;
    } catch {
      await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 20));
    }
  }
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] || 0;
}

function percentile(values, percentileRank) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentileRank) - 1)] || 0;
}

function medianReport(runs) {
  const numericKeys = [
    "bootstrapMs",
    "tapToFirstFeedbackMs",
    "tapToFirstUnitMs",
    "sessionInitMs",
    "extractionMs",
    "tapToFirstRenderMs",
    "nodeCount",
    "dominantArticleMs",
    "defuddleMs",
    "indexMs",
    "contextMs",
    "heapBeforeOpenBytes",
    "retainedHeapAfterCloseBytes",
    "retainedHeapDeltaBytes",
  ];
  return Object.fromEntries(numericKeys.map((key) => [key, median(runs.map((run) => run[key]))]));
}

function percentileReport(runs, percentileRank) {
  const numericKeys = [
    "bootstrapMs",
    "tapToFirstFeedbackMs",
    "tapToFirstUnitMs",
    "sessionInitMs",
    "extractionMs",
    "tapToFirstRenderMs",
    "nodeCount",
    "dominantArticleMs",
    "defuddleMs",
    "indexMs",
    "contextMs",
    "heapBeforeOpenBytes",
    "retainedHeapAfterCloseBytes",
    "retainedHeapDeltaBytes",
  ];
  return Object.fromEntries(numericKeys.map((key) => [key, percentile(runs.map((run) => run[key]), percentileRank)]));
}

function retainedHeapReport(runs) {
  const deltas = runs.map((run) => run.retainedHeapDeltaBytes).filter((value) => value !== null);
  return {
    samples: deltas.length,
    p50Bytes: deltas.length > 0 ? percentile(deltas, 0.5) : null,
    p90Bytes: deltas.length > 0 ? percentile(deltas, 0.9) : null,
    maxBytes: deltas.length > 0 ? Math.max(...deltas) : null,
  };
}

function budgetReport(fixtureName, p90, retainedHeap) {
  const fixtureBaseline = baseline.fixtures[fixtureName] || baseline.nodeBenchmarks[fixtureName];
  if (!fixtureBaseline) return { status: "not-applicable", metrics: {} };
  const metrics = Object.fromEntries(Object.entries(fixtureBaseline)
    .filter(([metric]) => [
      "tapToFirstUnitMs",
      "tapToFirstRenderMs",
      ...(baseline.nodeBenchmarks[fixtureName] ? ["extractionMs"] : ["tapToFirstFeedbackMs"]),
    ].includes(metric))
    .map(([metric, baselineP90]) => {
    const budget = baselineP90 * (1 + budgetMargin);
    return [metric, {
      baselineP90,
      budget,
      observedP90: p90[metric],
      increaseRate: (p90[metric] - baselineP90) / baselineP90,
      regression: p90[metric] > budget,
    }];
    }));
  const retainedBaseline = (baseline.nodeBenchmarks[fixtureName]
    ? baseline.retainedHeap.nodeBenchmarks[fixtureName]
    : baseline.retainedHeap.fixtures[fixtureName]);
  if (retainedBaseline !== null && retainedBaseline !== undefined) {
    const normalizedBaseline = Math.max(retainedBaseline, 0);
    const budget = Math.max(normalizedBaseline, baseline.retainedHeap.floorBytes) * (1 + budgetMargin);
    const observedP90 = retainedHeap.p90Bytes;
    metrics.retainedHeapDeltaBytes = {
      baselineP90: retainedBaseline,
      normalizedBaselineForBudget: normalizedBaseline,
      floorBytes: baseline.retainedHeap.floorBytes,
      budget,
      observedP90,
      increaseRate: retainedBaseline === 0 ? null : (observedP90 - retainedBaseline) / Math.abs(retainedBaseline),
      regression: observedP90 > budget,
    };
  }
  return {
    status: Object.values(metrics).some((metric) => metric.regression) ? "regression" : "within-budget",
    metrics,
  };
}

async function measurePassivePage(browser, control = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    await page.addInitScript(() => {
      globalThis.__READER_PASSIVE_LONG_TASKS = [];
      if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
        const observer = new PerformanceObserver((list) => {
          globalThis.__READER_PASSIVE_LONG_TASKS.push(...list.getEntries().map((entry) => entry.duration));
        });
        observer.observe({ type: "longtask", buffered: true });
      }
    });
    const query = control ? "passive-control=1" : "passive=1";
    await page.goto(`${baseUrl}/tests/e2e/fixtures/safari-package-lazy-runtime.html?${query}`, { waitUntil: "load" });
    await page.waitForTimeout(200);
    const browserMetrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    return await page.evaluate((metrics) => {
      const scriptEntries = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/apps/ios/ReaderExtension/Resources/generated/"));
      const bootstrapEntry = scriptEntries.find((entry) => entry.name.endsWith("/bootstrap.js"));
      return {
        bootstrapRequestCount: scriptEntries.filter((entry) => entry.name.endsWith("/bootstrap.js")).length,
        bootstrapTransferBytes: bootstrapEntry?.transferSize ?? null,
        bootstrapDecodedBytes: bootstrapEntry?.decodedBodySize ?? null,
        passiveScriptTransferBytes: scriptEntries.reduce((total, entry) => total + (entry.transferSize || 0), 0),
        passiveScriptDecodedBytes: scriptEntries.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0),
        longTaskCount: globalThis.__READER_PASSIVE_LONG_TASKS.length,
        longTaskTotalMs: globalThis.__READER_PASSIVE_LONG_TASKS.reduce((total, duration) => total + duration, 0),
        heapTotalBytes: globalThis.performance.memory?.totalJSHeapSize ?? null,
        scriptDurationMs: (metrics.ScriptDuration || 0) * 1000,
        taskDurationMs: (metrics.TaskDuration || 0) * 1000,
        layoutDurationMs: (metrics.LayoutDuration || 0) * 1000,
        heapUsedBytes: metrics.JSHeapUsedSize ?? globalThis.performance.memory?.usedJSHeapSize ?? null,
        parseEvalMs: null,
        parseEvalMethod: "not exposed separately; ScriptDuration from CDP is reported",
        scrollDispatchMs: (() => {
          const start = performance.now();
          for (let index = 0; index < 1000; index += 1) globalThis.dispatchEvent(new Event("scroll"));
          return performance.now() - start;
        })(),
        heavyGlobalsBeforeTap: ["Defuddle", "Engine", "Extractor", "MobileViewer", "ReaderSession", "wasm_bindgen"]
          .filter((name) => typeof globalThis[name] !== "undefined"),
      };
    }, browserMetrics);
  } finally {
    await page.close();
  }
}

async function measurePage(browser, fixture) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    await page.goto(`${baseUrl}/tests/e2e/fixtures/performance.html`);
    await page.evaluate((runtimeBaseUrl) => {
      globalThis.browser = {
        runtime: {
          getURL(path) {
            return `${runtimeBaseUrl}/apps/ios/ReaderExtension/Resources/generated/${path}`;
          },
        },
      };
    }, baseUrl);
    for (const script of scripts) {
      await page.addScriptTag({
        path: script,
        type: script.endsWith("session-wasm-module.js") ? "module" : "text/javascript",
      });
    }
    await page.evaluate(({ nodeCount, extraction }) => {
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
      globalThis.MobileViewer.install();
    }, fixture);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const beforeOpenMetrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    const result = await page.evaluate(() => {
      const openPromise = globalThis.MobileViewer.open();
      return openPromise.then(() => {
        const mark = (name) => performance.getEntriesByName(name, "mark").at(-1)?.startTime;
        const tap = mark("reader:tap");
        const firstFeedback = mark("reader:first-feedback");
        const extractionStart = mark("reader:extraction-start");
        const extractionEnd = mark("reader:extraction-end");
        const firstRender = mark("reader:first-render");
        const firstUnit = mark("reader:first-unit");
        const sessionInitStart = mark("reader:session-init-start");
        const sessionInitEnd = mark("reader:session-init-end");
        const metrics = globalThis.__READER_PERFORMANCE_LAST_METRICS || {};
        const wasmRequestsBeforeTap = performance.getEntriesByType("resource")
          .filter((entry) => entry.name.endsWith("reader_session_bg.wasm"));
        return {
          bootstrapMs: 0,
          tapToFirstFeedbackMs: Math.max(0, (firstFeedback || tap || 0) - (tap || 0)),
          tapToFirstUnitMs: Math.max(0, (firstUnit || tap || 0) - (tap || 0)),
          sessionInitMs: Math.max(0, (sessionInitEnd || sessionInitStart || 0) - (sessionInitStart || 0)),
          wasmFetchedBeforeTap: wasmRequestsBeforeTap.some((entry) => entry.startTime < (tap || 0)),
          extractionMs: Math.max(0, (extractionEnd || extractionStart || 0) - (extractionStart || 0)),
          tapToFirstRenderMs: Math.max(0, (firstRender || tap || 0) - (tap || 0)),
          nodeCount: document.querySelectorAll("*").length,
          dominantArticleMs: metrics.dominantArticleMs || 0,
          defuddleMs: metrics.defuddleMs || 0,
          indexMs: metrics.indexMs || 0,
          contextMs: metrics.contextMs || 0,
        };
      });
      });
    await page.evaluate(() => globalThis.MobileViewer.close());
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const afterCloseMetrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    return {
      ...result,
      heapBeforeOpenBytes: beforeOpenMetrics.JSHeapUsedSize ?? null,
      retainedHeapAfterCloseBytes: afterCloseMetrics.JSHeapUsedSize ?? null,
      retainedHeapDeltaBytes: beforeOpenMetrics.JSHeapUsedSize === undefined || afterCloseMetrics.JSHeapUsedSize === undefined
        ? null
        : afterCloseMetrics.JSHeapUsedSize - beforeOpenMetrics.JSHeapUsedSize,
    };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const fixtureReports = {};
  for (const fixture of fixtures) {
    const runs = [];
    for (let run = 0; run < runsPerCase; run += 1) runs.push(await measurePage(browser, fixture));
    const median = medianReport(runs);
    const p50 = percentileReport(runs, 0.5);
    const p90 = percentileReport(runs, 0.9);
    const retainedHeap = retainedHeapReport(runs);
    fixtureReports[fixture.name] = { runs, median, p50, p90, retainedHeap, budget: budgetReport(fixture.name, p90, retainedHeap) };
  }

  const nodeReports = {};
  for (const nodeCount of nodeCounts) {
    const runs = [];
    for (let run = 0; run < runsPerCase; run += 1) {
      runs.push(await measurePage(browser, { name: `nodes-${nodeCount}`, nodeCount, extraction: "dominant" }));
    }
    const median = medianReport(runs);
    const p50 = percentileReport(runs, 0.5);
    const p90 = percentileReport(runs, 0.9);
    const retainedHeap = retainedHeapReport(runs);
    nodeReports[String(nodeCount)] = { runs, median, p50, p90, retainedHeap, budget: budgetReport(String(nodeCount), p90, retainedHeap) };
  }

  const passiveWithBootstrap = await measurePassivePage(browser);
  const passiveControl = await measurePassivePage(browser, true);
  const passive = {
    withBootstrap: passiveWithBootstrap,
    control: passiveControl,
    delta: Object.fromEntries(["passiveScriptTransferBytes", "passiveScriptDecodedBytes", "longTaskTotalMs", "scriptDurationMs", "taskDurationMs", "layoutDurationMs", "heapUsedBytes", "scrollDispatchMs"]
      .map((key) => [key, passiveWithBootstrap[key] === null || passiveControl[key] === null ? null : passiveWithBootstrap[key] - passiveControl[key]])),
  };
  const regressions = Object.entries(fixtureReports)
    .flatMap(([fixtureName, fixtureReport]) => Object.entries(fixtureReport.budget.metrics)
      .filter(([, metric]) => metric.regression)
      .map(([metricName]) => ({ fixture: fixtureName, metric: metricName })));
  const nodeRegressions = Object.entries(nodeReports)
    .flatMap(([nodeCount, nodeReport]) => Object.entries(nodeReport.budget.metrics)
      .filter(([, metric]) => metric.regression)
      .map(([metricName]) => ({ nodeCount, metric: metricName })));
  const passiveRegressions = [
    passiveWithBootstrap.bootstrapRequestCount !== 1 ? "bootstrap-request-count" : null,
    passiveWithBootstrap.heavyGlobalsBeforeTap.length > 0 ? "heavy-global-before-tap" : null,
    passiveWithBootstrap.bootstrapDecodedBytes > baseline.passive.bootstrapDecodedBytes * (1 + budgetMargin) ? "bootstrap-decoded-bytes" : null,
    passiveWithBootstrap.longTaskCount > baseline.passive.longTaskCount ? "passive-long-task" : null,
  ].filter(Boolean);
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runsPerCase,
    baseline,
    fixtures: fixtureReports,
    nodeBenchmarks: nodeReports,
    passive,
    regressions: [...regressions, ...nodeRegressions, ...passiveRegressions.map((metric) => ({ metric }))],
    ci: { status: regressions.length === 0 && nodeRegressions.length === 0 && passiveRegressions.length === 0 ? "pass" : "regression" },
  };
  await mkdir(resolve(repositoryRoot, "test-results/performance"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.env.READER_PERFORMANCE_ENFORCE === "1" && (regressions.length > 0 || nodeRegressions.length > 0 || passiveRegressions.length > 0)) {
    throw new Error(`Reader performance budget regression: ${JSON.stringify({ regressions, nodeRegressions, passiveRegressions })}`);
  }
  if (process.env.READER_PERFORMANCE_ENFORCE === "1" && runsPerCase < 10) {
    throw new Error(`Reader performance requires at least 10 runs; received ${runsPerCase}`);
  }
} finally {
  await browser.close();
  fixtureServer?.kill();
}
