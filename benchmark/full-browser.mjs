import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { buildPairedMemorySamples, evaluateFeedbackBudget, evaluateReactMemoryGate, evaluateReactMigrationGate, REACT_FIXED_HEAP_BUDGET_BYTES, summarizeMemorySamples } from "./budget.mjs";
import { clearPerformanceEntries } from "./entry-cleanup.mjs";
import { buildPerformanceSample, median, percentile } from "./sample.mjs";
import { assertDistinctCommits, selectPerformanceGroup } from "./full-groups.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(repositoryRoot, "test-results/performance/reader.json");
const webPort = Number(process.env.READER_PERFORMANCE_PORT) || 4173;
const baseUrl = `http://127.0.0.1:${webPort}`;
const generatedRoot = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated");
const baselineRoot = process.env.READER_PERFORMANCE_BASELINE_ROOT
  ? resolve(process.env.READER_PERFORMANCE_BASELINE_ROOT)
  : null;
const baselineCommit = process.env.READER_PERFORMANCE_BASE_COMMIT || null;
const candidateCommit = process.env.READER_PERFORMANCE_CANDIDATE_COMMIT || null;
const generatedPath = "/apps/ios/ReaderExtension/Resources/generated";
const baselineGeneratedRoot = baselineRoot ? resolve(baselineRoot, "apps/ios/ReaderExtension/Resources/generated") : null;
const runtimeScripts = (root) => ["session-wasm-module.js", "runtime.js", "defuddle.js", "engine.js", "extractor.js", "viewer.js"]
  .map((name) => resolve(root, name));
const scripts = runtimeScripts(generatedRoot);
const baselineScripts = baselineGeneratedRoot ? runtimeScripts(baselineGeneratedRoot) : null;
const bundleAssets = {
  chrome: [
    "apps/chrome/dist/runtime.js",
    "apps/chrome/dist/session-wasm.js",
    "apps/chrome/dist/reader_session_bg.wasm",
    "apps/chrome/dist/vendor/defuddle/defuddle.js",
    "apps/chrome/dist/engine.js",
    "apps/chrome/dist/extractor.js",
    "apps/chrome/dist/viewer.js",
  ],
  safari: [
    "apps/ios/ReaderExtension/Resources/generated/bootstrap.js",
    "apps/ios/ReaderExtension/Resources/generated/session-wasm-module.js",
    "apps/ios/ReaderExtension/Resources/generated/runtime.js",
    "apps/ios/ReaderExtension/Resources/generated/reader_session_bg.wasm",
    "apps/ios/ReaderExtension/Resources/generated/defuddle.js",
    "apps/ios/ReaderExtension/Resources/generated/engine.js",
    "apps/ios/ReaderExtension/Resources/generated/extractor.js",
    "apps/ios/ReaderExtension/Resources/generated/viewer.js",
  ],
};
const nodeCounts = [1000, 10_000, 50_000, 100_000];
const runsPerCase = Number(process.env.READER_PERFORMANCE_RUNS) || 10;
const cleanupCyclesPerCase = Number(process.env.READER_PERFORMANCE_CLEANUP_CYCLES) || 6;
const warmupRunsPerCase = process.env.READER_PERFORMANCE_WARMUP_RUNS === undefined
  ? (baselineRoot ? 2 : 0)
  : Number(process.env.READER_PERFORMANCE_WARMUP_RUNS);
