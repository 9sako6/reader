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
      "session-wasm-module.js",
      "session.js",
      "engine.js",
      "extractor.js",
      "icons.js",
      "viewer.js",
      "reader_session_bg.wasm",
    ],
    matches: ["<all_urls>"],
  }]);
  assert.deepEqual(manifest.content_scripts[0].js, ["bootstrap.js"]);
  const requiredAssets = [
    ...new Set([
      ...manifest.content_scripts.flatMap((contentScript) => contentScript.js),
      ...manifest.web_accessible_resources.flatMap((resource) => resource.resources),
    ]),
  ];
  const generatedBootstrap = await readFile(join(generatedRoot, "bootstrap.js"), "utf8");
  assert.equal(generatedBootstrap.includes("require("), false);
  assert.match(generatedBootstrap, /import\(runtimeURL\)/);
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
    globalThis.MobileViewer.close();
    const originalInit = globalThis.ReaderSession.init;
    const originalCreate = globalThis.ReaderSession.create;
    let initCount = 0;
    let createCount = 0;
    const wasmResponses = [];
    globalThis.ReaderSession.init = (...args) => {
      initCount += 1;
      return originalInit(...args);
    };
    globalThis.ReaderSession.create = (...args) => {
      createCount += 1;
      return originalCreate(...args);
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => originalFetch(...args).then((response) => {
      if (String(args[0]).endsWith("reader_session_bg.wasm")) {
        wasmResponses.push({ status: response.status, contentType: response.headers.get("content-type") });
      }
      return response;
    });
    const unitDeadline = Date.now() + 5000;
    function finishWhenRuntimeIsReady() {
      const host = document.getElementById("__reader-host");
      const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
      const initialized = globalThis.ReaderSession.ready() === true;
      const unitText = unit?.textContent?.trim() || "";
      const wasmReady = wasmResponses.some(({ status, contentType }) => status === 200 && contentType === "application/wasm");
      if (initialized && initCount === 1 && createCount === 1 && wasmReady && unitText) {
        done({
          initialized,
          initCount,
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
          initCount,
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
  `);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.initialized, true);
  assert.equal(result.initCount, 1);
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
      const originalInit = globalThis.ReaderSession.init;
      const originalCreate = globalThis.ReaderSession.create;
      let initCount = 0;
      let createCount = 0;
      const wasmResponses = [];
      globalThis.ReaderSession.init = (...args) => {
        initCount += 1;
        return originalInit(...args);
      };
      globalThis.ReaderSession.create = (...args) => {
        createCount += 1;
        return originalCreate(...args);
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
          const initialized = globalThis.ReaderSession.ready() === true;
          const unitText = unit?.textContent?.trim() || "";
          const wasmReady = wasmResponses.some(({ status, contentType }) => status === 200 && contentType === "application/wasm");
          if (initialized && initCount === 1 && createCount === 1 && wasmReady && unitText) {
            resolve();
            return;
          }
          if (performance.now() >= deadline) {
            reject(new Error(JSON.stringify({
              error: "ReaderSession and first reader unit did not become ready together",
              initialized,
              initCount,
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
        initialized: globalThis.ReaderSession.ready(),
        initCount,
        createCount,
        wasmResponses,
        host: Boolean(host),
        unit: Boolean(host?.shadowRoot?.querySelector('[data-reader-unit="true"]')),
        unitText: host?.shadowRoot?.querySelector('[data-reader-unit="true"]')?.textContent?.trim() || "",
      };
    });
    assert.equal(result.initialized, true);
    assert.equal(result.initCount, 1);
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
    for (const asset of ["defuddle.js", "session-wasm-module.js", "session.js", "engine.js", "extractor.js", "icons.js", "viewer.js", "reader_session_bg.wasm"]) {
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
        if (globalThis.ReaderSession?.ready?.() === true && unit?.textContent?.trim()) {
          return { unitText: unit.textContent.trim(), initialized: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        initialized: globalThis.ReaderSession?.ready?.() === true,
        unitText: document.getElementById("__reader-host")?.shadowRoot?.querySelector('[data-reader-unit="true"]')?.textContent?.trim() || "",
      };
    });
    assert.equal(result.initialized, true);
    assert.notEqual(result.unitText, "");
    for (const asset of ["defuddle.js", "session-wasm-module.js", "session.js", "engine.js", "extractor.js", "icons.js", "viewer.js"]) {
      assert.equal(assetRequests.get(asset), 1, `${asset} should load once`);
    }
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
        if (globalThis.ReaderSession?.ready?.() === true && unit?.textContent?.trim()) {
          return { initialized: true, unitText: unit.textContent.trim() };
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        initialized: globalThis.ReaderSession?.ready?.() === true,
        unitText: "",
        mobileViewer: typeof globalThis.MobileViewer,
        readerSession: typeof globalThis.ReaderSession,
        host: Boolean(document.getElementById("__reader-host")),
      };
    });
    assert.equal(result.initialized, true, JSON.stringify({ ...result, requestedAssets: Object.fromEntries(requestedAssets), pageErrors }));
    assert.notEqual(result.unitText, "");
    for (const asset of ["defuddle.js", "session-wasm-module.js", "session.js", "engine.js", "extractor.js"]) {
      assert.equal(requestedAssets.get(asset), 2, `${asset} should reload after the intermediate failure`);
    }
    for (const asset of ["icons.js", "viewer.js"]) {
      assert.equal(requestedAssets.get(asset), 1, `${asset} should load once after retry`);
    }
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeCancelInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${lazyPageUrl}?slow=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    const bootstrap = page.locator("#__reader-bootstrap");
    await bootstrap.getByRole("button", { name: "readerで読む" }).click();
    await bootstrap.getByRole("button", { name: "キャンセル" }).click();
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => ({
      bootstrapHost: Boolean(document.getElementById("__reader-bootstrap")),
      readerHost: Boolean(document.getElementById("__reader-host")),
      mobileViewer: typeof globalThis.MobileViewer,
      bootstrapHandleCount: document.getElementById("__reader-bootstrap")?.shadowRoot?.querySelectorAll(".handle").length || 0,
    }));
    assert.deepEqual(state, { bootstrapHost: true, readerHost: false, mobileViewer: "object", bootstrapHandleCount: 1 });
  } finally {
    await browser.close();
  }
}

async function verifyGeneratedLazyRuntimeHandoffCancelInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${lazyPageUrl}?slow-extraction=1&runtime=${Date.now()}-${process.pid}`, { waitUntil: "load" });
    const bootstrap = page.locator("#__reader-bootstrap");
    await bootstrap.getByRole("button", { name: "readerで読む" }).click();
    const reader = page.locator("#__reader-host");
    await reader.getByRole("button", { name: "中止" }).waitFor();
    await reader.getByRole("button", { name: "中止" }).click();
    await page.waitForTimeout(1100);
    const state = await page.evaluate(() => {
      const host = document.getElementById("__reader-host");
      return {
        bootstrapHost: Boolean(document.getElementById("__reader-bootstrap")),
        readerHost: Boolean(host),
        readerOverlay: Boolean(host?.shadowRoot?.querySelector(".reader")),
        readerHandleCount: host?.shadowRoot?.querySelectorAll(".entry").length || 0,
      };
    });
    assert.deepEqual(state, { bootstrapHost: false, readerHost: true, readerOverlay: false, readerHandleCount: 1 });
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
  await verifyGeneratedLazyRuntimeRetryInWebKit();
  await verifyGeneratedLazyRuntimeCancelInWebKit();
  await verifyGeneratedLazyRuntimeHandoffCancelInWebKit();
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
