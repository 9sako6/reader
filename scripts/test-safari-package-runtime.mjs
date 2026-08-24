import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { webkit } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const webPort = Number(process.env.READER_SAFARI_SMOKE_PORT) || 4174;
let driverPort = Number(process.env.READER_SAFARI_DRIVER_PORT) || 0;
const baseUrl = `http://127.0.0.1:${webPort}`;
const pageUrl = `${baseUrl}/tests/e2e/fixtures/safari-package-runtime.html`;
const lazyPageUrl = `${baseUrl}/tests/e2e/fixtures/safari-package-lazy-runtime.html`;
const generatedRoot = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated");
const manifestPath = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/manifest.json");
let fixtureServer = null;
let safariDriver = null;
let sessionId = null;

class SafariWebDriverUnavailableError extends Error {}

async function waitFor(url, predicate = (response) => response.status === 200) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (predicate(response)) return response;
    } catch {}
    await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 50));
  }
  throw new Error(`service did not become ready: ${url}`);
}

function freshPageUrl() {
  const url = new URL(pageUrl);
  url.searchParams.set("runtime", `${Date.now()}-${process.pid}`);
  return url.href;
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function driverRequest(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload.value;
}

async function executeScript(script, args = []) {
  return driverRequest("POST", `/session/${sessionId}/execute/async`, { script, args });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyPackage() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: [
      "defuddle.js",
      "runtime.js",
      "session-wasm.js",
      "reader_session_bg.wasm",
    ],
    matches: ["<all_urls>"],
  }]);
  assert.deepEqual(manifest.content_scripts[0].js, ["bootstrap.js"]);
  const requiredAssets = [
    ...new Set([
      ...manifest.content_scripts.flatMap((contentScript) => contentScript.js),
      ...manifest.web_accessible_resources.flatMap((resource) => resource.resources),
      "reader-session-dependencies.txt",
    ]),
  ];
  const generatedBootstrap = await readFile(join(generatedRoot, "bootstrap.js"), "utf8");
  assert.equal(generatedBootstrap.includes("require("), false);
  assert.match(generatedBootstrap, /=>import\(/);
  assert.match(generatedBootstrap, /reader-bootstrap-progress/u);
  const generatedSession = await readFile(join(generatedRoot, "runtime.js"), "utf8");
  assert.equal(generatedSession.includes("require("), false);
  assert.match(generatedSession, /ReaderView/u);
  assert.match(generatedSession, /createRoot/u);
  const generatedAssets = new Map();
  for (const asset of requiredAssets) {
    const bytes = await readFile(join(generatedRoot, asset));
    generatedAssets.set(asset, bytes);
  }
  const wasmResponse = await fetch(`${baseUrl}/apps/ios/ReaderExtension/Resources/generated/reader_session_bg.wasm`);
  assert.equal(wasmResponse.status, 200);
  assert.equal(wasmResponse.headers.get("content-type"), "application/wasm");
  await WebAssembly.compile(await wasmResponse.arrayBuffer());
  const bundleRoot = process.env.READER_IOS_EXTENSION_BUNDLE
    ? resolve(process.env.READER_IOS_EXTENSION_BUNDLE)
    : resolve(repositoryRoot, "DerivedData/Build/Products/Debug-iphonesimulator/reader-extension.appex");
  try {
    await stat(bundleRoot);
  } catch (error) {
    if (process.env.READER_REQUIRE_IOS_EXTENSION_BUNDLE === "1") throw error;
    return;
  }
  const sourceManifestBytes = await readFile(manifestPath);
  const packagedManifestBytes = await readFile(join(bundleRoot, "manifest.json"));
  assert.equal(sha256(packagedManifestBytes), sha256(sourceManifestBytes));
  const packagedManifest = JSON.parse(packagedManifestBytes.toString("utf8"));
  assert.deepEqual(packagedManifest.web_accessible_resources, manifest.web_accessible_resources);
  for (const asset of requiredAssets) {
    const packagedBytes = await readFile(join(bundleRoot, asset));
    const generatedBytes = generatedAssets.get(asset);
    assert.equal(sha256(packagedBytes), sha256(generatedBytes), `${asset} package hash differs from generated asset`);
    assert.equal(Buffer.compare(packagedBytes, generatedBytes), 0, `${asset} package bytes differ from generated asset`);
  }
}

