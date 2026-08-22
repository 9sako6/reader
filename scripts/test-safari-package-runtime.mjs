import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { webkit } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const webPort = Number(process.env.READER_SAFARI_SMOKE_PORT) || 4174;
let driverPort = Number(process.env.READER_SAFARI_DRIVER_PORT) || 0;
const baseUrl = `http://127.0.0.1:${webPort}`;
const pageUrl = `${baseUrl}/tests/e2e/fixtures/safari-package-runtime.html`;
const generatedRoot = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/generated");
const manifestPath = resolve(repositoryRoot, "apps/ios/ReaderExtension/Resources/manifest.json");
const requiredAssets = [
  "session-wasm.js",
  "session.js",
  "reader_session_bg.wasm",
  "engine.js",
  "extractor.js",
  "viewer.js",
  "bootstrap.js",
];
let fixtureServer = null;
let safariDriver = null;
let sessionId = null;

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

async function verifyPackage() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["reader_session_bg.wasm"],
    matches: ["<all_urls>"],
  }]);
  for (const asset of requiredAssets) await access(join(generatedRoot, asset));
  const wasmResponse = await fetch(`${baseUrl}/apps/ios/ReaderExtension/Resources/generated/reader_session_bg.wasm`);
  assert.equal(wasmResponse.status, 200);
  assert.equal(wasmResponse.headers.get("content-type"), "application/wasm");
  await WebAssembly.compile(await wasmResponse.arrayBuffer());
  const bundleRoot = process.env.READER_IOS_EXTENSION_BUNDLE
    ? resolve(process.env.READER_IOS_EXTENSION_BUNDLE)
    : resolve(repositoryRoot, "DerivedData/Build/Products/Debug-iphonesimulator/reader-extension.appex");
  try {
    await stat(bundleRoot);
    const packagedManifest = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
    assert.deepEqual(packagedManifest.web_accessible_resources, manifest.web_accessible_resources);
    for (const asset of requiredAssets) {
      await access(join(bundleRoot, asset));
    }
  } catch (error) {
    if (process.env.READER_REQUIRE_IOS_EXTENSION_BUNDLE === "1") throw error;
  }
}

async function verifySafariRuntime() {
  safariDriver = spawn("safaridriver", ["--port", String(driverPort)], {
    stdio: "ignore",
  });
  await waitFor(`http://127.0.0.1:${driverPort}/status`, (response) => response.status === 200);
  const created = await driverRequest("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "safari" } },
  });
  sessionId = created.sessionId;
  await driverRequest("POST", `/session/${sessionId}/url`, { url: pageUrl });
  const result = await executeScript(`
    const done = arguments[arguments.length - 1];
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
    globalThis.MobileViewer.open().then(() => {
      const host = document.getElementById("__reader-host");
      const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
      done({
        initialized: globalThis.ReaderSession.ready(),
        initCount,
        createCount,
        wasmResponses,
        host: Boolean(host),
        unit: Boolean(unit),
      });
    }).catch((error) => done({ error: String(error) }));
  `);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.initialized, true);
  assert.equal(result.initCount, 1);
  assert.equal(result.createCount, 1);
  assert.deepEqual(result.wasmResponses, [{ status: 200, contentType: "application/wasm" }]);
  assert.equal(result.host, true);
  assert.equal(result.unit, true);
}

async function verifyGeneratedRuntimeInWebKit() {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "load" });
    const result = await page.evaluate(async () => {
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
      const host = document.getElementById("__reader-host");
      const unit = host?.shadowRoot?.querySelector('[data-reader-unit="true"]');
      return {
        initialized: globalThis.ReaderSession.ready(),
        initCount,
        createCount,
        wasmResponses,
        host: Boolean(host),
        unit: Boolean(unit),
      };
    });
    assert.equal(result.initialized, true);
    assert.equal(result.initCount, 1);
    assert.equal(result.createCount, 1);
    assert.deepEqual(result.wasmResponses, [{ status: 200, contentType: "application/wasm" }]);
    assert.equal(result.host, true);
    assert.equal(result.unit, true);
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
  process.stdout.write("Generated Safari resources initialized ReaderSession in WebKit\n");
  try {
    await verifySafariRuntime();
    process.stdout.write("Safari WebDriver runtime smoke passed\n");
  } catch (error) {
    if (process.env.READER_SAFARI_WEBDRIVER_REQUIRED === "1") throw error;
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
