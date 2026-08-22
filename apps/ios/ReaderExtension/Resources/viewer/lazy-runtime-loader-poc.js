(() => {
  const installViewer = () => globalThis.MobileViewer?.install?.();
  const extensionAPI = globalThis.browser ?? globalThis.chrome;
  const getRuntimeURL = extensionAPI?.runtime?.getURL;
  if (typeof getRuntimeURL !== "function") {
    installViewer();
    return;
  }

  function createReaderLazyRuntime(getURL, importRuntime = (url) => import(url)) {
    let runtimePromise = null;
    let generation = 0;
    const url = getURL("reader-runtime.js");
    const loadRuntime = () => {
      if (runtimePromise) return runtimePromise;
      runtimePromise = importRuntime(url).then((runtime) => runtime.installRuntime(globalThis)).catch((error) => {
        runtimePromise = null;
        throw error;
      });
      return runtimePromise;
    };

    return {
      async open() {
        const requestGeneration = generation;
        try {
          const runtime = await loadRuntime();
          if (requestGeneration !== generation) return false;
          return runtime;
        } catch (error) {
          if (requestGeneration !== generation) return false;
          throw error;
        }
      },
      close() {
        generation += 1;
      },
      navigate() {
        generation += 1;
      },
    };
  }

  globalThis.ReaderLazyRuntimePoCFactory = createReaderLazyRuntime;
  globalThis.ReaderLazyRuntimePoC = createReaderLazyRuntime(
    (resourceName) => getRuntimeURL.call(extensionAPI.runtime, resourceName),
  );
  const setRuntimeFeedback = (state) => {
    const host = globalThis.document?.querySelector?.('[data-reader-owned="true"]');
    if (host) host.dataset.readerRuntimeState = state;
    const handle = host?.shadowRoot?.querySelector?.(".entry");
    if (!handle) return;
    if (state === "loading") {
      handle.setAttribute("aria-label", "readerを準備しています");
      return;
    }
    if (state === "error") {
      handle.setAttribute("aria-label", "readerの準備に失敗しました。もう一度押してください");
      return;
    }
    handle.setAttribute("aria-label", "readerで読む");
  };
  globalThis.ReaderRuntimeGate = async (open) => {
    setRuntimeFeedback("loading");
    try {
      const runtime = await globalThis.ReaderLazyRuntimePoC.open();
      if (!runtime) {
        setRuntimeFeedback("ready");
        return;
      }
      setRuntimeFeedback("ready");
      await open();
    } catch {
      setRuntimeFeedback("error");
    }
  };
  globalThis.addEventListener?.("pagehide", () => globalThis.ReaderLazyRuntimePoC.navigate(), { once: true });
  installViewer();
})();
