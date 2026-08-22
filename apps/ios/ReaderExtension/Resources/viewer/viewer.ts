(function installMobileViewer(root: typeof globalThis, factory: (global: typeof globalThis) => ReaderMobileViewer) {
  if (root.MobileViewer) return;
  root.MobileViewer = factory(root);
})(globalThis, function createMobileViewer(global: typeof globalThis): ReaderMobileViewer {
  type ReadingMode = "rsvp" | "text";
  type MobileIconName = "previous" | "play" | "pause" | "close";
  interface LaunchProgress {
    element: HTMLElement;
    loader: HTMLElement;
    indicator: HTMLElement;
    animation: Animation | null;
    startedAt: number;
  }
  interface MobileNodes {
    content: HTMLElement;
    controlbar: HTMLElement;
    modeButton: HTMLButtonElement;
    progress: HTMLElement;
    previousUnit: HTMLElement | null;
    unit: HTMLElement | null;
    nextUnit: HTMLElement | null;
    play: HTMLButtonElement | null;
    transport: HTMLElement | null;
    textScroller: HTMLElement | null;
    textMarkers: HTMLElement[];
    textRestoreScrollTop: number | null;
  }

  const HOST_ID = "__reader-host";
  const LAUNCH_PROGRESS_REVEAL_DELAY_MS = 100;
  const LAUNCH_PROGRESS_DURATION_MS = 1200;
  const LAUNCH_PROGRESS_PRECOMPLETION = 0.94;
  const TEXT_VIEW_READABLE_TOP_PX = 72;
  const TEXT_VIEW_READABLE_BOTTOM_PX = 96;
  const RSVP_FONT_SIZE = 40;
  let shadow: ShadowRoot | null = null;
  let host: HTMLDivElement | null = null;
  let handle: HTMLButtonElement | null = null;
  let overlay: HTMLElement | null = null;
  let scrollFadeTimer: number | null = null;
  let sourceScrollY = 0;
  let sourceOverflow: string | null = null;
  let sourceBodyOverflow: string | null = null;
  let content: ReaderContent | null = null;
  let units: ReaderUnit[] = [];
  let unitIndex = 0;
  let flowItems: ReaderFlowItem[] = [];
  let flowIndex = 0;
  let currentPosition: ReaderPosition = { kind: "text", sourceOffset: 0 };
  let contextSentenceIndex: number | null = null;
  let playbackTimer: number | null = null;
  let playing = false;
  let figurePanel: HTMLElement | null = null;
  let mode: ReadingMode = "rsvp";
  let nodes: MobileNodes | null = null;
  let opening = false;
  let pendingLeftTap: number | null = null;
  let lastLeftTapAt = 0;
  let lastLeftTapX = 0;
  let lastLeftTapY = 0;
  let launchFocus: HTMLElement | null = null;
  let inertedElements: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  let backgroundInert = false;
  let launchProgress: LaunchProgress | null = null;
  let sessionGeneration = 0;

  function getNodes(): MobileNodes {
    if (!nodes) throw new Error("reader shell is not available");
    return nodes;
  }

  function install() {
    if (!global.document?.documentElement || global.document.getElementById(HOST_ID)) return;
    host = global.document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    shadow = root;
    root.append(createStyles());
    handle = createHandle();
    root.append(handle);
    global.document.documentElement.append(host);
    global.addEventListener("scroll", fadeHandleDuringScroll, { passive: true });
    global.addEventListener("resize", handleViewportChange, { passive: true });
    global.document.addEventListener?.("visibilitychange", handleVisibilityChange);
  }

  function createStyles() {
    const style = global.document.createElement("style");
    style.textContent = `
      :host { --reader-background: #050505; --reader-surface: #171717; --reader-text: #eeeeef; --reader-secondary: #a8a8ad; --reader-muted: #77777d; --reader-control: #a2a2a8; --reader-accent: #4ba9c7; all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; color-scheme: dark; }
      * { box-sizing: border-box; }
      button, input { font: inherit; }
      .entry { position: fixed; right: 0; top: 62%; width: 44px; height: 52px; padding: 0; border: 0; background: transparent; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      .entry::after { content: ""; position: absolute; right: 0; top: 8px; width: 6px; height: 36px; border-radius: 6px 0 0 6px; background: var(--reader-accent); opacity: .82; box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.28); transition: opacity 160ms ease, width 160ms ease; }
      .entry:active::after, .entry:focus-visible::after { width: 10px; opacity: 1; }
      .entry.scrolling::after { opacity: .24; }
      .entry[hidden] { display: none; }
      .launch-feedback { position: fixed; z-index: 3; inset: 0; pointer-events: none; }
      .launch-loader { width: min(56vw, 360px); height: 3px; position: fixed; left: 50%; top: 50%; opacity: 0; transform: translate(-50%, -50%); animation: reader-launch-loader-reveal 120ms cubic-bezier(.22, 1, .36, 1) forwards; will-change: opacity; }
      .launch-progress-track { width: 100%; height: 100%; overflow: hidden; border-radius: 999px; background: rgba(238,238,239,.24); }
      .launch-progress-indicator { width: 100%; height: 100%; border-radius: inherit; background: var(--reader-text); opacity: 1; transform: scaleX(0); transform-origin: left center; will-change: transform; }
      .reader { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0,1fr); background: var(--reader-background); color: var(--reader-text); pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
      .topbar { min-height: calc(58px + env(safe-area-inset-top)); padding: calc(8px + env(safe-area-inset-top)) 12px 8px; position: relative; display: flex; align-items: center; justify-content: flex-end; background: var(--reader-background); }
      .mode-button { min-width: 120px; min-height: 44px; padding: 0 12px; position: absolute; z-index: 5; left: 50%; bottom: calc(6px + env(safe-area-inset-bottom)); border: 0; border-radius: 14px; background: rgba(5,5,5,.58); color: var(--reader-secondary); font-size: 14px; font-weight: 600; white-space: nowrap; transform: translateX(-50%); pointer-events: auto; -webkit-tap-highlight-color: transparent; }
      .mode-button:active { opacity: .52; transform: translateX(-50%) scale(.96); }
      .controlbar { height: calc(132px + env(safe-area-inset-bottom)); position: absolute; z-index: 4; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(5,5,5,.96), rgba(5,5,5,0)); pointer-events: none; }
      .control-dock { width: min(100% - 32px, 280px); min-height: 60px; position: absolute; left: 50%; bottom: calc(52px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: 1fr 64px 1fr; align-items: center; background: transparent; transform: translateX(-50%); pointer-events: auto; transition: opacity 140ms ease, transform 140ms ease; }
      .dock-button { min-width: 44px; min-height: 56px; padding: 0 14px; border: 0; background: transparent; color: var(--reader-control); font-size: 15px; font-weight: 600; white-space: nowrap; transition: opacity 100ms ease, transform 100ms ease; }
      .dock-button svg { display: block; margin: auto; }
      .dock-button:active { opacity: .52; transform: scale(.94); }
      .dock-button.play { width: 64px; height: 64px; min-height: 64px; padding: 0; }
      .icon-button { width: 44px; height: 44px; padding: 0; border: 0; background: transparent; color: var(--reader-control); display: grid; place-items: center; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: opacity 100ms ease, transform 100ms ease; }
      .icon-button svg { display: block; }
      .icon-button:active { opacity: .52; transform: scale(.94); }
      .content { min-height: 0; position: relative; overflow: hidden; }
      .error { position: absolute; inset: 0; display: grid; place-content: center; gap: 16px; padding: 32px; text-align: center; color: var(--reader-secondary); }
      .error-actions { display: flex; justify-content: center; gap: 10px; }
      .error-actions button { min-width: 112px; min-height: 44px; border: 0; border-radius: 14px; background: var(--reader-surface); color: var(--reader-text); }
      .text-view { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 56px max(20px, env(safe-area-inset-right)) 96px max(20px, env(safe-area-inset-left)); -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.3) 24px, #000 ${TEXT_VIEW_READABLE_TOP_PX}px, #000 calc(100% - ${TEXT_VIEW_READABLE_BOTTOM_PX}px), rgba(0,0,0,.3) calc(100% - 24px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.3) 24px, #000 ${TEXT_VIEW_READABLE_TOP_PX}px, #000 calc(100% - ${TEXT_VIEW_READABLE_BOTTOM_PX}px), rgba(0,0,0,.3) calc(100% - 24px), transparent 100%); }
      .article { max-width: 32em; margin: 0 auto; font-size: var(--reader-font-size, 18px); line-height: var(--reader-line-height, 1.82); letter-spacing: .01em; }
      .article-title { margin: 0 0 1.5em; font-size: 1.58em; line-height: 1.3; letter-spacing: -.02em; }
      .paragraph { margin: 0 0 1.35em; white-space: pre-wrap; overflow-wrap: anywhere; }
      .article h2, .article h3, .article h4, .article h5, .article h6 { margin: 2em 0 .8em; line-height: 1.35; }
      .article h2 { font-size: 1.28em; }
      .article h3, .article h4, .article h5, .article h6 { font-size: 1.08em; }
      .article blockquote { margin: 1.5em 0; padding: .25em 0 .25em 1em; border-left: 3px solid var(--reader-accent); color: var(--reader-secondary); }
      .article pre { margin: 1.5em 0; padding: 16px; overflow-x: auto; border-radius: 12px; background: var(--reader-surface); white-space: pre-wrap; }
      .article-figure { margin: 2em 0; }
      .article-figure .reader-image-surface img { max-height: 72vh; }
      .article-figure figcaption { margin-top: .65em; color: var(--reader-muted); font-size: .78em; line-height: 1.5; text-align: center; }
      .progress { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: calc(18px + env(safe-area-inset-bottom)); color: var(--reader-muted); text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; pointer-events: none; }
      .rsvp-view { height: 100%; padding: 16px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      .focus-area { width: 100%; height: 100%; min-height: 0; position: relative; display: grid; place-items: center; text-align: center; }
      .context-unit { position: absolute; left: 24px; right: 24px; display: -webkit-box; overflow: hidden; color: var(--reader-muted); font-size: clamp(16px, 4.5vw, 20px); font-weight: 550; line-height: 1.4; opacity: .26; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .context-unit.previous { bottom: calc(50% + 82px); }
      .context-unit.next { top: calc(50% + 82px); }
      .rsvp-unit { min-height: 1.5em; max-width: calc(100vw - 40px); position: relative; z-index: 0; display: grid; place-items: center; font-size: var(--reader-rsvp-font-size, 40px); font-weight: 650; line-height: 1.25; word-break: keep-all; overflow-wrap: normal; }
      .rsvp-unit.quote::before { content: ""; position: absolute; z-index: -1; inset: -12px -16px; border-radius: 14px; background: rgba(255,255,255,.055); }
      .rsvp-unit.aside { color: var(--reader-secondary); }
      .rsvp-figure { position: absolute; z-index: 2; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; background: var(--reader-background); touch-action: manipulation; }
      .reader-image-surface { position: relative; width: min(100%, 720px); margin: 0 auto; overflow: hidden; border-radius: 12px; touch-action: manipulation; }
      .reader-image-surface img { display: block; width: 100%; height: auto; object-fit: contain; }
      .reader-image-veil { position: absolute; inset: 0; background: rgba(0,0,0,.46); opacity: 1; pointer-events: none; transition: opacity 120ms ease-out; }
      .rsvp-figure .reader-image-surface img { max-height: 54vh; }
      .rsvp-figure figcaption { min-height: 1.4em; color: var(--reader-muted); font-size: 13px; line-height: 1.4; text-align: center; }
      .rewind-feedback { width: 80px; height: 80px; margin: -40px 0 0 -40px; position: absolute; z-index: 6; display: grid; place-items: center; color: var(--reader-control); pointer-events: none; }
      .rewind-ring { position: absolute; inset: 0; border-radius: 50%; background: rgba(162,162,168,.12); }
      .rewind-feedback svg { position: relative; z-index: 1; opacity: .72; }
      @keyframes reader-launch-loader-reveal { to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .entry::after, .dock-button, .control-dock, .icon-button, .reader-image-veil { transition: none; }
        .mode-button:active { transform: translateX(-50%); }
        .dock-button:active, .icon-button:active { transform: none; }
        .launch-loader { animation-duration: 1ms; }
      }
      @media (prefers-contrast: more) { :host { --reader-secondary: #f5f5f7; --reader-muted: #f5f5f7; --reader-control: #f5f5f7; } }
    `;
    return style;
  }

  function createHandle() {
    const button = global.document.createElement("button");
    button.className = "entry";
    button.type = "button";
    button.setAttribute("aria-label", "readerで読む");
    button.addEventListener("click", open);
    return button;
  }

  function isCurrentSession(generation: number): boolean {
    return generation === sessionGeneration;
  }

  function destroyLaunchProgress(progress: LaunchProgress): void {
    progress.animation?.cancel?.();
    progress.element.remove();
    if (launchProgress === progress) launchProgress = null;
  }

  async function open() {
    if (overlay || opening || !handle || !shadow) return;
    const generation = ++sessionGeneration;
    opening = true;
    launchFocus = handle;
    makeBackgroundInert(host);
    sourceScrollY = global.scrollY || 0;
    sourceOverflow = global.document.documentElement.style.overflow;
    sourceBodyOverflow = global.document.body?.style.overflow ?? null;
    handle.hidden = true;
    const progress = createLaunchFeedback();
    launchProgress = progress;
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    shadow.append(progress.element);
    await nextPaint();
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    let preparationError: unknown = null;
    try {
      const extractedContent = await global.Extractor.fromPage(global.document, global.Defuddle);
      if (!isCurrentSession(generation)) {
        destroyLaunchProgress(progress);
        return;
      }
      content = extractedContent;
      if (!content?.text) throw new Error("content_not_found");
      rebuildUnits();
      if (units.length === 0) throw new Error("units_not_found");
      currentPosition = flowItems[0]
        ? global.Engine.positionForFlowItem(flowItems[0], units)
        : { kind: "text", sourceOffset: 0 };
      flowIndex = 0;
      unitIndex = flowItems[0]?.kind === "unit" ? flowItems[0].unitIndex : 0;
    } catch (error) {
      if (!isCurrentSession(generation)) {
        destroyLaunchProgress(progress);
        return;
      }
      preparationError = error;
    }
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    if (Date.now() - progress.startedAt >= LAUNCH_PROGRESS_REVEAL_DELAY_MS) {
      await Promise.all([
        completeLaunchProgress(progress, generation),
        coverSourcePage(progress.element),
      ]);
      if (!isCurrentSession(generation)) {
        destroyLaunchProgress(progress);
        return;
      }
    } else progress.animation?.cancel?.();
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    const reader = buildShell();
    if (!isCurrentSession(generation)) {
      reader.remove();
      destroyLaunchProgress(progress);
      return;
    }
    overlay = reader;
    shadow.append(reader);
    global.addEventListener("keydown", handleKeyDown);
    destroyLaunchProgress(progress);
    lockSourcePage();
    if (!isCurrentSession(generation)) return;
    if (preparationError) {
      showError();
      global.console?.error?.("reader could not prepare this page", preparationError);
    } else renderReader();
    global.requestAnimationFrame(() => {
      if (!isCurrentSession(generation)) return;
      findCloseButton()?.focus();
    });
    if (isCurrentSession(generation)) opening = false;
  }

  function createLaunchFeedback(): LaunchProgress {
    const feedback = global.document.createElement("div");
    feedback.className = "launch-feedback";
    feedback.setAttribute("aria-hidden", "true");
    const loader = global.document.createElement("div");
    loader.className = "launch-loader";
    loader.style.animationDelay = `${LAUNCH_PROGRESS_REVEAL_DELAY_MS}ms`;
    const track = global.document.createElement("div");
    track.className = "launch-progress-track";
    const indicator = global.document.createElement("div");
    indicator.className = "launch-progress-indicator";
    const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animation = reducedMotion ? null : indicator.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(.94)" }],
      { duration: LAUNCH_PROGRESS_DURATION_MS, iterations: 1, easing: "linear", fill: "forwards" },
    );
    track.append(indicator);
    loader.append(track);
    feedback.append(loader);
    return { element: feedback, loader, indicator, animation, startedAt: Date.now() };
  }

  async function completeLaunchProgress(progress: LaunchProgress, generation: number): Promise<void> {
    progress.loader.style.animation = "none";
    progress.loader.style.opacity = "1";
    const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const elapsedRatio = Math.min(1, Math.max(
      0,
      (Date.now() - progress.startedAt) / LAUNCH_PROGRESS_DURATION_MS,
    ));
    const currentScale = elapsedRatio * LAUNCH_PROGRESS_PRECOMPLETION;
    progress.animation?.cancel?.();
    if (reducedMotion) {
      progress.indicator.style.transform = "scaleX(1)";
      return;
    }
    const completion = progress.indicator.animate(
      [{ transform: `scaleX(${currentScale})` }, { transform: "scaleX(1)" }],
      {
        duration: Math.min(160, Math.max(
          70,
          ((1 - currentScale) / LAUNCH_PROGRESS_PRECOMPLETION) * LAUNCH_PROGRESS_DURATION_MS,
        )),
        iterations: 1,
        easing: "linear",
        fill: "forwards",
      },
    );
    try {
      await completion.finished;
    } catch {
      if (isCurrentSession(generation)) progress.indicator.style.transform = "scaleX(1)";
    }
  }

  async function coverSourcePage(feedback: HTMLElement): Promise<void> {
    if (global.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = feedback.animate?.(
      [
        { background: "rgba(5,5,5,0)" },
        { background: "rgba(5,5,5,1)" },
      ],
      { duration: 140, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" },
    );
    try {
      await animation?.finished;
    } catch {
      return;
    }
  }

  function buildShell() {
    const reader = global.document.createElement("section");
    reader.className = "reader";
    reader.setAttribute("role", "dialog");
    reader.setAttribute("aria-label", "reader");
    reader.setAttribute("aria-modal", "true");
    const topbar = global.document.createElement("header");
    topbar.className = "topbar";
    const modeButton = transportButton("", toggleMode);
    modeButton.className = "mode-button";
    const closeButton = iconButton("close", "readerを閉じる", close);
    topbar.append(closeButton);
    const controlbar = global.document.createElement("footer");
    controlbar.className = "controlbar";
    const progress = global.document.createElement("div");
    progress.className = "progress";
    controlbar.append(modeButton, progress);
    const content = global.document.createElement("main");
    content.className = "content";
    reader.append(topbar, controlbar, content);
    nodes = {
      content,
      controlbar,
      modeButton,
      progress,
      previousUnit: null,
      unit: null,
      nextUnit: null,
      play: null,
      transport: null,
      textScroller: null,
      textMarkers: [],
      textRestoreScrollTop: null,
    };
    return reader;
  }

  function iconButton(icon: MobileIconName, accessibilityLabel: string, action: () => void): HTMLButtonElement {
    const button = global.document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.append(global.ReaderIcons.create(global.document, icon, 24));
    button.setAttribute("aria-label", accessibilityLabel);
    button.addEventListener("click", action);
    return button;
  }

  function showError() {
    getNodes().transport?.remove();
    getNodes().transport = null;
    getNodes().modeButton.hidden = true;
    getNodes().progress.textContent = "";
    const error = global.document.createElement("div");
    error.className = "error";
    const label = global.document.createElement("div");
    label.textContent = "文章を読み取れませんでした";
    const actions = global.document.createElement("div");
    actions.className = "error-actions";
    const retryButton = transportButton("やり直す", retry);
    const closeButton = transportButton("元に戻る", close);
    actions.append(retryButton, closeButton);
    error.append(label, actions);
    getNodes().content.replaceChildren(error);
  }

  function retry() {
    close();
    open();
  }

  function renderReader() {
    updateModeButton();
    if (mode === "rsvp") renderRsvpView();
    else renderTextView();
  }

  function renderTextView() {
    if (!content) return;
    pause();
    const scroller = global.document.createElement("div");
    scroller.className = "text-view";
    const articleNode = global.document.createElement("article");
    articleNode.className = "article";
    const blocks = content.readingContext?.blocks || [];
    const title = content.readingContext?.title || global.document.title || "";
    if (title && blocks[0]?.text !== title) {
      const heading = global.document.createElement("h1");
      heading.className = "article-title";
      heading.textContent = title;
      articleNode.append(heading);
    }
    const readableBlocks = blocks.length > 0 ? blocks : fallbackBlocks(content.text);
    const blockElements: HTMLElement[] = [];
    const anchorElements: HTMLElement[] = [];
    const figureElements: HTMLElement[] = [];
    for (const block of readableBlocks) {
      const element = createArticleBlock(block, anchorElements);
      blockElements.push(element);
    }
    appendArticleContent(articleNode, readableBlocks, blockElements, content.readingContext?.figures || [], figureElements);
    const positionMarkers = [...anchorElements, ...figureElements].sort((left, right) => (
      Number(left.dataset.sourceStart) - Number(right.dataset.sourceStart)
      || (left.dataset.readerPositionKind === right.dataset.readerPositionKind
        ? Number(left.dataset.figureIndex || 0) - Number(right.dataset.figureIndex || 0)
        : left.dataset.readerPositionKind === "figure" ? -1 : 1)
    ));
    scroller.append(articleNode);
    getNodes().content.replaceChildren(scroller);
    renderTextControls();
    getNodes().textRestoreScrollTop = null;
    const generation = sessionGeneration;
    const updatePosition = () => {
      if (!isCurrentSession(generation) || !nodes || !content) return;
      captureTextPosition(scroller, positionMarkers, getNodes().progress);
    };
    scroller.addEventListener("scroll", updatePosition, { passive: true });
    getNodes().textScroller = scroller;
    getNodes().textMarkers = positionMarkers;
    global.requestAnimationFrame(() => {
      if (!isCurrentSession(generation) || !nodes || !content) return;
      restoreTextPosition(scroller, positionMarkers);
      getNodes().textRestoreScrollTop = scroller.scrollTop;
    });
  }

  function fallbackBlocks(text: string): ReaderBlock[] {
    const blocks: ReaderBlock[] = [];
    let searchFrom = 0;
    for (const rawValue of text.split(/\n\s*\n|\n(?=\s*[\p{L}\p{N}「『（(])/u)) {
      const value = rawValue.trim();
      if (!value) continue;
      const start = text.indexOf(value, searchFrom);
      blocks.push({ text: value, kind: "paragraph", level: null, start, end: start + value.length });
      searchFrom = start + value.length;
    }
    return blocks;
  }

  function createArticleBlock(block: ReaderBlock, anchorElements: HTMLElement[]): HTMLElement {
    let tagName = "p";
    if (block.kind === "heading") tagName = `h${Math.min(6, Math.max(1, block.level || 2))}`;
    if (block.kind === "quote") tagName = "blockquote";
    if (block.kind === "preformatted") tagName = "pre";
    const element = global.document.createElement(tagName);
    if (tagName === "p") element.className = "paragraph";
    if (tagName === "h1") element.className = "article-title";
    element.dataset.sourceStart = String(block.start ?? 0);
    element.dataset.sourceEnd = String(block.end ?? (block.start ?? 0) + block.text.length);
    const sentences = global.Engine.splitSentenceSpans(
      block.text,
      content?.readingContext?.language || "ja",
    );
    if (sentences.length === 0) {
      element.textContent = block.text;
      element.setAttribute("data-reader-text-anchor", "true");
      element.dataset.readerTextAnchor = "true";
      element.dataset.readerPositionKind = "text";
      anchorElements.push(element);
      return element;
    }
    for (const sentence of sentences) {
      const anchor = global.document.createElement("span");
      anchor.className = "text-sentence";
      anchor.setAttribute("data-reader-text-anchor", "true");
      anchor.dataset.readerTextAnchor = "true";
      anchor.dataset.readerPositionKind = "text";
      anchor.dataset.sourceStart = String((block.start ?? 0) + sentence.start);
      anchor.dataset.sourceEnd = String((block.start ?? 0) + sentence.end);
      anchor.textContent = block.text.slice(sentence.start, sentence.end);
      element.append(anchor);
      anchorElements.push(anchor);
    }
    return element;
  }

  function appendArticleContent(
    article: HTMLElement,
    readableBlocks: ReaderBlock[],
    blockElements: HTMLElement[],
    articleFigures: ReaderFigure[],
    figureElements: HTMLElement[],
  ): void {
    const orderedFigures = articleFigures
      .map((figure, figureIndex) => ({ figure, figureIndex }))
      .sort((left, right) => (
        left.figure.sourceOffset - right.figure.sourceOffset
        || left.figureIndex - right.figureIndex
      ));
    let figureIndex = 0;
    readableBlocks.forEach((block, blockIndex) => {
      let currentFigure = orderedFigures[figureIndex];
      while (currentFigure && currentFigure.figure.sourceOffset <= block.start) {
        const figureElement = createArticleFigure(currentFigure.figure, currentFigure.figureIndex);
        article.append(figureElement);
        figureElements.push(figureElement);
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
      const blockElement = blockElements[blockIndex];
      if (blockElement) article.append(blockElement);
      currentFigure = orderedFigures[figureIndex];
      while (currentFigure && currentFigure.figure.sourceOffset <= block.end) {
        const figureElement = createArticleFigure(currentFigure.figure, currentFigure.figureIndex);
        article.append(figureElement);
        figureElements.push(figureElement);
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
    });
    let currentFigure = orderedFigures[figureIndex];
    while (currentFigure) {
      const figureElement = createArticleFigure(currentFigure.figure, currentFigure.figureIndex);
      article.append(figureElement);
      figureElements.push(figureElement);
      figureIndex += 1;
      currentFigure = orderedFigures[figureIndex];
    }
  }

  function createArticleFigure(figure: ReaderFigure, figureIndex: number): HTMLElement {
    const container = global.document.createElement("figure");
    container.className = "article-figure";
    container.dataset.sourceStart = String(figure.sourceOffset);
    container.dataset.sourceEnd = String(figure.sourceEnd);
    container.dataset.readerPositionKind = "figure";
    container.dataset.figureIndex = String(figureIndex);
    const image = global.document.createElement("img");
    image.src = figure.src;
    image.alt = figure.alt || figure.caption || "本文画像";
    image.loading = "lazy";
    image.decoding = "async";
    container.append(createVeiledImageSurface(image));
    if (figure.caption) {
      const caption = global.document.createElement("figcaption");
      caption.textContent = figure.caption;
      container.append(caption);
    }
    return container;
  }

  function createVeiledImageSurface(image: HTMLImageElement): HTMLElement {
    const surface = global.document.createElement("div");
    surface.className = "reader-image-surface";
    surface.setAttribute("data-reader-image-surface", "true");
    surface.setAttribute("data-reader-ignore-gesture", "true");
    const veil = global.document.createElement("div");
    veil.className = "reader-image-veil";
    veil.setAttribute("data-reader-image-veil", "true");
    const reveal = () => { veil.style.opacity = "0"; };
    const dim = () => { veil.style.opacity = "1"; };
    surface.addEventListener("pointerdown", reveal);
    surface.addEventListener("pointerup", dim);
    surface.addEventListener("pointercancel", dim);
    surface.addEventListener("pointerleave", dim);
    surface.append(image, veil);
    return surface;
  }

  function updateTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    progress: HTMLElement,
    preferVisualTop = false,
  ): void {
    if (!content) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const visibleTop = scrollerRect.top;
    const visibleBottom = scrollerRect.bottom;
    const readableTop = Math.min(visibleBottom, visibleTop + TEXT_VIEW_READABLE_TOP_PX);
    const readableBottom = Math.max(readableTop, visibleBottom - TEXT_VIEW_READABLE_BOTTOM_PX);
    let firstVisible: HTMLElement | undefined;
    let firstVisibleTop = Number.POSITIVE_INFINITY;
    let firstReadableSentence: HTMLElement | undefined;
    let firstReadableSentenceTop = Number.POSITIVE_INFINITY;
    let firstReadableFigure: HTMLElement | undefined;
    let firstReadableFigureTop = Number.POSITIVE_INFINITY;
    for (const element of positionMarkers) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= visibleTop || rect.top >= visibleBottom) continue;
      if (!preferVisualTop) {
        firstVisible = element;
        break;
      }
      if (rect.top < firstVisibleTop) {
        firstVisible = element;
        firstVisibleTop = rect.top;
      }
      const isFigure = element.dataset.readerPositionKind === "figure";
      const markerCenter = rect.top + rect.height / 2;
      const isReadableFigure = isFigure && markerCenter >= readableTop && markerCenter <= readableBottom;
      const isCompleteSentence = !isFigure && rect.top >= readableTop && rect.bottom <= readableBottom;
      if (isReadableFigure && rect.top < firstReadableFigureTop) {
        firstReadableFigure = element;
        firstReadableFigureTop = rect.top;
      }
      if (isCompleteSentence && rect.top < firstReadableSentenceTop) {
        firstReadableSentence = element;
        firstReadableSentenceTop = rect.top;
      }
    }
    const followingSentence = firstReadableFigure && firstReadableSentence
      && Number(firstReadableSentence.dataset.sourceStart) > Number(firstReadableFigure.dataset.sourceStart)
      ? firstReadableSentence
      : undefined;
    if (preferVisualTop) firstVisible = followingSentence || firstReadableFigure || firstReadableSentence || firstVisible;
    if (firstVisible) {
      const sourceOffset = Number(firstVisible.dataset.sourceStart);
      currentPosition = firstVisible.dataset.readerPositionKind === "figure"
        ? {
          kind: "figure",
          sourceOffset,
          figureIndex: Number(firstVisible.dataset.figureIndex),
        }
        : { kind: "text", sourceOffset };
      unitIndex = global.Engine.findUnitIndex(units, currentPosition.sourceOffset);
    }
    progress.textContent = `${global.Engine.calculateReadingProgress(
      currentPosition.sourceOffset,
      content.text.length,
    )}%`;
  }

  function captureTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    progress: HTMLElement,
    force = false,
  ): void {
    const restoredScrollTop = getNodes().textRestoreScrollTop;
    if (!force && (restoredScrollTop === null || Math.abs(scroller.scrollTop - restoredScrollTop) < 1)) return;
    updateTextPosition(scroller, positionMarkers, progress, force);
  }

  function restoreTextPosition(scroller: HTMLElement, positionMarkers: HTMLElement[]): void {
    const figureIndex = currentPosition.kind === "figure" ? currentPosition.figureIndex : -1;
    const exactFigure = currentPosition.kind !== "figure"
      ? undefined
      : positionMarkers.find((element) => (
          element.dataset.readerPositionKind === "figure"
          && Number(element.dataset.figureIndex) === figureIndex
        ));
    const containingMarker = positionMarkers.find((element) => (
      element.dataset.readerPositionKind === "text"
      && Number(element.dataset.sourceStart) <= currentPosition.sourceOffset
      && Number(element.dataset.sourceEnd) > currentPosition.sourceOffset
    ));
    let precedingMarker: HTMLElement | undefined;
    for (let index = positionMarkers.length - 1; index >= 0; index -= 1) {
      const marker = positionMarkers[index];
      if (marker && Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset) {
        precedingMarker = marker;
        break;
      }
    }
    const target = exactFigure || containingMarker || precedingMarker || positionMarkers[0];
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const targetY = targetRect.top - scrollerRect.top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, targetY - 72);
  }

  function renderRsvpView() {
    getNodes().textScroller = null;
    getNodes().textMarkers = [];
    getNodes().textRestoreScrollTop = null;
    const view = global.document.createElement("div");
    view.className = "rsvp-view";
    const focusArea = global.document.createElement("div");
    focusArea.className = "focus-area";
    const previousUnit = global.document.createElement("div");
    previousUnit.className = "context-unit previous";
    previousUnit.setAttribute("aria-hidden", "true");
    const unit = global.document.createElement("div");
    unit.className = "rsvp-unit";
    unit.setAttribute("data-reader-unit", "true");
    unit.setAttribute("aria-live", "off");
    unit.setAttribute("aria-atomic", "false");
    const nextUnit = global.document.createElement("div");
    nextUnit.className = "context-unit next";
    nextUnit.setAttribute("aria-hidden", "true");
    focusArea.append(previousUnit, unit, nextUnit);
    view.append(focusArea);
    view.addEventListener("pointerup", handleRsvpPointerUp);
    getNodes().content.replaceChildren(view);
    Object.assign(getNodes(), { previousUnit, unit, nextUnit });
    renderRsvpControls();
    contextSentenceIndex = null;
    if (!renderFlowItem() && global.document.visibilityState !== "hidden") play();
  }

  function transportButton(label: string, action: () => void): HTMLButtonElement {
    const button = global.document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderRsvpControls() {
    getNodes().transport?.remove();
    const dock = global.document.createElement("div");
    dock.className = "control-dock";
    const previous = transportButton("", goBackFromControl);
    previous.className = "dock-button previous";
    previous.setAttribute("aria-label", "1文戻る");
    previous.setAttribute("aria-keyshortcuts", "ArrowLeft");
    previous.append(global.ReaderIcons.create(global.document, "previous", 34));
    const playButton = transportButton("", togglePlayback);
    playButton.className = "dock-button play";
    playButton.setAttribute("aria-label", "再生");
    playButton.setAttribute("aria-keyshortcuts", "Space");
    playButton.append(global.ReaderIcons.create(global.document, "play", 34));
    dock.append(previous, playButton);
    getNodes().controlbar.append(dock);
    getNodes().play = playButton;
    getNodes().transport = dock;
  }

  function renderTextControls() {
    getNodes().transport?.remove();
    getNodes().play = null;
    getNodes().transport = null;
  }

  function toggleMode() {
    switchMode(mode === "rsvp" ? "text" : "rsvp");
  }

  function updateModeButton() {
    getNodes().modeButton.hidden = false;
    getNodes().modeButton.textContent = mode === "rsvp" ? "文章で読む" : "RSVPで読む";
  }

  function renderFlowItem(): boolean {
    const item = flowItems[flowIndex];
    if (!item) {
      pause();
      return true;
    }
    if (item.kind === "figure") {
      const figure = content?.readingContext?.figures?.[item.figureIndex];
      if (figure) {
        currentPosition = global.Engine.positionForFlowItem(item, units);
        showFigure(figure, item.figureIndex);
        return true;
      }
    }
    figurePanel?.remove();
    figurePanel = null;
    if (item.kind === "unit") unitIndex = item.unitIndex;
    renderUnit();
    return false;
  }

  function renderUnit() {
    if (!content) return;
    const value = units[unitIndex];
    const { unit, previousUnit, nextUnit, progress } = getNodes();
    if (!value || !unit || !previousUnit || !nextUnit) return;
    unit.textContent = value.text;
    unit.className = `rsvp-unit ${value.kind}`;
    unit.dataset.readerPositionKind = "text";
    unit.dataset.sourceStart = String(value.start);
    unit.dataset.sourceEnd = String(value.end);
    if (contextSentenceIndex !== value.sentenceIndex) {
      const context = global.Engine.surroundingSentences(units, unitIndex);
      previousUnit.textContent = context.previous;
      nextUnit.textContent = context.next;
      contextSentenceIndex = value.sentenceIndex;
      fadeContext(previousUnit);
      fadeContext(nextUnit);
    }
    currentPosition = { kind: "text", sourceOffset: value.start };
    progress.textContent = `${global.Engine.calculateReadingProgress(
      currentPosition.sourceOffset,
      content.text.length,
    )}%`;
    updatePlayButton();
  }

  function fadeContext(element: HTMLElement): void {
    if (!element.textContent || global.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.animate?.([{ opacity: 0.12 }, { opacity: 0.26 }], { duration: 120, easing: "ease-out" });
  }

  function switchMode(nextMode: ReadingMode): void {
    if (nextMode === mode) return;
    const previousFocus = readerActiveElement();
    clearPendingLeftTap();
    const currentFlow = flowItems[flowIndex];
    if (currentFlow) currentPosition = global.Engine.positionForFlowItem(currentFlow, units);
    figurePanel?.remove();
    figurePanel = null;
    if (nextMode === "rsvp") {
      const { textScroller, textMarkers, progress } = getNodes();
      const restoredScrollTop = getNodes().textRestoreScrollTop;
      const textPositionChanged = textScroller && (
        restoredScrollTop === null || Math.abs(textScroller.scrollTop - restoredScrollTop) >= 1
      );
      if (textScroller && textPositionChanged) captureTextPosition(textScroller, textMarkers, progress, true);
      if (currentPosition.kind === "figure") {
        flowIndex = global.Engine.findFlowIndexForPosition(flowItems, units, currentPosition);
      } else {
        const visibleUnit = global.Engine.findUnitIndex(units, currentPosition.sourceOffset);
        const sentenceStart = global.Engine.findSentenceStart(units, visibleUnit);
        flowIndex = global.Engine.findFlowIndexForPosition(
          flowItems,
          units,
          { kind: "text", sourceOffset: units[sentenceStart]?.start ?? currentPosition.sourceOffset },
        );
      }
      if (flowIndex < 0) flowIndex = 0;
    }
    mode = nextMode;
    renderReader();
    if (!containsReaderElement(previousFocus)) {
      global.requestAnimationFrame(() => findCloseButton()?.focus());
    }
  }

  function rebuildUnits() {
    if (!content?.text) return;
    const previousPosition = currentPosition;
    const locale = content?.readingContext?.language || "ja";
    const articleFigures = content.readingContext?.figures || [];
    const figureBoundaries = articleFigures.flatMap((figure) => [figure.sourceOffset, figure.sourceEnd]);
    const segmented = global.Engine.segmentText(content.text, locale, figureBoundaries)
      .map((unit) => {
        const value = unit.text.trim();
        const leadingWhitespace = unit.text.length - unit.text.trimStart().length;
        return { ...unit, text: value, start: unit.start + leadingWhitespace, end: unit.start + leadingWhitespace + value.length };
      })
      .filter((unit) => unit.text.trim().length > 0)
      .filter((unit) => !articleFigures.some((figure) => (
        figure.sourceEnd > figure.sourceOffset
        && unit.start >= figure.sourceOffset
        && unit.end <= figure.sourceEnd
      )));
    units = global.Engine.splitLongUnits(segmented, locale, maxGraphemesForViewport());
    rebuildFlowItems();
    flowIndex = global.Engine.findFlowIndexForPosition(flowItems, units, previousPosition);
    if (flowIndex < 0) flowIndex = 0;
    const item = flowItems[flowIndex];
    currentPosition = item
      ? global.Engine.positionForFlowItem(item, units)
      : { kind: "text", sourceOffset: previousPosition.sourceOffset };
    unitIndex = global.Engine.findUnitIndex(units, currentPosition.sourceOffset);
  }

  function rebuildFlowItems(): void {
    const articleFigures = content?.readingContext?.figures || [];
    flowItems = global.Engine.buildReadingFlow(units, articleFigures);
  }

  function maxGraphemesForViewport() {
    const availableWidth = Math.max(160, global.innerWidth - 48);
    return Math.min(12, Math.max(3, Math.floor(availableWidth / RSVP_FONT_SIZE)));
  }

  function handleViewportChange() {
    if (!overlay || !content) return;
    rebuildUnits();
    if (mode === "rsvp") renderFlowItem();
  }

  function togglePlayback() {
    if (pendingLeftTap !== null) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
    }
    if (figurePanel) advanceFromFigure();
    else if (playing) pause();
    else play();
    renderUnit();
  }

  function goBackFromControl(): void {
    previousSentence();
  }

  function handleRsvpPointerUp(event: PointerEvent): void {
    if (isReaderControl(event.target)) return;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : (global.innerWidth || 390) / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : (global.innerHeight || 844) / 2;
    const leftSide = clientX <= (global.innerWidth || 390) / 2;
    if (!leftSide) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      return;
    }

    const tapAt = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
    const closeToPreviousTap = tapAt - lastLeftTapAt <= 320
      && Math.hypot(clientX - lastLeftTapX, clientY - lastLeftTapY) <= 72;
    if (lastLeftTapAt > 0 && closeToPreviousTap) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      showRewindFeedback(clientX, clientY);
      previousSentence();
      return;
    }

    clearPendingLeftTap();
    lastLeftTapAt = tapAt;
    lastLeftTapX = clientX;
    lastLeftTapY = clientY;
    const generation = sessionGeneration;
    pendingLeftTap = global.setTimeout(() => {
      if (!isCurrentSession(generation)) return;
      pendingLeftTap = null;
      lastLeftTapAt = 0;
    }, 260);
  }

  function isReaderControl(target: EventTarget | null): boolean {
    let element = target as HTMLElement | null;
    while (element) {
      if (element.tagName === "BUTTON" || element.dataset?.readerIgnoreGesture === "true") return true;
      element = element.parentElement;
    }
    return false;
  }

  function clearPendingLeftTap(): void {
    if (pendingLeftTap !== null) global.clearTimeout(pendingLeftTap);
    pendingLeftTap = null;
  }

  function showRewindFeedback(clientX: number, clientY: number): void {
    const surface = getNodes().content;
    const rect = surface.getBoundingClientRect();
    const feedback = global.document.createElement("div");
    feedback.className = "rewind-feedback";
    feedback.setAttribute("aria-hidden", "true");
    feedback.style.left = `${clientX - rect.left}px`;
    feedback.style.top = `${clientY - rect.top}px`;
    const firstRing = global.document.createElement("span");
    firstRing.className = "rewind-ring";
    const secondRing = global.document.createElement("span");
    secondRing.className = "rewind-ring";
    const icon = global.ReaderIcons.create(global.document, "previous", 30);
    feedback.append(firstRing, secondRing, icon);
    surface.append(feedback);

    const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ringFrames = reducedMotion
      ? [{ opacity: 0.28 }, { opacity: 0 }]
      : [
          { opacity: 0.08, transform: "scale(.32)" },
          { opacity: 0.26, transform: "scale(.9)" },
          { opacity: 0, transform: "scale(2.15)" },
        ];
    const firstAnimation = firstRing.animate(ringFrames, {
      duration: reducedMotion ? 160 : 420,
      easing: "cubic-bezier(.22, 1, .36, 1)",
      fill: "forwards",
    });
    const secondAnimation = secondRing.animate(ringFrames, {
      duration: reducedMotion ? 160 : 420,
      delay: reducedMotion ? 0 : 80,
      easing: "cubic-bezier(.22, 1, .36, 1)",
      fill: "forwards",
    });
    icon.animate(
      reducedMotion
        ? [{ opacity: 0.72 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: "translateX(8px) scale(.9)" },
            { opacity: 0.72, transform: "translateX(0) scale(1)" },
            { opacity: 0, transform: "translateX(-8px) scale(.96)" },
          ],
      { duration: reducedMotion ? 160 : 360, easing: "ease-out", fill: "forwards" },
    );
    Promise.allSettled([firstAnimation.finished, secondAnimation.finished]).then(() => feedback.remove());
  }

  function play() {
    pause();
    playing = true;
    updatePlayButton();
    scheduleNext();
  }

  function pause() {
    playing = false;
    if (playbackTimer !== null) global.clearTimeout(playbackTimer);
    playbackTimer = null;
    updatePlayButton();
  }

  function handleVisibilityChange(): void {
    if (global.document.visibilityState === "hidden") pause();
  }

  function updatePlayButton() {
    const playButton = nodes?.play;
    if (!playButton) return;
    const state = playing ? "pause" : "play";
    if (playButton.dataset.state !== state) {
      playButton.replaceChildren(global.ReaderIcons.create(global.document, state, state === "pause" ? 30 : 34));
      playButton.dataset.state = state;
    }
    playButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
    playButton.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function scheduleNext() {
    if (!playing) return;
    const currentUnit = units[unitIndex];
    if (!currentUnit) {
      pause();
      return;
    }
    const nextFlow = flowItems[flowIndex + 1];
    const nextUnit = nextFlow?.kind === "unit" ? units[nextFlow.unitIndex] : undefined;
    const generation = sessionGeneration;
    playbackTimer = global.setTimeout(() => {
      if (!isCurrentSession(generation)) return;
      playbackTimer = null;
      if (flowIndex >= flowItems.length - 1) {
        pause();
        renderUnit();
        return;
      }
      flowIndex += 1;
      if (renderFlowItem()) return;
      scheduleNext();
    }, global.Engine.displayDuration(
      currentUnit,
      nextUnit,
      crossesSectionBoundary(currentUnit, nextUnit),
    ));
  }

  function showFigure(figure: ReaderFigure, figureIndex: number): void {
    pause();
    figurePanel?.remove();
    currentPosition = {
      kind: "figure",
      sourceOffset: figure.sourceOffset,
      figureIndex,
    };
    getNodes().progress.textContent = `${global.Engine.calculateReadingProgress(
      currentPosition.sourceOffset,
      content?.text.length || 0,
    )}%`;
    const panel = global.document.createElement("figure");
    panel.className = "rsvp-figure";
    panel.setAttribute("aria-label", "本文画像");
    panel.dataset.sourceStart = String(figure.sourceOffset);
    panel.dataset.sourceEnd = String(figure.sourceEnd);
    panel.dataset.readerPositionKind = "figure";
    panel.dataset.figureIndex = String(figureIndex);
    panel.addEventListener("pointerup", handleRsvpPointerUp);
    const image = global.document.createElement("img");
    image.src = figure.src;
    image.alt = figure.alt || figure.caption || "本文画像";
    panel.append(createVeiledImageSurface(image));
    if (figure.caption) {
      const caption = global.document.createElement("figcaption");
      caption.textContent = figure.caption;
      panel.append(caption);
    }
    getNodes().content.append(panel);
    figurePanel = panel;
  }

  function advanceFromFigure(): void {
    figurePanel?.remove();
    figurePanel = null;
    if (flowIndex >= flowItems.length - 1) {
      pause();
      return;
    }
    flowIndex += 1;
    if (!renderFlowItem()) play();
  }

  function seekToUnit(nextUnitIndex: number): void {
    unitIndex = Math.min(Math.max(nextUnitIndex, 0), Math.max(0, units.length - 1));
    const matchingFlowIndex = flowItems.findIndex((item) => (
      item.kind === "unit" && item.unitIndex === unitIndex
    ));
    flowIndex = matchingFlowIndex >= 0 ? matchingFlowIndex : 0;
    const item = flowItems[flowIndex];
    if (item) currentPosition = global.Engine.positionForFlowItem(item, units);
  }

  function crossesSectionBoundary(unit: ReaderUnit | undefined, nextUnit: ReaderUnit | undefined): boolean {
    if (!unit || !nextUnit) return false;
    const offsets = content?.readingContext?.sectionOffsets || [];
    return offsets.some((offset) => offset > unit.start && offset <= nextUnit.start);
  }

  function previousSentence() {
    clearPendingLeftTap();
    lastLeftTapAt = 0;
    const resumePlayback = playing;
    pause();
    if (figurePanel) {
      const figureOffset = Number(figurePanel.dataset.sourceStart);
      figurePanel.remove();
      figurePanel = null;
      const unitBeforeFigure = global.Engine.findUnitIndex(units, Math.max(0, figureOffset - 1));
      seekToUnit(global.Engine.findSentenceStart(units, unitBeforeFigure));
      renderFlowItem();
      play();
      return;
    }
    seekToUnit(global.Engine.findPreviousSentenceStart(units, unitIndex));
    renderFlowItem();
    if (resumePlayback) play();
  }

  function lockSourcePage() {
    global.document.documentElement.style.overflow = "hidden";
    if (global.document.body) global.document.body.style.overflow = "hidden";
  }

  function makeBackgroundInert(readerHost: HTMLElement | null): void {
    if (!readerHost || backgroundInert) return;
    backgroundInert = true;
    const documentChildren = Array.from(global.document.documentElement.children) as HTMLElement[];
    for (const element of documentChildren) {
      if (element === readerHost || element.contains?.(readerHost)) continue;
      const wasInert = element.inert === true;
      inertedElements.push({ element, wasInert });
      element.inert = true;
    }
  }

  function restoreBackgroundInert(): void {
    const entries = inertedElements;
    inertedElements = [];
    backgroundInert = false;
    for (const { element, wasInert } of entries) element.inert = wasInert;
  }

  function findCloseButton(): HTMLButtonElement | null {
    if (!overlay) return null;
    const find = (element: Element): HTMLButtonElement | null => {
      for (const child of Array.from(element.children)) {
        const candidate = child as HTMLElement;
        if (candidate.tagName.toLowerCase() === "button" && candidate.getAttribute?.("aria-label") === "readerを閉じる") {
          return candidate as HTMLButtonElement;
        }
        const nested = find(candidate);
        if (nested) return nested;
      }
      return null;
    };
    return find(overlay);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!overlay || event.repeat) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = focusableReaderElements();
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(readerActiveElement() as HTMLElement);
      const atStart = currentIndex === 0;
      const atEnd = currentIndex === focusable.length - 1;
      const outsideReader = currentIndex < 0;
      if (!outsideReader && !(event.shiftKey ? atStart : atEnd)) return;
      const nextIndex = event.shiftKey ? focusable.length - 1 : 0;
      event.preventDefault();
      focusable[nextIndex]?.focus();
      return;
    }
    if (mode !== "rsvp" || isEditableTarget(event) || isButtonTarget(event)) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      togglePlayback();
    } else if (event.code === "ArrowLeft" || event.key === "ArrowLeft") {
      event.preventDefault();
      previousSentence();
    }
  }

  function focusableReaderElements(): HTMLElement[] {
    if (!overlay) return [];
    const focusable: HTMLElement[] = [];
    const visit = (element: Element): void => {
      for (const child of Array.from(element.children)) {
        const candidate = child as HTMLElement;
        if (isFocusableReaderElement(candidate)) focusable.push(candidate);
        visit(candidate);
      }
    };
    visit(overlay);
    return focusable;
  }

  function isFocusableReaderElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    const hasHref = element.hasAttribute?.("href") === true;
    const tabIndex = element.getAttribute?.("tabindex");
    const explicitTabIndex = typeof tabIndex === "string" && tabIndex !== "-1";
    const isCandidate = tagName === "button"
      || hasHref
      || tagName === "input"
      || tagName === "select"
      || tagName === "textarea"
      || explicitTabIndex;
    if (!isCandidate) return false;
    if (element.hidden || element.getAttribute?.("hidden") !== null) return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    if ((element as HTMLButtonElement | HTMLInputElement).disabled === true) return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
    return true;
  }

  function readerActiveElement(): HTMLElement | null {
    const activeElement = shadow?.activeElement || (global.document as Document).activeElement;
    return activeElement && typeof (activeElement as HTMLElement).focus === "function"
      ? activeElement as HTMLElement
      : null;
  }

  function containsReaderElement(element: HTMLElement | null): boolean {
    if (!element || !overlay) return false;
    if (typeof overlay.contains === "function") return overlay.contains(element);
    let current: HTMLElement | null = element;
    while (current) {
      if (current === overlay) return true;
      current = current.parentElement;
    }
    return false;
  }

  function eventPath(event: KeyboardEvent): EventTarget[] {
    if (typeof event.composedPath === "function") return event.composedPath();
    return event.target ? [event.target] : [];
  }

  function isEditableTarget(event: KeyboardEvent): boolean {
    for (const target of eventPath(event)) {
      if (typeof target !== "object" || target === null) continue;
      const candidate = target as HTMLElement;
      const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
      if (candidate.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select") return true;
    }
    return false;
  }

  function isButtonTarget(event: KeyboardEvent): boolean {
    return eventPath(event).some((target) => (
      typeof target === "object"
      && target !== null
      && (target as HTMLElement).tagName?.toLowerCase() === "button"
    ));
  }

  function destroySessionState(): void {
    if (playbackTimer !== null) global.clearTimeout(playbackTimer);
    playbackTimer = null;
    clearPendingLeftTap();
    content = null;
    units = [];
    unitIndex = 0;
    flowItems = [];
    flowIndex = 0;
    contextSentenceIndex = null;
    playing = false;
    figurePanel?.remove();
    figurePanel = null;
    currentPosition = { kind: "text", sourceOffset: 0 };
    mode = "rsvp";
    nodes = null;
    opening = false;
    textFigureOffset = null;
    lastLeftTapAt = 0;
    lastLeftTapX = 0;
    lastLeftTapY = 0;
    destroyLaunchProgressIfPresent();
    launchFocus = null;
  }

  function destroyLaunchProgressIfPresent(): void {
    const progress = launchProgress;
    launchProgress = null;
    if (!progress) return;
    progress.animation?.cancel?.();
    progress.element.remove();
  }

  function restoreSourcePage(): void {
    if (sourceOverflow === null && sourceBodyOverflow === null && sourceScrollY === 0) return;
    global.document.documentElement.style.overflow = sourceOverflow ?? "";
    if (global.document.body && sourceBodyOverflow !== null) global.document.body.style.overflow = sourceBodyOverflow;
    global.scrollTo({ top: sourceScrollY, left: 0, behavior: "auto" });
    sourceScrollY = 0;
    sourceOverflow = null;
    sourceBodyOverflow = null;
  }

  function close(): void {
    sessionGeneration += 1;
    const restoreFocus = launchFocus;
    const currentOverlay = overlay;
    overlay = null;
    try {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      pause();
      currentOverlay?.remove();
      global.removeEventListener?.("keydown", handleKeyDown);
      destroySessionState();
    } finally {
      try {
        restoreSourcePage();
        if (handle) handle.hidden = false;
      } finally {
        restoreBackgroundInert();
        const focusTarget = restoreFocus && restoreFocus.isConnected !== false
          ? restoreFocus
          : handle;
        focusTarget?.focus?.();
      }
    }
  }

  function fadeHandleDuringScroll() {
    if (!handle || handle.hidden) return;
    handle.classList.add("scrolling");
    if (scrollFadeTimer !== null) global.clearTimeout(scrollFadeTimer);
    scrollFadeTimer = global.setTimeout(() => handle?.classList.remove("scrolling"), 320);
  }

  function nextPaint(): Promise<void> {
    return new Promise<void>((resolve) => {
      global.requestAnimationFrame(() => global.requestAnimationFrame(() => resolve()));
    });
  }

  return { install, open, close };
});
