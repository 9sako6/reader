import bootstrapStyles from "./bootstrap.css";
import { createExtensionRuntimeLoader, createLazyRuntimeController } from "./lazy-runtime";

(() => {
  if (globalThis.MobileViewer && globalThis.ReaderSession) {
    globalThis.MobileViewer.install();
    return;
  }

  const HOST_ID = "__reader-bootstrap";
  const ASSETS = ["defuddle.js", "runtime.js"];
  const extensionRuntime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  const getRuntimeURL = extensionRuntime?.getURL?.bind(extensionRuntime);
  if (!getRuntimeURL) return;

  const existingHost = globalThis.document.getElementById(HOST_ID);
  if (existingHost) return;
  const host = globalThis.document.createElement("div");
  host.id = HOST_ID;
  host.dataset.readerOwned = "true";
  const shadow = host.attachShadow({ mode: "open" });
  const style = globalThis.document.createElement("style");
  style.textContent = bootstrapStyles;
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

  const loadRuntime = createExtensionRuntimeLoader(
    ASSETS,
    getRuntimeURL,
    importRuntime,
  );

  const controller = createLazyRuntimeController(loadRuntime);
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