const budgetMargin = 0.25;
const baseline = {
  source: "github-actions/macos-15 run 32590877670 artifact reader-performance-baseline",
  runs: 10,
  margin: budgetMargin,
  conditions: "Chromium headless, 390x844 viewport, 10 runs/case, main-equivalent product artifacts on GitHub Actions macos-15",
  fixtures: {
    "short-article": { tapToFirstUnitMs: 412.6, tapToFirstRenderMs: 413.1, tapToFirstFeedbackMs: 1.5, sessionInitMs: 4.3 },
    "long-article": { tapToFirstUnitMs: 1089.5, tapToFirstRenderMs: 1090.9, tapToFirstFeedbackMs: 5.9, sessionInitMs: 8.1 },
    "dominant-article": { tapToFirstUnitMs: 1068.4, tapToFirstRenderMs: 1069.8, tapToFirstFeedbackMs: 5.6, sessionInitMs: 7.9 },
    "defuddle-fallback": { tapToFirstUnitMs: 1101, tapToFirstRenderMs: 1102.4, tapToFirstFeedbackMs: 5.1, sessionInitMs: 7.8 },
  },
  nodeBenchmarks: {
    "1000": { tapToFirstUnitMs: 406.6, tapToFirstRenderMs: 407.2, tapToFirstFeedbackMs: 8.5, extractionMs: 152, sessionInitMs: 11.1 },
    "10000": { tapToFirstUnitMs: 1081.4, tapToFirstRenderMs: 1082.9, tapToFirstFeedbackMs: 5.9, extractionMs: 153.2, sessionInitMs: 8.0 },
    "50000": { tapToFirstUnitMs: 4313.3, tapToFirstRenderMs: 4318.9, tapToFirstFeedbackMs: 178, extractionMs: 178.1, sessionInitMs: 209.7 },
    "100000": { tapToFirstUnitMs: 11881.5, tapToFirstRenderMs: 11898.4, tapToFirstFeedbackMs: 53.1, extractionMs: 378.9, sessionInitMs: 160.9 },
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
    fixtures: { tapToFirstUnitMs: { "short-article": 289.5, "long-article": 834.2, "dominant-article": 831.9, "defuddle-fallback": 872.7 } },
    nodeBenchmarks: { tapToFirstUnitMs: { "1000": 292.7, "10000": 817.6, "50000": 3415.7, "100000": 6649.4 } },
  },
};
const fixtures = [
  { name: "short-article", nodeCount: 1000, extraction: "dominant" },
  { name: "long-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "dominant-article", nodeCount: 10_000, extraction: "dominant" },
  { name: "defuddle-fallback", nodeCount: 10_000, extraction: "fallback" },
];
const fixtureGroup = process.env.READER_PERFORMANCE_GROUP || "all";
const selectedGroup = selectPerformanceGroup(fixtureGroup, fixtures.map(({ name }) => name), nodeCounts);
const selectedFixtures = fixtures.filter((fixture) => selectedGroup.fixtures.includes(fixture.name));
const selectedNodeCounts = selectedGroup.nodeCounts;
const shouldMeasureCleanup = selectedGroup.cleanup;
const shouldMeasurePassive = selectedGroup.passive;

async function measureBundleBytes(root) {
  const result = { raw: {}, gzip9: {} };
  for (const [platform, assets] of Object.entries(bundleAssets)) {
    const buffers = await Promise.all(assets.map((asset) => readFile(resolve(root, asset))));
    result.raw[platform] = buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
    result.gzip9[platform] = buffers.reduce((total, buffer) => total + gzipSync(buffer, { level: 9 }).byteLength, 0);
  }
  for (const encoding of ["raw", "gzip9"]) {
    result[encoding].total = result[encoding].chrome + result[encoding].safari;
  }
  return result;
}

let fixtureServer = null;
try {
  await fetch(`${baseUrl}/tests/e2e/fixtures/performance.html`);
  } catch {
  fixtureServer = spawn(process.execPath, ["tests/e2e/server.mjs"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      READER_E2E_PORT: String(webPort),
      ...(baselineRoot ? { READER_E2E_BASELINE_ROOT: baselineRoot } : {}),
    },
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
if (baselineRoot) {
  const baselineBootstrap = await fetch(`${baseUrl}/__reader-baseline__/apps/ios/ReaderExtension/Resources/generated/bootstrap.js`);
  if (!baselineBootstrap.ok) throw new Error(`paired baseline assets are not served: ${baselineBootstrap.status}`);
}

function medianReport(runs) {
  const numericKeys = [
    "bootstrapMs",
    "tapToFirstFeedbackMs",
    "tapToFirstUnitMs",
    "sessionInitMs",
    "reactInitMs",
    "wasmInitMs",
    "initializationSpanMs",
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
    "reactInitMs",
    "wasmInitMs",
    "initializationSpanMs",
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

function pairedDeltaReport(baselineRuns, candidateRuns) {
  const numericKeys = [
    "tapToFirstFeedbackMs",
    "tapToFirstUnitMs",
    "sessionInitMs",
    "reactInitMs",
    "wasmInitMs",
    "initializationSpanMs",
    "extractionMs",
    "tapToFirstRenderMs",
    "retainedHeapDeltaBytes",
  ];
  const deltas = Object.fromEntries(numericKeys.map((key) => {
    const samples = candidateRuns.map((run, index) => {
      const candidate = run[key];
      const baseline = baselineRuns[index]?.[key];
      return Number.isFinite(candidate) && Number.isFinite(baseline) ? candidate - baseline : null;
    });
    return [key, { samples, p50: percentile(samples, 0.5), p90: percentile(samples, 0.9) }];
  }));
  return {
    baselineRuns,
    candidateRuns,
    deltas,
    pairedMemory: buildPairedMemorySamples(baselineRuns, candidateRuns, {
      requireBalanced: process.env.READER_PERFORMANCE_ENFORCE === "1",
    }),
  };
}

function budgetReport(fixtureName, p90, retainedHeap, pairedBaseline = null, pairedDelta = null, reactMemoryGate = null) {
  const fixtureBaseline = baseline.fixtures[fixtureName] || baseline.nodeBenchmarks[fixtureName];
  if (!fixtureBaseline) return { status: "not-applicable", metrics: {} };
  const referenceP90 = pairedBaseline?.p90 || fixtureBaseline;
  const metrics = Object.fromEntries(Object.entries(fixtureBaseline)
    .filter(([metric]) => [
      "tapToFirstUnitMs",
      "tapToFirstRenderMs",
      ...(baseline.nodeBenchmarks[fixtureName] ? ["extractionMs"] : ["tapToFirstFeedbackMs"]),
    ].includes(metric))
    .map(([metric]) => {
    const baselineP90 = referenceP90[metric];
    const feedbackBudget = metric === "tapToFirstFeedbackMs"
      ? evaluateFeedbackBudget({ observedP90: p90[metric], pairedP50DeltaMs: pairedDelta?.tapToFirstFeedbackMs?.p50 ?? null })
      : null;
    const budget = feedbackBudget?.absoluteBudgetMs ?? baselineP90 * (1 + budgetMargin);
    return [metric, {
      baselineP90,
      relativeBudget: baselineP90 * (1 + budgetMargin),
      budget,
      observedP90: p90[metric],
      increaseRate: (p90[metric] - baselineP90) / baselineP90,
      ...(feedbackBudget || {}),
      regression: feedbackBudget?.regression ?? p90[metric] > budget,
    }];
    }));
  const retainedBaseline = pairedBaseline?.retainedHeap?.p90Bytes ?? (baseline.nodeBenchmarks[fixtureName]
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
      regression: reactMemoryGate?.regression ?? observedP90 > budget,
      ...(reactMemoryGate ? { reactMemoryGate } : {}),
    };
  }
  return {
    status: Object.values(metrics).some((metric) => metric.regression) ? "regression" : "within-budget",
    metrics,
  };
}

async function measurePassivePage(browser, control = false, variant = "candidate") {
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
    const query = new URLSearchParams(control ? { "passive-control": "1" } : { passive: "1" });
    if (variant === "baseline") query.set("asset-root", "baseline");
    await page.goto(`${baseUrl}/tests/e2e/fixtures/safari-package-lazy-runtime.html?${query}`, { waitUntil: "load" });
    await page.waitForTimeout(200);
    const browserMetrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    return await page.evaluate((metrics) => {
      const scriptEntries = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/generated/"));
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

async function setupPerformancePage(browser, fixture, variant = "candidate") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(`${baseUrl}/tests/e2e/fixtures/performance.html`);
  const variantScripts = variant === "baseline" ? baselineScripts : scripts;
  if (!variantScripts) throw new Error("baseline generated assets are required for paired measurement");
  const runtimePrefix = variant === "baseline" ? `/__reader-baseline__${generatedPath}` : generatedPath;
  await page.evaluate((runtimeConfig) => {
    globalThis.browser = {
      runtime: {
        getURL(path) {
          return `${runtimeConfig.baseUrl}${runtimeConfig.runtimePrefix}/${path}`;
        },
      },
    };
  }, { baseUrl, runtimePrefix });
  for (const script of variantScripts) {
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
  return { page, cdp };
}

async function measurePerformanceCycle(page, cdp, settleMs = 0, {
  clearEntries = false,
  collectTimingSample = true,
  priorWasmFetchedBeforeTap = false,
} = {}) {
  if (clearEntries) {
    await page.evaluate(clearPerformanceEntries);
  }
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const beforeOpenMetrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const rawResult = await page.evaluate((priorWasmFetchedBeforeTap) => {
    const openPromise = globalThis.MobileViewer.open();
    return openPromise.then(() => {
      const mark = (name) => performance.getEntriesByName(name, "mark").at(-1)?.startTime;
      const marks = {
        tap: mark("reader:tap"),
        firstFeedback: mark("reader:first-feedback"),
        extractionStart: mark("reader:extraction-start"),
        extractionEnd: mark("reader:extraction-end"),
        firstRender: mark("reader:first-render"),
        firstUnit: mark("reader:first-unit"),
        sessionInitStart: mark("reader:session-init-start"),
        sessionInitEnd: mark("reader:session-init-end"),
        reactInitStart: mark("reader:react-init-start"),
        reactInitEnd: mark("reader:react-init-end"),
        wasmInitStart: mark("reader:wasm-init-start"),
        wasmInitEnd: mark("reader:wasm-init-end"),
      };
      const metrics = globalThis.__READER_PERFORMANCE_LAST_METRICS;
      const wasmRequestsBeforeTap = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith("reader_session_bg.wasm"));
      return {
        marks,
        metrics,
        wasmFetchedBeforeTap: priorWasmFetchedBeforeTap || wasmRequestsBeforeTap.some((entry) => entry.startTime < marks.tap),
        nodeCount: document.querySelectorAll("*").length,
      };
    }, priorWasmFetchedBeforeTap);
  });
  const result = collectTimingSample
    ? buildPerformanceSample(rawResult)
    : { wasmFetchedBeforeTap: rawResult.wasmFetchedBeforeTap };
  await page.evaluate(() => globalThis.MobileViewer.close());
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  await page.evaluate(clearPerformanceEntries);
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
}

async function measurePage(browser, fixture, variant = "candidate", { withCleanup = true } = {}) {
  const { page, cdp } = await setupPerformancePage(browser, fixture, variant);
  try {
    const first = await measurePerformanceCycle(page, cdp);
    if (!withCleanup) return first;
    const second = await measurePerformanceCycle(page, cdp, 500, {
      clearEntries: true,
      collectTimingSample: false,
      priorWasmFetchedBeforeTap: first.wasmFetchedBeforeTap,
    });
    return {
      ...first,
      cleanupCycles: cleanupCycleReport([first, second], 1),
    };
  } finally {
    await page.close();
  }
}

function cleanupCycleReport(runs, warmupCycles = 2) {
  const increments = runs.slice(warmupCycles).map((run) => run.retainedHeapDeltaBytes);
  return {
    cycles: runs.map((run, cycle) => ({ cycle, before: run.heapBeforeOpenBytes, after: run.retainedHeapAfterCloseBytes, delta: run.retainedHeapDeltaBytes })),
    warmupCycles,
    steadyIncrements: summarizeMemorySamples(increments),
  };
}

async function measureCleanupCycles(browser, fixture, variant, cycles = 8) {
  const { page, cdp } = await setupPerformancePage(browser, fixture, variant);
  try {
    const runs = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      runs.push(await measurePerformanceCycle(page, cdp, 500, {
        clearEntries: cycle > 0,
        collectTimingSample: cycle === 0,
        priorWasmFetchedBeforeTap: runs[0]?.wasmFetchedBeforeTap ?? false,
      }));
    }
    return cleanupCycleReport(runs, 1);
  } finally {
    await page.close();
  }
}

function combineRepresentativeTrajectories(trajectories) {
  const combineVariant = (variant) => {
    const reports = trajectories.map((trajectory) => trajectory[variant]);
    const cycleCount = Math.min(...reports.map((report) => report.cycles.length));
    const cycles = Array.from({ length: cycleCount }, (_, cycle) => {
      const samples = reports.map((report) => report.cycles[cycle]?.delta ?? null);
      const summary = summarizeMemorySamples(samples);
      return { cycle, samples, p50: summary.p50, p90: summary.p90, max: summary.max };
    });
    const steadyIncrements = summarizeMemorySamples(cycles.slice(2).flatMap((cycle) => cycle.samples));
    return { warmupCycles: 2, cycles, steadyIncrements };
  };
  const steadyDelta = summarizeMemorySamples(trajectories.flatMap((trajectory) => trajectory.candidate.cycles
    .slice(2)
    .map((candidateCycle, cycle) => {
      const baselineDelta = trajectory.baseline.cycles[cycle + 2]?.delta;
      return Number.isFinite(candidateCycle.delta) && Number.isFinite(baselineDelta)
        ? candidateCycle.delta - baselineDelta
        : null;
    })));
  return {
    executionOrders: trajectories.map((trajectory) => trajectory.executionOrder),
    baseline: combineVariant("baseline"),
    candidate: combineVariant("candidate"),
    steadyDelta,
  };
}

async function measureRepresentativeCleanup(browser, fixture, cycles) {
  const trajectories = [];
  for (const baselineFirst of [true, false]) {
    const executionOrder = baselineFirst ? "baseline-candidate" : "candidate-baseline";
    let baseline;
    let candidate;
    if (baselineFirst) {
      baseline = await measureCleanupCycles(browser, fixture, "baseline", cycles);
      candidate = await measureCleanupCycles(browser, fixture, "candidate", cycles);
    } else {
      candidate = await measureCleanupCycles(browser, fixture, "candidate", cycles);
      baseline = await measureCleanupCycles(browser, fixture, "baseline", cycles);
    }
    trajectories.push({ executionOrder, baseline, candidate });
  }
  return combineRepresentativeTrajectories(trajectories);
}

const browser = await chromium.launch({ headless: true });
try {
  if (process.env.READER_PERFORMANCE_ENFORCE === "1") {
    if (!baselineRoot) throw new Error("READER_PERFORMANCE_BASELINE_ROOT is required when enforcing paired performance budgets");
    assertDistinctCommits(baselineCommit, candidateCommit);
  }
  const fixtureReports = {};
  const pairedComparison = { fixtures: {}, nodeBenchmarks: {} };
  for (const fixture of selectedFixtures) {
    const baselineRuns = [];
    for (let warmup = 0; warmup < warmupRunsPerCase; warmup += 1) {
      const baselineFirst = warmup % 2 === 0;
      if (baselineRoot && baselineFirst) await measurePage(browser, fixture, "baseline", { withCleanup: false });
      await measurePage(browser, fixture, "candidate", { withCleanup: false });
      if (baselineRoot && !baselineFirst) await measurePage(browser, fixture, "baseline", { withCleanup: false });
    }
    const runs = [];
    for (let run = 0; run < runsPerCase; run += 1) {
      const baselineFirst = run % 2 === 0;
      const executionOrder = baselineFirst ? "baseline-candidate" : "candidate-baseline";
      if (baselineRoot && baselineFirst) {
        const baselineRun = await measurePage(browser, fixture, "baseline");
        baselineRun.executionOrder = executionOrder;
        baselineRuns.push(baselineRun);
      }
      const candidateRun = await measurePage(browser, fixture);
      candidateRun.executionOrder = executionOrder;
      runs.push(candidateRun);
      if (baselineRoot && !baselineFirst) {
        const baselineRun = await measurePage(browser, fixture, "baseline");
        baselineRun.executionOrder = executionOrder;
        baselineRuns.push(baselineRun);
      }
    }
    const median = medianReport(runs);
    const p50 = percentileReport(runs, 0.5);
    const p90 = percentileReport(runs, 0.9);
    const retainedHeap = retainedHeapReport(runs);
    const pairedBaseline = baselineRoot ? {
      p90: percentileReport(baselineRuns, 0.9),
      retainedHeap: retainedHeapReport(baselineRuns),
    } : null;
    const pairedDelta = baselineRoot ? pairedDeltaReport(baselineRuns, runs) : null;
    fixtureReports[fixture.name] = {
      runs,
      median,
      p50,
      p90,
      retainedHeap,
      budget: budgetReport(fixture.name, p90, retainedHeap, pairedBaseline, pairedDelta?.deltas),
    };
    if (baselineRoot) pairedComparison.fixtures[fixture.name] = pairedDelta;
  }

  const nodeReports = {};
  for (const nodeCount of selectedNodeCounts) {
    const fixture = { name: `nodes-${nodeCount}`, nodeCount, extraction: "dominant" };
    const baselineRuns = [];
    for (let warmup = 0; warmup < warmupRunsPerCase; warmup += 1) {
      const baselineFirst = warmup % 2 === 0;
      if (baselineRoot && baselineFirst) await measurePage(browser, fixture, "baseline", { withCleanup: false });
      await measurePage(browser, fixture, "candidate", { withCleanup: false });
      if (baselineRoot && !baselineFirst) await measurePage(browser, fixture, "baseline", { withCleanup: false });
    }
    const runs = [];
    for (let run = 0; run < runsPerCase; run += 1) {
      const baselineFirst = run % 2 === 0;
      const executionOrder = baselineFirst ? "baseline-candidate" : "candidate-baseline";
      if (baselineRoot && baselineFirst) {
        const baselineRun = await measurePage(browser, fixture, "baseline");
        baselineRun.executionOrder = executionOrder;
        baselineRuns.push(baselineRun);
      }
      const candidateRun = await measurePage(browser, fixture);
      candidateRun.executionOrder = executionOrder;
      runs.push(candidateRun);
      if (baselineRoot && !baselineFirst) {
        const baselineRun = await measurePage(browser, fixture, "baseline");
        baselineRun.executionOrder = executionOrder;
        baselineRuns.push(baselineRun);
      }
    }
    const median = medianReport(runs);
    const p50 = percentileReport(runs, 0.5);
    const p90 = percentileReport(runs, 0.9);
    const retainedHeap = retainedHeapReport(runs);
    const pairedBaseline = baselineRoot ? {
      p90: percentileReport(baselineRuns, 0.9),
      retainedHeap: retainedHeapReport(baselineRuns),
    } : null;
    const pairedDelta = baselineRoot ? pairedDeltaReport(baselineRuns, runs) : null;
    nodeReports[String(nodeCount)] = {
      runs,
      median,
      p50,
      p90,
      retainedHeap,
      budget: budgetReport(String(nodeCount), p90, retainedHeap, pairedBaseline, pairedDelta?.deltas),
    };
    if (baselineRoot) pairedComparison.nodeBenchmarks[String(nodeCount)] = pairedDelta;
  }

  const cleanupCycles = {};
  let fixedOverheadSummary = null;
  let secondRootOverheadSummary = null;
  if (baselineRoot && shouldMeasureCleanup) {
    const representativeFixtures = [
      ...(selectedFixtures[0] ? [selectedFixtures[0]] : []),
      ...(selectedNodeCounts.length > 0
        ? [{ name: `nodes-${selectedNodeCounts.at(-1)}`, nodeCount: selectedNodeCounts.at(-1), extraction: "dominant" }]
        : []),
    ];
    for (const fixture of representativeFixtures) {
      cleanupCycles[fixture.name] = await measureRepresentativeCleanup(browser, fixture, cleanupCyclesPerCase);
    }
    const pairedMemoryReports = [
      ...Object.values(pairedComparison.fixtures),
      ...Object.values(pairedComparison.nodeBenchmarks),
    ].map((comparison) => comparison.pairedMemory).filter(Boolean);
    fixedOverheadSummary = summarizeMemorySamples(pairedMemoryReports.flatMap((memory) => memory.fixedOverhead.samples));
    secondRootOverheadSummary = summarizeMemorySamples(pairedMemoryReports.flatMap((memory) => memory.steadyDelta.samples));
  }

  if (baselineRoot) {
    for (const { name, report, baselineRuns } of [
      ...Object.entries(fixtureReports).map(([name, report]) => ({ name, report, baselineRuns: pairedComparison.fixtures[name]?.baselineRuns })),
      ...Object.entries(nodeReports).map(([name, report]) => ({ name, report, baselineRuns: pairedComparison.nodeBenchmarks[name]?.baselineRuns })),
    ]) {
      const baselineReport = baselineRuns;
      const baselineP90Bytes = baselineReport ? retainedHeapReport(baselineReport).p90Bytes : null;
      const pairedMemory = pairedComparison.fixtures[name]?.pairedMemory || pairedComparison.nodeBenchmarks[name]?.pairedMemory || null;
      const reactMemoryGate = evaluateReactMemoryGate({
        candidateP90Bytes: report.retainedHeap.p90Bytes,
        baselineP90Bytes,
        pairedMemory,
        representativeCleanup: cleanupCycles[name] || cleanupCycles[`nodes-${name}`] || null,
      });
      const retainedMetric = report.budget.metrics.retainedHeapDeltaBytes;
      if (retainedMetric) {
        retainedMetric.budget = reactMemoryGate.combinedBudgetBytes ?? retainedMetric.budget;
        retainedMetric.regression = reactMemoryGate.regression;
        retainedMetric.reactMemoryGate = reactMemoryGate;
      }
      report.budget.status = Object.values(report.budget.metrics).some((metric) => metric.regression)
        ? "regression"
        : "within-budget";
    }
  }

  const initializationReports = [
    ...Object.entries(fixtureReports).map(([name, report]) => ({
      name: `fixture:${name}`,
      candidate: report.p90,
      baseline: baselineRoot ? percentileReport(pairedComparison.fixtures[name].baselineRuns, 0.9) : null,
    })),
    ...Object.entries(nodeReports).map(([name, report]) => ({
      name: `nodes:${name}`,
      candidate: report.p90,
      baseline: baselineRoot ? percentileReport(pairedComparison.nodeBenchmarks[name].baselineRuns, 0.9) : null,
    })),
  ];
  const bundleBytes = await measureBundleBytes(repositoryRoot);
  const baselineBundleBytes = baselineRoot ? await measureBundleBytes(baselineRoot) : null;
  const reactMigration = evaluateReactMigrationGate({
    candidateBundle: bundleBytes,
    baselineBundle: baselineBundleBytes,
    initializationReports,
  });

  const passiveBaseline = baselineRoot && shouldMeasurePassive ? await measurePassivePage(browser, false, "baseline") : null;
  const passiveWithBootstrap = shouldMeasurePassive ? await measurePassivePage(browser) : null;
  const passiveControl = shouldMeasurePassive ? await measurePassivePage(browser, true) : null;
  const passive = passiveWithBootstrap && passiveControl ? {
    withBootstrap: passiveWithBootstrap,
    control: passiveControl,
    delta: Object.fromEntries(["passiveScriptTransferBytes", "passiveScriptDecodedBytes", "longTaskTotalMs", "scriptDurationMs", "taskDurationMs", "layoutDurationMs", "heapUsedBytes", "scrollDispatchMs"]
      .map((key) => [key, passiveWithBootstrap[key] === null || passiveControl[key] === null ? null : passiveWithBootstrap[key] - passiveControl[key]])),
  } : null;
  if (baselineRoot && shouldMeasurePassive && passiveBaseline && passiveWithBootstrap) {
    pairedComparison.passive = {
      baseline: passiveBaseline,
      candidate: passiveWithBootstrap,
      delta: Object.fromEntries(["passiveScriptTransferBytes", "passiveScriptDecodedBytes", "longTaskTotalMs", "scriptDurationMs", "taskDurationMs", "layoutDurationMs", "heapUsedBytes", "scrollDispatchMs"]
        .map((key) => [key, passiveWithBootstrap[key] === null || passiveBaseline[key] === null ? null : passiveWithBootstrap[key] - passiveBaseline[key]])),
    };
  }
  const regressions = Object.entries(fixtureReports)
    .flatMap(([fixtureName, fixtureReport]) => Object.entries(fixtureReport.budget.metrics)
      .filter(([, metric]) => metric.regression)
      .map(([metricName]) => ({ fixture: fixtureName, metric: metricName })));
  const nodeRegressions = Object.entries(nodeReports)
    .flatMap(([nodeCount, nodeReport]) => Object.entries(nodeReport.budget.metrics)
      .filter(([, metric]) => metric.regression)
      .map(([metricName]) => ({ nodeCount, metric: metricName })));
  const passiveRegressions = passiveWithBootstrap ? [
    passiveWithBootstrap.bootstrapRequestCount !== 1 ? "bootstrap-request-count" : null,
    passiveWithBootstrap.heavyGlobalsBeforeTap.length > 0 ? "heavy-global-before-tap" : null,
    passiveWithBootstrap.bootstrapDecodedBytes > (passiveBaseline?.bootstrapDecodedBytes ?? baseline.passive.bootstrapDecodedBytes) * (1 + budgetMargin) ? "bootstrap-decoded-bytes" : null,
    passiveWithBootstrap.longTaskCount > (passiveBaseline?.longTaskCount ?? baseline.passive.longTaskCount) ? "passive-long-task" : null,
  ].filter(Boolean) : [];
  const reactRegressions = reactMigration.failures.map((reason) => ({ metric: `react:${reason}` }));
  const allRegressions = [
    ...regressions,
    ...nodeRegressions,
    ...passiveRegressions.map((metric) => ({ metric })),
    ...reactRegressions,
  ];
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    fixtureGroup,
    runsPerCase,
    warmupRunsPerCase,
    baseline: baselineRoot ? {
      mode: "paired",
      baseCommit: process.env.READER_PERFORMANCE_BASE_COMMIT || "unknown",
      candidateCommit: process.env.READER_PERFORMANCE_CANDIDATE_COMMIT || "unknown",
      runs: runsPerCase,
      warmupRunsPerCase,
      margin: budgetMargin,
      conditions: "Chromium headless, 390x844 viewport, base/candidate paired in one browser process",
    } : baseline,
    fixtures: fixtureReports,
    nodeBenchmarks: nodeReports,
    bundleBytes,
    reactMigration,
    reactMemory: {
      fixedOverheadBytes: fixedOverheadSummary?.p90 ?? null,
      fixedOverhead: fixedOverheadSummary,
      firstRootFixedOverheadBytes: fixedOverheadSummary?.p90 ?? null,
      firstRootFixedOverhead: fixedOverheadSummary,
      secondRootOverheadBytes: secondRootOverheadSummary?.p90 ?? null,
      secondRootOverhead: secondRootOverheadSummary,
      combinedFixedOverheadBytes: fixedOverheadSummary && secondRootOverheadSummary
        ? fixedOverheadSummary.p90 + secondRootOverheadSummary.p90
        : null,
      fixedOverheadBudgetBytes: REACT_FIXED_HEAP_BUDGET_BYTES,
      cleanupCyclesPerCase: baselineRoot ? cleanupCyclesPerCase : null,
      representativeCases: Object.keys(cleanupCycles),
    },
    cleanupCycles,
    passive,
    pairedComparison: baselineRoot ? pairedComparison : null,
    regressions: allRegressions,
    ci: { status: allRegressions.length === 0 ? "pass" : "regression" },
  };
  await mkdir(resolve(repositoryRoot, "test-results/performance"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.env.READER_PERFORMANCE_ENFORCE === "1" && allRegressions.length > 0) {
    throw new Error(`Reader performance budget regression: ${JSON.stringify(allRegressions)}`);
  }
  if (process.env.READER_PERFORMANCE_ENFORCE === "1" && runsPerCase < 10) {
    throw new Error(`Reader performance requires at least 10 runs; received ${runsPerCase}`);
  }
} finally {
  await browser.close();
  fixtureServer?.kill();
}
