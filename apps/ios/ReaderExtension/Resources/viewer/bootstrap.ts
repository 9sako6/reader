(() => {
  if (globalThis.MobileViewer && globalThis.ReaderSession) {
    globalThis.MobileViewer.install();
    return;
  }

  const HOST_ID = "__reader-bootstrap";
  const ASSETS = [
    "defuddle.js",
    "session-wasm-module.js",
    "runtime.js",
    "engine.js",
    "extractor.js",
    "viewer.js",
  ];
  const extensionRuntime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  const getRuntimeURL = extensionRuntime?.getURL?.bind(extensionRuntime);
  if (!getRuntimeURL || !globalThis.ReaderLazyRuntime) return;

  const existingHost = globalThis.document.getElementById(HOST_ID);
  if (existingHost) return;
  const host = globalThis.document.createElement("div");
  host.id = HOST_ID;
  host.dataset.readerOwned = "true";
  const shadow = host.attachShadow({ mode: "open" });
  const style = globalThis.document.createElement("style");
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
    button { font: -apple-system-body; }
    .handle { position: fixed; right: 0; top: 62%; width: 44px; height: 52px; border: 0; padding: 0; background: transparent; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .handle::after { content: ""; position: absolute; right: 0; top: 8px; width: 6px; height: 36px; border-radius: 6px 0 0 6px; background: #4ba9c7; opacity: .82; box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.28); transition: opacity 160ms ease, width 160ms ease; }
    .handle:active::after, .handle:focus-visible::after { width: 10px; opacity: 1; }
    .handle.scrolling::after { opacity: .24; }
    .handle.loading::after { width: 10px; opacity: 1; }
    .feedback { position: fixed; inset: 0; display: grid; place-items: center; background: transparent; color: #eeeeef; pointer-events: auto; }
    .feedback[hidden], .handle[hidden] { display: none; }
    .panel { width: min(56vw, 360px); }
    .feedback:not(.error) [role="status"], .feedback:not(.error) .actions { display: none; }
    .feedback.error { background: rgba(5, 5, 5, .84); }
    .feedback.error .panel { width: min(80vw, 320px); display: grid; gap: 16px; justify-items: center; padding: 24px; border-radius: 16px; background: #171717; text-align: center; }
    .bar { width: 100%; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(238,238,239,.24); }
    .bar::after { content: ""; display: block; width: 35%; height: 100%; background: #eeeeef; animation: reader-bootstrap-progress 900ms linear infinite; }
    .actions { display: flex; gap: 8px; }
    .actions button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: #303030; color: #eeeeef; }
    @keyframes reader-bootstrap-progress { from { transform: translateX(-120%); } to { transform: translateX(300%); } }
    @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; } }
  `;
  const handle = globalThis.document.createElement("button");
  handle.className = "handle";
  handle.type = "button";
  handle.setAttribute("aria-label", "readerで読む");
  const feedback = globalThis.document.createElement("div");
  feedback.className = "feedback";
  feedback.hidden = true;
  const panel = globalThis.document.createElement("div");
  panel.className = "panel";
  const status = globalThis.document.createElement("div");
  status.setAttribute("role", "status");
  const bar = globalThis.document.createElement("div");
  bar.className = "bar";
  bar.hidden = true;
  const actions = globalThis.document.createElement("div");
  actions.className = "actions";
  const retry = globalThis.document.createElement("button");
  retry.type = "button";
  retry.textContent = "再試行";
  retry.hidden = true;
  actions.append(retry);
  panel.append(status, bar, actions);
  feedback.append(panel);
  shadow.append(style, handle, feedback);
  globalThis.document.documentElement.append(host);

  const importRuntime = (runtimeURL: string): Promise<unknown> => import(runtimeURL);
  let revealTimer: number | null = null;
  let scrollFadeTimer: number | null = null;
  let loading = false;

  const showFeedback = (message: string): void => {
    status.textContent = message;
    feedback.hidden = false;
  };

  const hideFeedback = (): void => {
    if (revealTimer !== null) globalThis.clearTimeout(revealTimer);
    revealTimer = null;
    feedback.hidden = true;
    feedback.classList.remove("error");
    bar.hidden = true;
    handle.hidden = false;
    handle.classList.remove("loading");
    status.textContent = "";
    retry.hidden = true;
    loading = false;
  };

  const clearScrollFade = (): void => {
    if (scrollFadeTimer !== null) globalThis.clearTimeout(scrollFadeTimer);
    scrollFadeTimer = null;
    handle.classList.remove("scrolling");
  };

  const fadeHandleDuringScroll = (): void => {
    if (handle.hidden) return;
    handle.classList.add("scrolling");
    if (scrollFadeTimer !== null) globalThis.clearTimeout(scrollFadeTimer);
    scrollFadeTimer = globalThis.setTimeout(() => {
      scrollFadeTimer = null;
      handle.classList.remove("scrolling");
    }, 320);
  };

  const clearLoadingTimers = (): void => {
    if (revealTimer !== null) globalThis.clearTimeout(revealTimer);
    revealTimer = null;
  };

  const loadRuntime = globalThis.ReaderLazyRuntime.createExtensionRuntimeLoader(
    ASSETS,
    getRuntimeURL,
    importRuntime,
  );

  const controller = globalThis.ReaderLazyRuntime.createLazyRuntimeController(loadRuntime);
  let pagehideHandler: (() => void) | null = null;

  const cleanupBootstrap = (): void => {
    clearLoadingTimers();
    globalThis.removeEventListener("scroll", fadeHandleDuringScroll);
    clearScrollFade();
    if (pagehideHandler) {
      globalThis.removeEventListener("pagehide", pagehideHandler);
      pagehideHandler = null;
    }
  };

  const open = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    feedback.hidden = true;
    bar.hidden = true;
    retry.hidden = true;
    handle.hidden = false;
    handle.classList.add("loading");
    feedback.classList.remove("error");
    status.textContent = "";
    revealTimer = globalThis.setTimeout(() => {
      revealTimer = null;
      if (!loading) return;
      showFeedback("");
      bar.hidden = false;
      handle.hidden = true;
    }, 200);
    try {
      const current = await controller.open();
      if (!current) return;
      globalThis.MobileViewer.install();
      cleanupBootstrap();
      loading = false;
      host.remove();
      await globalThis.MobileViewer.open();
    } catch (error) {
      if (!loading) return;
      clearLoadingTimers();
      feedback.classList.add("error");
      status.textContent = error instanceof Error ? error.message : "Readerを開けませんでした";
      bar.hidden = true;
      feedback.hidden = false;
      handle.hidden = true;
      retry.hidden = false;
      loading = false;
    }
  };

  handle.addEventListener("click", open);
  retry.addEventListener("click", open);
  globalThis.addEventListener("scroll", fadeHandleDuringScroll, { passive: true });
  pagehideHandler = () => {
    controller.navigate();
    if (loading) hideFeedback();
    cleanupBootstrap();
    host.remove();
  };
  globalThis.addEventListener("pagehide", pagehideHandler, { once: true });
})();
