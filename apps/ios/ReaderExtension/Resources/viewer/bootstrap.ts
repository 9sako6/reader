(() => {
  if (globalThis.MobileViewer && globalThis.ReaderSession) {
    globalThis.MobileViewer.install();
    return;
  }

  const HOST_ID = "__reader-bootstrap";
  const ASSETS = [
    "defuddle.js",
    "session-wasm-module.js",
    "session.js",
    "engine.js",
    "extractor.js",
    "icons.js",
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
    .handle { position: fixed; right: 0; top: 62%; width: 44px; height: 52px; border: 0; padding: 0; background: transparent; pointer-events: auto; }
    .handle::after { content: ""; position: absolute; right: 0; top: 8px; width: 6px; height: 36px; border-radius: 6px 0 0 6px; background: #4ba9c7; transition: opacity 120ms ease, width 120ms ease; }
    .handle.loading::after { width: 10px; opacity: 1; }
    .feedback { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(5, 5, 5, .84); color: #eeeeef; pointer-events: auto; }
    .feedback[hidden], .handle[hidden] { display: none; }
    .panel { width: min(80vw, 320px); display: grid; gap: 16px; justify-items: center; padding: 24px; border-radius: 16px; background: #171717; text-align: center; }
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
  const cancel = globalThis.document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  cancel.hidden = true;
  const retry = globalThis.document.createElement("button");
  retry.type = "button";
  retry.textContent = "再試行";
  retry.hidden = true;
  actions.append(cancel, retry);
  panel.append(status, bar, actions);
  feedback.append(panel);
  shadow.append(style, handle, feedback);
  globalThis.document.documentElement.append(host);

  const importRuntime = (runtimeURL: string): Promise<unknown> => import(runtimeURL);
  let revealTimer: number | null = null;
  let feedbackTimer: number | null = null;
  let loading = false;

  const showFeedback = (message: string): void => {
    status.textContent = message;
    feedback.hidden = false;
  };

  const hideFeedback = (): void => {
    if (revealTimer !== null) globalThis.clearTimeout(revealTimer);
    if (feedbackTimer !== null) globalThis.clearTimeout(feedbackTimer);
    revealTimer = null;
    feedbackTimer = null;
    feedback.hidden = true;
    bar.hidden = true;
    handle.hidden = false;
    handle.classList.remove("loading");
    status.textContent = "";
    retry.hidden = true;
    loading = false;
  };

  const clearLoadingTimers = (): void => {
    if (revealTimer !== null) globalThis.clearTimeout(revealTimer);
    if (feedbackTimer !== null) globalThis.clearTimeout(feedbackTimer);
    revealTimer = null;
    feedbackTimer = null;
  };

  const loadRuntime = globalThis.ReaderLazyRuntime.createExtensionRuntimeLoader(
    ASSETS,
    getRuntimeURL,
    importRuntime,
    () => globalThis.MobileViewer.install(),
  );

  const controller = globalThis.ReaderLazyRuntime.createLazyRuntimeController(loadRuntime);

  const open = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    feedback.hidden = true;
    bar.hidden = true;
    cancel.hidden = true;
    retry.hidden = true;
    handle.hidden = false;
    handle.classList.add("loading");
    status.textContent = "";
    revealTimer = globalThis.setTimeout(() => {
      revealTimer = null;
      if (!loading) return;
      showFeedback("");
      bar.hidden = false;
      handle.hidden = true;
    }, 100);
    feedbackTimer = globalThis.setTimeout(() => {
      feedbackTimer = null;
      if (!loading) return;
      status.textContent = "もう少しお待ちください";
      cancel.hidden = false;
    }, 400);
    try {
      const current = await controller.open();
      if (!current) return;
      await globalThis.MobileViewer.open();
      clearLoadingTimers();
      loading = false;
      host.remove();
    } catch (error) {
      if (!loading) return;
      clearLoadingTimers();
      status.textContent = error instanceof Error ? error.message : "Readerを開けませんでした";
      bar.hidden = true;
      feedback.hidden = false;
      handle.hidden = true;
      retry.hidden = false;
      cancel.hidden = true;
      loading = false;
    }
  };

  const cancelLoad = (): void => {
    if (!loading) return;
    controller.close();
    hideFeedback();
  };

  handle.addEventListener("click", open);
  cancel.addEventListener("click", cancelLoad);
  retry.addEventListener("click", open);
  globalThis.addEventListener("pagehide", () => {
    controller.navigate();
    if (loading) hideFeedback();
  }, { once: true });
})();