async function verifySafariRuntime() {
  safariDriver = spawn("safaridriver", ["--port", String(driverPort)], {
    stdio: "ignore",
  });
  try {
    await waitFor(`http://127.0.0.1:${driverPort}/status`, (response) => response.status === 200);
  } catch (error) {
    throw new SafariWebDriverUnavailableError(error.message);
  }
  let created;
  try {
    created = await driverRequest("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "safari" } },
    });
  } catch (error) {
    if (/session not created|remote automation|not reachable|connection refused/i.test(error.message)) {
      throw new SafariWebDriverUnavailableError(error.message);
    }
    throw error;
  }
  if (typeof created?.sessionId !== "string") {
    throw new Error(`Safari WebDriver returned an invalid session: ${JSON.stringify(created)}`);
  }
  sessionId = created.sessionId;
  await driverRequest("POST", `/session/${sessionId}/url`, { url: freshPageUrl() });
  const result = await executeScript(`
    const done = arguments[arguments.length - 1];
    const dependencyDeadline = Date.now() + 10000;
    function openWhenRuntimeIsReady() {
      if (typeof globalThis.MobileViewer?.open !== "function"
        || typeof globalThis.ReaderSession?.create !== "function") {
        if (Date.now() >= dependencyDeadline) {
          done({ error: "generated runtime dependencies did not become ready", mobileViewer: typeof globalThis.MobileViewer, readerSession: typeof globalThis.ReaderSession });
          return;
        }
        setTimeout(openWhenRuntimeIsReady, 16);
        return;
      }
      globalThis.MobileViewer.close();
      const originalCreate = globalThis.ReaderSession.create;
      let createCount = 0;
      let sessionHandle;
      const wasmResponses = [];
      globalThis.ReaderSession.create = (...args) => {
        createCount += 1;
        sessionHandle = originalCreate(...args);
        return sessionHandle;
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => originalFetch(...args).then((response) => {
        if (String(args[0]).includes("reader_session_bg.wasm")) {
          wasmResponses.push({ status: response.status, contentType: response.headers.get("content-type") });
        }
        return response;
      });
      const unitDeadline = Date.now() + 10000;
      function finishWhenRuntimeIsReady() {
      const host = document.getElementById("__reader-host");
      const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
      const initialized = Boolean(sessionHandle?.state);
      const unitText = unit?.textContent?.trim() || "";
      const wasmReady = wasmResponses.some(({ status, contentType }) => status === 200 && contentType === "application/wasm");
      if (initialized && createCount === 1 && wasmReady && unitText) {
        done({
          initialized,
          createCount,
          wasmResponses,
          host: Boolean(host),
          unit: true,
          unitText,
        });
        return;
      }
      if (Date.now() >= unitDeadline) {
        done({
          error: "ReaderSession and first reader unit did not become ready together",
          initialized,
          createCount,
          wasmResponses,
          host: Boolean(host),
          unit: Boolean(unit),
          unitText,
        });
        return;
      }
      setTimeout(finishWhenRuntimeIsReady, 16);
    }
      globalThis.MobileViewer.open().then(finishWhenRuntimeIsReady).catch((error) => done({ error: String(error) }));
    }
    openWhenRuntimeIsReady();
  `);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.initialized, true);
  assert.equal(result.createCount, 1);
  assert.deepEqual(result.wasmResponses, [{ status: 200, contentType: "application/wasm" }]);
  assert.equal(result.host, true);
  assert.equal(result.unit, true);
  assert.notEqual(result.unitText, "");
}

async function verifyGeneratedRuntimeInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(freshPageUrl(), { waitUntil: "load" });
    const result = await page.evaluate(async () => {
      globalThis.MobileViewer.close();
      const originalCreate = globalThis.ReaderSession.create;
      let createCount = 0;
      let sessionHandle;
      const wasmResponses = [];
      globalThis.ReaderSession.create = (...args) => {
        createCount += 1;
        sessionHandle = originalCreate(...args);
        return sessionHandle;
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => originalFetch(...args).then((response) => {
        if (String(args[0]).endsWith("reader_session_bg.wasm")) {
          wasmResponses.push({ status: response.status, contentType: response.headers.get("content-type") });
        }
        return response;
      });
      await globalThis.MobileViewer.open();
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 3000;
        const poll = () => {
          const host = document.getElementById("__reader-host");
          const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
          const initialized = Boolean(sessionHandle?.state);
          const unitText = unit?.textContent?.trim() || "";
          const wasmReady = wasmResponses.some(({ status, contentType }) => status === 200 && contentType === "application/wasm");
          if (initialized && createCount === 1 && wasmReady && unitText) {
            resolve();
            return;
          }
          if (performance.now() >= deadline) {
            reject(new Error(JSON.stringify({
              error: "ReaderSession and first reader unit did not become ready together",
              initialized,
              createCount,
              wasmResponses,
              host: Boolean(host),
              unit: Boolean(unit),
              unitText,
            })));
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
      const host = document.getElementById("__reader-host");
      return {
        initialized: Boolean(sessionHandle?.state),
        createCount,
        wasmResponses,
        host: Boolean(host),
        unit: Boolean(host?.shadowRoot?.querySelector('[data-reader-unit="true"]')),
        unitText: host?.shadowRoot?.querySelector('[data-reader-unit="true"]')?.textContent?.trim() || "",
      };
    });
    assert.equal(result.initialized, true);
    assert.equal(result.createCount, 1);
    assert.deepEqual(result.wasmResponses, [{ status: 200, contentType: "application/wasm" }]);
    assert.equal(result.host, true);
    assert.equal(result.unit, true);
    assert.notEqual(result.unitText, "");
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const assetRequests = new Map();
    page.on("request", (request) => {
      const asset = new URL(request.url()).pathname.match(/generated\/([^/]+)$/)?.[1];
      if (asset) assetRequests.set(asset, (assetRequests.get(asset) || 0) + 1);
    });
    await page.goto(`${lazyPageUrl}?runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    const passiveState = await page.evaluate(() => ({
      defuddle: typeof globalThis.Defuddle,
      engine: typeof globalThis.Engine,
      extractor: typeof globalThis.Extractor,
      mobileViewer: typeof globalThis.MobileViewer,
      readerSession: typeof globalThis.ReaderSession,
      wasm: typeof globalThis.wasm_bindgen,
      bootstrapHost: Boolean(document.getElementById("__reader-bootstrap")),
      entryStyle: (() => {
        const entry = document.getElementById("__reader-bootstrap")?.shadowRoot?.querySelector(".handle");
        if (!entry) return null;
        const style = getComputedStyle(entry, "::after");
        return { opacity: style.opacity, transitionDuration: style.transitionDuration, touchAction: getComputedStyle(entry).touchAction };
      })(),
    }));
    assert.deepEqual(passiveState, {
      defuddle: "undefined",
      engine: "undefined",
      extractor: "undefined",
      mobileViewer: "undefined",
      readerSession: "undefined",
      wasm: "undefined",
      bootstrapHost: true,
      entryStyle: { opacity: "0.82", transitionDuration: "0.16s, 0.16s", touchAction: "manipulation" },
    });
    for (const asset of ["defuddle.js", "runtime.js", "session-wasm.js", "reader_session_bg.wasm"]) {
      assert.equal(assetRequests.get(asset) || 0, 0, `${asset} must not load before tap`);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    assert.equal(await page.evaluate(() => document.getElementById("__reader-bootstrap")?.shadowRoot?.querySelector(".handle")?.classList.contains("scrolling")), true);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.getElementById("__reader-bootstrap")?.shadowRoot?.querySelector(".handle")?.classList.contains("scrolling")), false);
    await page.locator("#__reader-bootstrap").getByRole("button", { name: "readerで読む" }).click();
    const result = await page.evaluate(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const host = document.getElementById("__reader-host");
        const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
        if (typeof globalThis.ReaderSession?.create === "function" && unit?.textContent?.trim()) {
          return { unitText: unit.textContent.trim(), initialized: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        initialized: typeof globalThis.ReaderSession?.create === "function",
        unitText: document.getElementById("__reader-host")?.shadowRoot?.querySelector('[data-reader-unit="true"]')?.textContent?.trim() || "",
      };
    });
    assert.equal(result.initialized, true);
    assert.notEqual(result.unitText, "");
    for (const asset of ["defuddle.js", "runtime.js", "session-wasm.js", "reader_session_bg.wasm"]) {
      assert.equal(assetRequests.get(asset), 1, `${asset} should load once`);
    }
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeSingleFlightInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const assetRequests = new Map();
    page.on("request", (request) => {
      const asset = new URL(request.url()).pathname.match(/generated\/([^/]+)$/)?.[1];
      if (asset) assetRequests.set(asset, (assetRequests.get(asset) || 0) + 1);
    });
    await page.goto(`${lazyPageUrl}?runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    await page.locator("#__reader-bootstrap").getByRole("button", { name: "readerで読む" }).evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const result = await page.evaluate(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const host = document.getElementById("__reader-host");
        const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
        if (typeof globalThis.ReaderSession?.create === "function" && unit?.textContent?.trim()) {
          return {
            initialized: true,
            hostCount: document.querySelectorAll("#__reader-host").length,
            unitText: unit.textContent.trim(),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        initialized: typeof globalThis.ReaderSession?.create === "function",
        hostCount: document.querySelectorAll("#__reader-host").length,
        unitText: "",
      };
    });
    assert.equal(result.initialized, true, JSON.stringify(result));
    assert.equal(result.hostCount, 1);
    assert.notEqual(result.unitText, "");
    for (const asset of ["defuddle.js", "runtime.js", "session-wasm.js", "reader_session_bg.wasm"]) {
      assert.equal(assetRequests.get(asset), 1, `${asset} must be imported once for repeated taps`);
    }
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeFeedbackBoundariesInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${lazyPageUrl}?boundary=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    await page.locator("#__reader-bootstrap").getByRole("button", { name: "readerで読む" }).evaluate((button) => button.click());
    const readFeedbackState = () => page.evaluate(() => {
      const root = document.getElementById("__reader-bootstrap")?.shadowRoot;
      return {
        feedbackHidden: root?.querySelector(".feedback")?.hidden ?? null,
        barHidden: root?.querySelector(".bar")?.hidden ?? null,
        status: root?.querySelector('[role="status"]')?.textContent ?? null,
        cancelPresent: Boolean([...root?.querySelectorAll(".actions button") || []].some((button) => button.textContent === "キャンセル")),
        handleHidden: root?.querySelector(".handle")?.hidden ?? null,
        handleLoading: root?.querySelector(".handle")?.classList.contains("loading") ?? null,
      };
    });
    assert.deepEqual(await readFeedbackState(), {
      feedbackHidden: true,
      barHidden: true,
      status: "",
      cancelPresent: false,
      handleHidden: false,
      handleLoading: true,
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await readFeedbackState(), {
      feedbackHidden: true,
      barHidden: true,
      status: "",
      cancelPresent: false,
      handleHidden: false,
      handleLoading: true,
    });
    await page.waitForTimeout(100);
    assert.deepEqual(await readFeedbackState(), {
      feedbackHidden: false,
      barHidden: false,
      status: "",
      cancelPresent: false,
      handleHidden: true,
      handleLoading: true,
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await readFeedbackState(), {
      feedbackHidden: false,
      barHidden: false,
      status: "",
      cancelPresent: false,
      handleHidden: true,
      handleLoading: true,
    });
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeNavigationInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${lazyPageUrl}?slow=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    await page.locator("#__reader-bootstrap").getByRole("button", { name: "readerで読む" }).evaluate((button) => button.click());
    await page.goto(`${lazyPageUrl}?runtime=navigation-target-${Date.now()}-${process.pid}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      bootstrapHost: Boolean(document.getElementById("__reader-bootstrap")),
      readerHost: Boolean(document.getElementById("__reader-host")),
      mobileViewer: typeof globalThis.MobileViewer,
      readerSession: typeof globalThis.ReaderSession,
    }));
    assert.deepEqual(state, {
      bootstrapHost: true,
      readerHost: false,
      mobileViewer: "undefined",
      readerSession: "undefined",
    });
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeRetryInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${lazyPageUrl}?retry=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    const requestedAssets = new Map();
    page.on("request", (request) => {
      const asset = new URL(request.url()).pathname.match(/generated\/([^/]+)$/)?.[1];
      if (asset) requestedAssets.set(asset, (requestedAssets.get(asset) || 0) + 1);
    });
    const bootstrap = page.locator("#__reader-bootstrap");
    await bootstrap.getByRole("button", { name: "readerで読む" }).click();
    await bootstrap.getByRole("button", { name: "再試行" }).waitFor();
    await bootstrap.getByRole("button", { name: "再試行" }).click();
    const result = await page.evaluate(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const host = document.getElementById("__reader-host");
        const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
        if (typeof globalThis.ReaderSession?.create === "function" && unit?.textContent?.trim()) {
          return { initialized: true, unitText: unit.textContent.trim() };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        initialized: typeof globalThis.ReaderSession?.create === "function",
        unitText: "",
        mobileViewer: typeof globalThis.MobileViewer,
        readerSession: typeof globalThis.ReaderSession,
        host: Boolean(document.getElementById("__reader-host")),
      };
    });
    assert.equal(result.initialized, true, JSON.stringify({ ...result, requestedAssets: Object.fromEntries(requestedAssets), pageErrors }));
    assert.notEqual(result.unitText, "");
    for (const asset of ["defuddle.js", "runtime.js"]) {
      assert.equal(requestedAssets.get(asset), 2, `${asset} should reload after the intermediate failure`);
    }
    for (const asset of ["session-wasm.js", "reader_session_bg.wasm"]) {
      assert.equal(requestedAssets.get(asset), 1, `${asset} should load once after retry`);
    }
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeHandoffProgressInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${lazyPageUrl}?slow-extraction=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    const bootstrap = page.locator("#__reader-bootstrap");
    await bootstrap.getByRole("button", { name: "readerで読む" }).click();
    const reader = page.locator("#__reader-host");
    await reader.locator(".launch-progress-track").waitFor();
    assert.equal(await reader.locator(".launch-status").count(), 0);
    assert.equal(await reader.locator(".launch-cancel").count(), 0);
    await reader.locator('[data-reader-unit="true"]').waitFor();
    const state = await page.evaluate(() => {
      const host = document.getElementById("__reader-host");
      return {
        bootstrapHost: Boolean(document.getElementById("__reader-bootstrap")),
        readerHost: Boolean(host),
        readerOverlay: Boolean(host?.shadowRoot?.querySelector(".reader")),
      };
    });
    assert.deepEqual(state, { bootstrapHost: false, readerHost: true, readerOverlay: true });
  } finally {
    await browser.close();
  }
}

try {
  if (driverPort === 0) driverPort = await findFreePort();
  fixtureServer = spawn(process.execPath, ["tests/e2e/server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, READER_E2E_PORT: String(webPort) },
    stdio: "ignore",
  });
  await waitFor(pageUrl);
  await verifyPackage();
  await verifyGeneratedRuntimeInWebKit();
  await verifyGeneratedLazyRuntimeInWebKit();
  await verifyGeneratedLazyRuntimeSingleFlightInWebKit();
  await verifyGeneratedLazyRuntimeFeedbackBoundariesInWebKit();
  await verifyGeneratedLazyRuntimeNavigationInWebKit();
  await verifyGeneratedLazyRuntimeRetryInWebKit();
  await verifyGeneratedLazyRuntimeHandoffProgressInWebKit();
  process.stdout.write("Generated Safari resources initialized ReaderSession in WebKit\n");
  try {
    await verifySafariRuntime();
    process.stdout.write("Safari WebDriver runtime smoke passed\n");
  } catch (error) {
    if (process.env.READER_SAFARI_WEBDRIVER_REQUIRED === "1" || !(error instanceof SafariWebDriverUnavailableError)) {
      throw error;
    }
    process.stdout.write(`Safari WebDriver runtime unavailable; package runtime verification passed: ${error.message}\n`);
  }
} finally {
  if (sessionId) {
    try {
      await driverRequest("DELETE", `/session/${sessionId}`);
    } catch {}
  }
  safariDriver?.kill();
  fixtureServer?.kill();
}
