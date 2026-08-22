import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const loaderSource = readFileSync(
  join(__dirname, "../ReaderExtension/Resources/viewer/lazy-runtime-loader-poc.js"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../ReaderExtension/Resources/manifest.json"), "utf8"),
) as { content_scripts: Array<{ js: string[] }> };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createLoaderScope(): { ReaderLazyRuntimePoCFactory: Function } {
  const scope = {
    browser: { runtime: { getURL: () => "safari-extension://reader/reader-runtime.js" } },
  } as Record<string, unknown>;
  runInNewContext(loaderSource, scope);
  return scope as unknown as { ReaderLazyRuntimePoCFactory: Function };
}

test("Safari loader defers extension import and single-flights repeated opens", async () => {
  const injectedScripts = manifest.content_scripts.flatMap((contentScript) => contentScript.js);
  assert.equal(injectedScripts.includes("reader-runtime.js"), false);
  assert.equal(injectedScripts.includes("lazy-runtime-loader-poc.js"), false);

  const scope = createLoaderScope();
  const runtime = deferred<{ installRuntime(scope: unknown): { ready: boolean } }>();
  const importedURLs: string[] = [];
  const loader = scope.ReaderLazyRuntimePoCFactory(
    (resourceName: string) => `safari-extension://reader/${resourceName}`,
    async (runtimeURL: string) => {
      importedURLs.push(runtimeURL);
      return runtime.promise;
    },
  );

  assert.deepEqual(importedURLs, []);
  const firstOpen = loader.open();
  const secondOpen = loader.open();
  assert.deepEqual(importedURLs, ["safari-extension://reader/reader-runtime.js"]);

  runtime.resolve({ installRuntime: () => ({ ready: true }) });
  assert.deepEqual(await Promise.all([firstOpen, secondOpen]), [{ ready: true }, { ready: true }]);
  assert.deepEqual(await loader.open(), { ready: true });
  assert.equal(importedURLs.length, 1);
});

test("Safari runtime asset exposes DOM-backed extension-world readiness", async () => {
  const runtime = await import(pathToFileURL(join(__dirname, "../ReaderExtension/Resources/viewer/reader-runtime-poc.mjs")).href);
  let initCount = 0;
  let createCount = 0;
  let destroyCount = 0;
  const result = await runtime.installRuntime({
    document: { documentElement: {} },
    MobileViewer: { open() {} },
    ReaderSession: {
      async init() {
        initCount += 1;
      },
      create() {
        createCount += 1;
        return { state: { phase: "idle" } };
      },
      destroy() {
        destroyCount += 1;
      },
    },
  });
  assert.deepEqual(result, { ready: true, world: "extension-content-script", sessionPhase: "idle" });
  assert.deepEqual({ initCount, createCount, destroyCount }, { initCount: 1, createCount: 1, destroyCount: 1 });
});

test("Safari loader resets after failure and ignores close/navigation completions", async () => {
  const scope = createLoaderScope();
  const firstAttempt = deferred<unknown>();
  const secondAttempt = deferred<{ installRuntime(scope: unknown): { ready: boolean } }>();
  let importCount = 0;
  const loader = scope.ReaderLazyRuntimePoCFactory(
    () => "safari-extension://reader/reader-runtime.js",
    async () => {
      importCount += 1;
      return importCount === 1 ? firstAttempt.promise : secondAttempt.promise;
    },
  );

  const failedOpen = loader.open();
  firstAttempt.reject(new Error("runtime unavailable"));
  await assert.rejects(failedOpen, /runtime unavailable/);
  const retriedOpen = loader.open();
  assert.equal(importCount, 2);

  loader.close();
  secondAttempt.resolve({ installRuntime: () => ({ ready: true }) });
  assert.equal(await retriedOpen, false);

  const navigatedOpen = loader.open();
  loader.navigate();
  assert.equal(await navigatedOpen, false);
});
