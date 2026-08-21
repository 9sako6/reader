(function installMobileViewer(root: typeof globalThis, factory: (global: typeof globalThis) => ReaderMobileViewer) {
  if (root.MobileViewer) return;
  root.MobileViewer = factory(root);
})(globalThis, function createMobileViewer(global: typeof globalThis): ReaderMobileViewer {
  type ReadingMode = "rsvp" | "text";
  type MobileIconName = "previous" | "play" | "pause" | "close";
  interface MobileNodes {
    content: HTMLElement;
    controlbar: HTMLElement;
    modeButton: HTMLButtonElement;
    progress: HTMLElement;
    previousUnit: HTMLElement | null;
    unit: HTMLElement | null;
    nextUnit: HTMLElement | null;
    play: HTMLButtonElement | null;
  }

  const HOST_ID = "__reader-host";
  const RSVP_FONT_SIZE = 40;
  let shadow: ShadowRoot | null = null;
  let handle: HTMLButtonElement | null = null;
  let overlay: HTMLElement | null = null;
  let scrollFadeTimer: number | null = null;
  let sourceScrollY = 0;
  let sourceOverflow: string | null = null;
  let sourceBodyOverflow: string | null = null;
  let content: ReaderContent | null = null;
  let units: ReaderUnit[] = [];
  let unitIndex = 0;
  let currentOffset = 0;
  let contextSentenceIndex: number | null = null;
  let playbackTimer: number | null = null;
  let playing = false;
  let mode: ReadingMode = "rsvp";
  let nodes: MobileNodes | null = null;

  function getNodes(): MobileNodes {
    if (!nodes) throw new Error("reader shell is not available");
    return nodes;
  }

  function install() {
    if (!global.document?.documentElement || global.document.getElementById(HOST_ID)) return;
    const host = global.document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "closed" });
    shadow = root;
    root.append(createStyles());
    handle = createHandle();
    root.append(handle);
    global.document.documentElement.append(host);
    global.addEventListener("scroll", fadeHandleDuringScroll, { passive: true });
    global.addEventListener("resize", handleViewportChange, { passive: true });
  }

  function createStyles() {
    const style = global.document.createElement("style");
    style.textContent = `
      :host { --reader-background: #050505; --reader-surface: #171717; --reader-text: #f5f5f7; --reader-secondary: #c7c7cc; --reader-muted: #8e8e93; --reader-accent: #64d2ff; all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; color-scheme: dark; }
      * { box-sizing: border-box; }
      button, input { font: inherit; }
      .entry { position: fixed; right: 0; top: 62%; width: 44px; height: 52px; padding: 0; border: 0; background: transparent; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      .entry::after { content: ""; position: absolute; right: 0; top: 8px; width: 6px; height: 36px; border-radius: 6px 0 0 6px; background: var(--reader-accent); opacity: .82; box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.28); transition: opacity 160ms ease, width 160ms ease; }
      .entry:active::after, .entry:focus-visible::after { width: 10px; opacity: 1; }
      .entry.scrolling::after { opacity: .24; }
      .entry[hidden] { display: none; }
      .reader { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; background: var(--reader-background); color: var(--reader-text); pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
      .topbar { min-height: calc(58px + env(safe-area-inset-top)); padding: calc(8px + env(safe-area-inset-top)) 12px 8px; position: relative; display: flex; align-items: center; justify-content: flex-end; background: var(--reader-background); }
      .mode-button { min-width: 120px; min-height: 44px; padding: 0 12px; position: absolute; left: 50%; bottom: 8px; border: 0; background: transparent; color: var(--reader-secondary); font-size: 14px; font-weight: 600; white-space: nowrap; transform: translateX(-50%); -webkit-tap-highlight-color: transparent; }
      .mode-button:active { opacity: .52; transform: translateX(-50%) scale(.96); }
      .controlbar { min-height: calc(86px + env(safe-area-inset-bottom)); padding: 10px max(16px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); position: relative; display: flex; align-items: flex-start; justify-content: center; background: var(--reader-background); }
      .controlbar.text-mode { min-height: calc(44px + env(safe-area-inset-bottom)); padding: 0; }
      .control-dock { width: min(100%, 320px); min-height: 64px; display: grid; grid-template-columns: 1fr 64px 1fr; align-items: center; background: transparent; }
      .dock-button { min-width: 44px; min-height: 56px; padding: 0 14px; border: 0; background: transparent; color: var(--reader-text); font-size: 15px; font-weight: 600; white-space: nowrap; transition: opacity 100ms ease, transform 100ms ease; }
      .dock-button svg { display: block; margin: auto; }
      .dock-button:active { opacity: .52; transform: scale(.94); }
      .dock-button.play { width: 64px; height: 64px; min-height: 64px; padding: 0; }
      .icon-button { width: 44px; height: 44px; padding: 0; border: 0; background: transparent; color: var(--reader-text); display: grid; place-items: center; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: opacity 100ms ease, transform 100ms ease; }
      .icon-button svg { display: block; }
      .icon-button:active { opacity: .52; transform: scale(.94); }
      .content { min-height: 0; position: relative; overflow: hidden; }
      .loading, .error { position: absolute; inset: 0; display: grid; place-content: center; gap: 16px; padding: 32px; text-align: center; color: var(--reader-secondary); }
      .loading { visibility: hidden; animation: reader-reveal 0s 400ms forwards; }
      .loading-mark { width: 28px; height: 28px; margin: auto; border: 2px solid rgba(255,255,255,.18); border-top-color: var(--reader-accent); border-radius: 50%; animation: reader-spin .8s linear infinite; }
      .error-actions { display: flex; justify-content: center; gap: 10px; }
      .error-actions button { min-width: 112px; min-height: 44px; border: 0; border-radius: 14px; background: var(--reader-surface); color: var(--reader-text); }
      .text-view { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 56px max(20px, env(safe-area-inset-right)) 96px max(20px, env(safe-area-inset-left)); -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.3) 24px, #000 72px, #000 calc(100% - 96px), rgba(0,0,0,.3) calc(100% - 24px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.3) 24px, #000 72px, #000 calc(100% - 96px), rgba(0,0,0,.3) calc(100% - 24px), transparent 100%); }
      .article { max-width: 32em; margin: 0 auto; font-size: var(--reader-font-size, 18px); line-height: var(--reader-line-height, 1.82); letter-spacing: .01em; }
      .article-title { margin: 0 0 1.5em; font-size: 1.58em; line-height: 1.3; letter-spacing: -.02em; }
      .paragraph { margin: 0 0 1.35em; white-space: pre-wrap; overflow-wrap: anywhere; }
      .article h2, .article h3, .article h4, .article h5, .article h6 { margin: 2em 0 .8em; line-height: 1.35; }
      .article h2 { font-size: 1.28em; }
      .article h3, .article h4, .article h5, .article h6 { font-size: 1.08em; }
      .article blockquote { margin: 1.5em 0; padding: .25em 0 .25em 1em; border-left: 3px solid var(--reader-accent); color: var(--reader-secondary); }
      .article pre { margin: 1.5em 0; padding: 16px; overflow-x: auto; border-radius: 12px; background: var(--reader-surface); white-space: pre-wrap; }
      .progress { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: calc(12px + env(safe-area-inset-bottom)); color: var(--reader-muted); text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; pointer-events: none; }
      .rsvp-view { height: 100%; padding: 16px; }
      .focus-area { width: 100%; height: 100%; min-height: 0; position: relative; display: grid; place-items: center; text-align: center; }
      .context-unit { position: absolute; left: 24px; right: 24px; display: -webkit-box; overflow: hidden; color: var(--reader-muted); font-size: clamp(16px, 4.5vw, 20px); font-weight: 550; line-height: 1.4; opacity: .26; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .context-unit.previous { bottom: calc(50% + 82px); }
      .context-unit.next { top: calc(50% + 82px); }
      .rsvp-unit { min-height: 1.5em; max-width: calc(100vw - 40px); position: relative; z-index: 0; font-size: var(--reader-rsvp-font-size, 40px); font-weight: 650; line-height: 1.25; word-break: keep-all; overflow-wrap: normal; }
      .rsvp-unit.quote::before { content: ""; position: absolute; z-index: -1; inset: -12px -16px; border-radius: 14px; background: rgba(255,255,255,.055); }
      .rsvp-unit.aside { color: var(--reader-secondary); }
      @keyframes reader-spin { to { transform: rotate(360deg); } }
      @keyframes reader-reveal { to { visibility: visible; } }
      @media (prefers-reduced-motion: reduce) { .entry::after { transition: none; } .loading-mark { animation: none; border-color: var(--reader-accent); } }
      @media (prefers-reduced-motion: reduce) { .dock-button { transition: none; } }
      @media (prefers-contrast: more) { :host { --reader-secondary: #f5f5f7; --reader-muted: #f5f5f7; } }
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

  async function open() {
    if (overlay || !handle || !shadow) return;
    sourceScrollY = global.scrollY || 0;
    sourceOverflow = global.document.documentElement.style.overflow;
    sourceBodyOverflow = global.document.body?.style.overflow ?? null;
    handle.hidden = true;
    overlay = buildShell();
    shadow.append(overlay);
    lockSourcePage();
    showLoading();
    await nextPaint();
    try {
      content = global.Extractor.fromPage(global.document, global.Defuddle);
      if (!content?.text) throw new Error("content_not_found");
      rebuildUnits();
      if (units.length === 0) throw new Error("units_not_found");
      unitIndex = 0;
      currentOffset = 0;
      renderReader();
    } catch (error) {
      showError();
      global.console?.error?.("reader could not prepare this page", error);
    }
  }

  function buildShell() {
    const reader = global.document.createElement("section");
    reader.className = "reader";
    reader.setAttribute("role", "dialog");
    reader.setAttribute("aria-label", "reader");
    const topbar = global.document.createElement("header");
    topbar.className = "topbar";
    const modeButton = transportButton("", toggleMode);
    modeButton.className = "mode-button";
    const closeButton = iconButton("close", "readerを閉じる", close);
    topbar.append(modeButton, closeButton);
    const controlbar = global.document.createElement("footer");
    controlbar.className = "controlbar";
    const progress = global.document.createElement("div");
    progress.className = "progress";
    controlbar.append(progress);
    const content = global.document.createElement("main");
    content.className = "content";
    reader.append(topbar, content, controlbar);
    nodes = {
      content,
      controlbar,
      modeButton,
      progress,
      previousUnit: null,
      unit: null,
      nextUnit: null,
      play: null,
    };
    return reader;
  }

  function iconButton(icon: MobileIconName, accessibilityLabel: string, action: () => void): HTMLButtonElement {
    const button = global.document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.append(global.MobileIcons.create(global.document, icon, 24));
    button.setAttribute("aria-label", accessibilityLabel);
    button.addEventListener("click", action);
    return button;
  }

  function showLoading() {
    const loading = global.document.createElement("div");
    loading.className = "loading";
    const mark = global.document.createElement("div");
    mark.className = "loading-mark";
    const label = global.document.createElement("div");
    label.textContent = "文章を準備しています";
    loading.append(mark, label);
    getNodes().content.replaceChildren(loading);
  }

  function showError() {
    getNodes().controlbar.replaceChildren();
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
    for (const block of readableBlocks) {
      const element = createArticleBlock(block);
      articleNode.append(element);
      blockElements.push(element);
    }
    scroller.append(articleNode);
    getNodes().content.replaceChildren(scroller);
    renderTextControls();
    const updatePosition = () => updateTextPosition(scroller, blockElements, getNodes().progress);
    scroller.addEventListener("scroll", updatePosition, { passive: true });
    global.requestAnimationFrame(() => {
      restoreTextPosition(scroller, blockElements, readableBlocks);
      updatePosition();
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

  function createArticleBlock(block: ReaderBlock): HTMLElement {
    let tagName = "p";
    if (block.kind === "heading") tagName = `h${Math.min(6, Math.max(1, block.level || 2))}`;
    if (block.kind === "quote") tagName = "blockquote";
    if (block.kind === "preformatted") tagName = "pre";
    const element = global.document.createElement(tagName);
    if (tagName === "p") element.className = "paragraph";
    if (tagName === "h1") element.className = "article-title";
    element.textContent = block.text;
    element.dataset.sourceStart = String(block.start ?? 0);
    element.dataset.sourceEnd = String(block.end ?? (block.start ?? 0) + block.text.length);
    return element;
  }

  function updateTextPosition(scroller: HTMLElement, blockElements: HTMLElement[], progress: HTMLElement): void {
    if (!content) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const viewportCenter = scrollerRect.top + scroller.clientHeight / 2;
    const measurements = blockElements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        start: Number(element.dataset.sourceStart),
        end: Number(element.dataset.sourceEnd),
      };
    });
    currentOffset = global.Engine.sourceOffsetAtViewportCenter(measurements, viewportCenter);
    progress.textContent = `${global.Engine.calculateReadingProgress(currentOffset, content.text.length)}%`;
  }

  function restoreTextPosition(scroller: HTMLElement, blockElements: HTMLElement[], readableBlocks: ReaderBlock[]): void {
    const blockIndex = global.Engine.findBlockIndexForOffset(readableBlocks, currentOffset);
    const target = blockElements[blockIndex];
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const block = readableBlocks[blockIndex];
    if (!block) return;
    const offsetWithinBlock = block.end > block.start
      ? (currentOffset - block.start) / (block.end - block.start)
      : 0;
    const targetY = targetRect.top - scrollerRect.top + scroller.scrollTop + targetRect.height * Math.min(1, Math.max(0, offsetWithinBlock));
    scroller.scrollTop = Math.max(0, targetY - scroller.clientHeight / 2);
  }

  function renderRsvpView() {
    const view = global.document.createElement("div");
    view.className = "rsvp-view";
    const focusArea = global.document.createElement("div");
    focusArea.className = "focus-area";
    const previousUnit = global.document.createElement("div");
    previousUnit.className = "context-unit previous";
    previousUnit.setAttribute("aria-hidden", "true");
    const unit = global.document.createElement("div");
    unit.className = "rsvp-unit";
    const nextUnit = global.document.createElement("div");
    nextUnit.className = "context-unit next";
    nextUnit.setAttribute("aria-hidden", "true");
    focusArea.append(previousUnit, unit, nextUnit);
    view.append(focusArea);
    getNodes().content.replaceChildren(view);
    Object.assign(getNodes(), { previousUnit, unit, nextUnit });
    renderRsvpControls();
    contextSentenceIndex = null;
    play();
    renderUnit();
  }

  function transportButton(label: string, action: () => void): HTMLButtonElement {
    const button = global.document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderRsvpControls() {
    getNodes().controlbar.classList.remove("text-mode");
    const dock = global.document.createElement("div");
    dock.className = "control-dock";
    const previous = transportButton("", previousSentence);
    previous.className = "dock-button previous";
    previous.setAttribute("aria-label", "1文戻る");
    previous.append(global.MobileIcons.create(global.document, "previous", 34));
    const playButton = transportButton("", togglePlayback);
    playButton.className = "dock-button play";
    playButton.setAttribute("aria-label", "再生");
    playButton.append(global.MobileIcons.create(global.document, "play", 34));
    dock.append(previous, playButton);
    getNodes().controlbar.replaceChildren(dock, getNodes().progress);
    getNodes().play = playButton;
  }

  function renderTextControls() {
    getNodes().controlbar.classList.add("text-mode");
    getNodes().controlbar.replaceChildren(getNodes().progress);
    getNodes().play = null;
  }

  function toggleMode() {
    switchMode(mode === "rsvp" ? "text" : "rsvp");
  }

  function updateModeButton() {
    getNodes().modeButton.textContent = mode === "rsvp" ? "文章で読む" : "RSVPで読む";
  }

  function renderUnit() {
    if (!content) return;
    const value = units[unitIndex];
    const { unit, previousUnit, nextUnit, progress } = getNodes();
    if (!value || !unit || !previousUnit || !nextUnit) return;
    unit.textContent = value.text;
    unit.className = `rsvp-unit ${value.kind}`;
    if (contextSentenceIndex !== value.sentenceIndex) {
      const context = global.Engine.surroundingSentences(units, unitIndex);
      previousUnit.textContent = context.previous;
      nextUnit.textContent = context.next;
      contextSentenceIndex = value.sentenceIndex;
      fadeContext(previousUnit);
      fadeContext(nextUnit);
    }
    currentOffset = value.start;
    progress.textContent = `${global.Engine.calculateReadingProgress(value.end, content.text.length)}%`;
    updatePlayButton();
  }

  function fadeContext(element: HTMLElement): void {
    if (!element.textContent || global.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.animate?.([{ opacity: 0.12 }, { opacity: 0.26 }], { duration: 120, easing: "ease-out" });
  }

  function switchMode(nextMode: ReadingMode): void {
    if (nextMode === mode) return;
    if (nextMode === "rsvp") unitIndex = global.Engine.findUnitIndex(units, currentOffset);
    mode = nextMode;
    renderReader();
  }

  function rebuildUnits() {
    if (!content?.text) return;
    const locale = global.document.documentElement.lang || "ja";
    const segmented = global.Engine.segmentText(content.text, locale);
    units = global.Engine.splitLongUnits(segmented, locale, maxGraphemesForViewport());
    unitIndex = global.Engine.findUnitIndex(units, currentOffset);
  }

  function maxGraphemesForViewport() {
    const availableWidth = Math.max(160, global.innerWidth - 48);
    return Math.min(12, Math.max(3, Math.floor(availableWidth / RSVP_FONT_SIZE)));
  }

  function handleViewportChange() {
    if (!overlay || !content) return;
    rebuildUnits();
    if (mode === "rsvp") renderUnit();
  }

  function togglePlayback() {
    if (playing) pause();
    else play();
    renderUnit();
  }

  function play() {
    pause();
    playing = true;
    scheduleNext();
  }

  function pause() {
    playing = false;
    if (playbackTimer !== null) global.clearTimeout(playbackTimer);
    playbackTimer = null;
    updatePlayButton();
  }

  function updatePlayButton() {
    const playButton = getNodes().play;
    if (!playButton) return;
    const state = playing ? "pause" : "play";
    if (playButton.dataset.state !== state) {
      playButton.replaceChildren(global.MobileIcons.create(global.document, state, state === "pause" ? 30 : 34));
      playButton.dataset.state = state;
    }
    playButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
  }

  function scheduleNext() {
    if (!playing) return;
    const currentUnit = units[unitIndex];
    if (!currentUnit) {
      pause();
      return;
    }
    const nextUnit = units[unitIndex + 1];
    playbackTimer = global.setTimeout(() => {
      if (unitIndex >= units.length - 1) {
        pause();
        renderUnit();
        return;
      }
      unitIndex += 1;
      renderUnit();
      scheduleNext();
    }, global.Engine.displayDuration(
      currentUnit,
      nextUnit,
      crossesSectionBoundary(currentUnit, nextUnit),
    ));
  }

  function crossesSectionBoundary(unit: ReaderUnit | undefined, nextUnit: ReaderUnit | undefined): boolean {
    if (!unit || !nextUnit) return false;
    const offsets = content?.readingContext?.sectionOffsets || [];
    return offsets.some((offset) => offset > unit.start && offset <= nextUnit.start);
  }

  function previousSentence() {
    pause();
    unitIndex = global.Engine.findPreviousSentenceStart(units, unitIndex);
    renderUnit();
  }

  function lockSourcePage() {
    global.document.documentElement.style.overflow = "hidden";
    if (global.document.body) global.document.body.style.overflow = "hidden";
  }

  function close() {
    pause();
    overlay?.remove();
    overlay = null;
    content = null;
    units = [];
    mode = "rsvp";
    nodes = null;
    global.document.documentElement.style.overflow = sourceOverflow ?? "";
    if (global.document.body && sourceBodyOverflow !== null) global.document.body.style.overflow = sourceBodyOverflow;
    if (handle) handle.hidden = false;
    global.scrollTo({ top: sourceScrollY, left: 0, behavior: "auto" });
  }

  function fadeHandleDuringScroll() {
    if (!handle || handle.hidden) return;
    handle.classList.add("scrolling");
    if (scrollFadeTimer !== null) global.clearTimeout(scrollFadeTimer);
    scrollFadeTimer = global.setTimeout(() => handle?.classList.remove("scrolling"), 320);
  }

  function nextPaint(): Promise<void> {
    return new Promise<void>((resolve) => global.requestAnimationFrame(() => resolve()));
  }

  return { install, open, close };
});
