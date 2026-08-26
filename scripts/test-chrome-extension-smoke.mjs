import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const port = Number(process.env.READER_E2E_PORT) || 4173;
const baseUrl = process.env.READER_E2E_BASE_URL || `http://127.0.0.1:${port}`;
const fixturePageUrl = `${baseUrl}/tests/e2e/fixtures/extension-smoke.html?strict-csp=1`;
const pageUrl = process.env.READER_CHROME_SMOKE_PAGE_URL || fixturePageUrl;
const configuredExtensionRoot = process.env.READER_CHROME_SMOKE_EXTENSION_ROOT;
const distRoot = configuredExtensionRoot
  ? resolve(configuredExtensionRoot)
  : resolve(repositoryRoot, "apps/chrome/dist");
const extensionRoot = await mkdtemp(join(tmpdir(), "reader-extension-smoke-"));
const userDataRoot = await mkdtemp(join(tmpdir(), "reader-extension-user-"));
let fixtureServer = null;
let context = null;

async function ensureFixtureServer() {
  if (pageUrl !== fixturePageUrl) return;
  try {
    const response = await fetch(pageUrl);
    assert.equal(response.status, 200);
    return;
  } catch {
    fixtureServer = spawn(process.execPath, ["tests/e2e/server.mjs"], {
      cwd: repositoryRoot,
      env: { ...process.env, READER_E2E_PORT: String(port) },
      stdio: "ignore",
    });
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(pageUrl);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 50));
  }
  throw new Error(`fixture server did not start at ${baseUrl}`);
}

async function loadTestExtension() {
  await cp(distRoot, extensionRoot, { recursive: true });
  const manifestPath = join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.host_permissions, undefined);
  manifest.host_permissions = [
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
    `${new URL(pageUrl).origin}/*`,
  ];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  context = await chromium.launchPersistentContext(userDataRoot, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
    ],
  });
}

async function serviceWorker() {
  const existing = context.serviceWorkers().find((worker) => worker.url().endsWith("/service-worker.js"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: 10_000 });
}

try {
  await ensureFixtureServer();
  await loadTestExtension();
  const page = await context.newPage();
  const pageConsole = [];
  page.on("console", (message) => pageConsole.push(message.text()));
  await page.goto(pageUrl);
  const worker = await serviceWorker();
  const workerConsole = [];
  worker.on("console", (message) => workerConsole.push(message.text()));
  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    return tab?.id ?? null;
  });
  assert.equal(typeof tabId, "number");

  await worker.evaluate(async (activeTabId) => {
    if (typeof globalThis.startPreparation !== "function") {
      throw new Error("production service worker preparation entry is unavailable");
    }
    await globalThis.startPreparation(activeTabId, { kind: "page" });
  }, tabId);
  const reader = page.locator('[data-reader-owned="true"]');
  await reader.waitFor({ state: "attached", timeout: 30_000 });
  const readerUnit = page.locator('[data-reader-unit="true"]');
  const readerError = page.locator('[data-reader-error="true"]');
  await readerUnit.or(readerError).first().waitFor({ state: "attached", timeout: 30_000 });
  const readerErrorCount = await readerError.count();
  if (readerErrorCount > 0) {
    assert.fail(`reader preparation failed: ${await readerError.innerText()}\n${JSON.stringify({ pageConsole, workerConsole })}`);
  }
  const modeButton = page.getByRole("button", { name: "文章で読む" });
  const initialSourceStart = await readerUnit.getAttribute("data-source-start");
  assert.notEqual(initialSourceStart, null);
  await modeButton.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
  await expect(modeButton).toBeVisible();

  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();
  await expect(readerUnit).not.toHaveAttribute("data-source-start", initialSourceStart);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
  const advancedSourceStart = Number(await readerUnit.getAttribute("data-source-start"));
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Number(await readerUnit.getAttribute("data-source-start"))).toBeLessThan(advancedSourceStart);

  const sessionDiagnostics = await worker.evaluate(async (activeTabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      world: "ISOLATED",
      func: () => ({
        initialized: typeof globalThis.ReaderSession?.create === "function",
        initializedMark: globalThis.performance.getEntriesByName("reader:session-init-end", "mark").length,
        firstUnitMark: globalThis.performance.getEntriesByName("reader:first-unit", "mark").length,
      }),
    });
    return result.result;
  }, tabId);
  assert.deepEqual(sessionDiagnostics, {
    initialized: true,
    initializedMark: 1,
    firstUnitMark: 1,
  });

  await page.getByRole("button", { name: "readerを閉じる" }).click();
  await reader.waitFor({ state: "detached", timeout: 30_000 });
  await worker.evaluate(async (activeTabId) => {
    await globalThis.startPreparation(activeTabId, { kind: "page" });
  }, tabId);
  await reader.waitFor({ state: "attached", timeout: 30_000 });
  await readerUnit.waitFor({ state: "attached", timeout: 30_000 });
} finally {
  if (context) await context.close();
  fixtureServer?.kill();
  await rm(extensionRoot, { recursive: true, force: true });
  await rm(userDataRoot, { recursive: true, force: true });
}
