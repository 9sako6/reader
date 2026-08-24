import assert from "node:assert/strict";

import {
  createExtensionRuntimeLoader,
  createLazyRuntimeController,
} from "../ReaderExtension/Resources/viewer/lazy-runtime";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

test("lazy runtime loads once for concurrent opens", async () => {
  const runtime = deferred<void>();
  let loadCount = 0;
  const controller = createLazyRuntimeController(() => {
    loadCount += 1;
    return runtime.promise;
  });

  const firstOpen = controller.open();
  const secondOpen = controller.open();
  assert.equal(loadCount, 1);

  runtime.resolve(undefined);
  assert.equal(await firstOpen, true);
  assert.equal(await secondOpen, true);

  assert.equal(await controller.open(), true);
  assert.equal(loadCount, 1);
});

test("extension runtime loader imports the extractor dependency before the shared runtime", async () => {
  const importedURLs: string[] = [];
  const loadRuntime = createExtensionRuntimeLoader(
    ["defuddle.js", "runtime.js"],
    (asset) => `safari-extension://reader/${asset}`,
    async (runtimeURL) => {
      importedURLs.push(runtimeURL);
    },
  );

  await loadRuntime();
  assert.deepEqual(importedURLs, [
    "safari-extension://reader/defuddle.js?readerAttempt=1",
    "safari-extension://reader/runtime.js?readerAttempt=1",
  ]);
});

test("lazy runtime resets after a failed load so retry can succeed", async () => {
  const firstAttempt = deferred<void>();
  const secondAttempt = deferred<void>();
  let loadCount = 0;
  const controller = createLazyRuntimeController(() => {
    loadCount += 1;
    return loadCount === 1 ? firstAttempt.promise : secondAttempt.promise;
  });

  const failedOpen = controller.open();
  firstAttempt.reject(new Error("runtime unavailable"));
  await assert.rejects(failedOpen, /runtime unavailable/);

  const retriedOpen = controller.open();
  assert.equal(loadCount, 2);
  secondAttempt.resolve(undefined);
  assert.equal(await retriedOpen, true);
});

test("lazy runtime ignores a completion after close", async () => {
  const runtime = deferred<void>();
  const controller = createLazyRuntimeController(() => runtime.promise);

  const opening = controller.open();
  controller.close();
  runtime.resolve(undefined);

  assert.equal(await opening, false);
});

test("lazy runtime ignores a failed completion after close", async () => {
  const runtime = deferred<void>();
  const controller = createLazyRuntimeController(() => runtime.promise);

  const opening = controller.open();
  controller.close();
  runtime.reject(new Error("runtime unavailable"));

  assert.equal(await opening, false);
});

test("lazy runtime ignores a completion after navigation", async () => {
  const runtime = deferred<void>();
  const controller = createLazyRuntimeController(() => runtime.promise);

  const opening = controller.open();
  controller.navigate();
  runtime.resolve(undefined);

  assert.equal(await opening, false);
});
