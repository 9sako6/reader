(function installMobileViewer(root: typeof globalThis, factory: (global: typeof globalThis) => ReaderMobileViewer) {
  if (root.MobileViewer) return;
  root.MobileViewer = factory(root);
})(globalThis, function createMobileViewer(global: typeof globalThis): ReaderMobileViewer {
  type ReadingMode = "rsvp" | "text";
  type FigureViewState =
    | { kind: "idle" }
    | { kind: "loading"; token: number; figureIndex: number }
    | { kind: "ready"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "failed"; token: number; figureIndex: number };
  type ReactReaderBlock = ReaderBlock & { sentenceSpans: SentenceSpan[] };
  interface LaunchProgress {
    startedAt: number;
    revealTimer: number | null;
    revealed: boolean;
  }
  const HOST_ID = "__reader-host";
  const LOADER_REVEAL_DELAY_MS = 200;
  const TEXT_VIEW_READABLE_TOP_PX = 72;
  const TEXT_VIEW_READABLE_BOTTOM_PX = 96;
  const RSVP_FONT_SIZE = 40;
  const PERFORMANCE_PHASE_TO_METRIC: Record<ReaderExtractionPhase, keyof ReaderExtractionMetrics> = {
    dominant_article: "dominantArticleMs",
    defuddle_parse: "defuddleMs",
    canonical_text: "indexMs",
    blocks_figures: "contextMs",
  };
  let shadow: ShadowRoot | null = null;
  let host: HTMLDivElement | null = null;
  let handle: HTMLButtonElement | null = null;
  let overlay: HTMLElement | null = null;
  let scrollFadeTimer: number | null = null;
  let sourceScrollY = 0;
  let sourceOverflow: string | null = null;
  let sourceBodyOverflow: string | null = null;
  let content: ReaderContent | null = null;
  let viewBlocks: ReactReaderBlock[] = [];
  let units: ReaderUnit[] = [];
  let flowItems: ReaderFlowItem[] = [];
  let currentPosition: ReaderPosition = { kind: "text", sourceOffset: 0 };
  let playbackTimer: number | null = null;
  let figureViewState: FigureViewState = { kind: "idle" };
  let reactFigureBrightness: "dimmed" | "revealed" = "dimmed";
  let figureLoadToken = 0;
  let figureLoadRevealTimerId: number | null = null;
  let opening = false;
  let controlsVisible = true;
  let pendingLeftTap: number | null = null;
  let lastLeftTapAt = 0;
  let lastLeftTapX = 0;
  let lastLeftTapY = 0;
  let launchFocus: HTMLElement | null = null;
  let inertedElements: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  let backgroundInert = false;
  let launchProgress: LaunchProgress | null = null;
  let sessionGeneration = 0;
  let preparationGeneration = 0;
  let preparationController: AbortController | null = null;
  let activePreparation: PreparationState = { kind: "idle" };
  let sessionState: ReaderSessionState | null = null;
  let sessionHandle: ReaderSessionHandle | null = null;
  let sessionInitPromise: Promise<void> | null = null;
  let pendingSessionCommands: ReaderSessionCommand[] = [];
  let sessionInitFailure = false;
  let sessionEnabled = false;
  let applyingSession = false;
  let retainedPageUrl: string | null = null;
  let sessionDismissed = false;
  let resumePlaybackOnReopen = false;
  let sessionLifecycleAttached = false;
  let reactViewMount: ReaderReactViewerMount | null = null;
  let reactViewHost: HTMLDivElement | null = null;
  let reactTextScroller: HTMLElement | null = null;
  let reactTextMarkers: HTMLElement[] = [];
  let reactTextRestoring = false;
  let reactTextRestoreGeneration = 0;
  let reactTextRestorePending = false;
  let reactTextRestoreScrollTop: number | null = null;
  let rewindFeedback: { left: number; top: number; id: number } | null = null;
  let rewindFeedbackId = 0;
  let rewindFeedbackClearTimer: number | null = null;
  const reactTextFigureCorrections = new WeakMap<HTMLElement, { scroller: HTMLElement; positionMarkers: HTMLElement[] }>();
  let performanceRenderMarked = false;
  let performanceControlsMarked = false;
  let performanceUnitMarked = false;
  let performanceReactInitStarted = false;
  let performanceReactInitMarked = false;

  function readingSessionState(): ReaderSessionObservableState | null {
    return sessionState?.phase === "reading" ? sessionState : null;
  }

  function sessionMode(): ReadingMode {
    return readingSessionState()?.mode ?? "rsvp";
  }

  function sessionFlowIndex(): number {
    return readingSessionState()?.flowIndex ?? 0;
  }

  function sessionUnitIndex(): number {
    const state = readingSessionState();
    if (typeof state?.unitIndex === "number") return state.unitIndex;
    const item = flowItems[sessionFlowIndex()];
    return item?.kind === "unit" ? item.unitIndex : 0;
  }

  function sessionIsPlaying(): boolean {
    return readingSessionState()?.playback === "playing";
  }

  function markPerformance(name: string): void {
    global.performance?.mark?.(name);
  }

  function prefersReducedMotion(): boolean {
    return global.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  function animateLoadingIndicator(element: HTMLElement, reducedMotion: boolean): (() => void) | undefined {
    if (reducedMotion || typeof element.animate !== "function") return undefined;
    const animation = element.animate(
      [
        { transform: "translateX(-100%) scaleX(.35)" },
        { transform: "translateX(220%) scaleX(.35)" },
      ],
      { duration: 1100, iterations: Infinity, easing: "linear" },
    );
    return () => animation.cancel?.();
  }

  function animateRewindFeedback(
    elements: { firstRing: HTMLElement; secondRing: HTMLElement; icon: SVGElement },
    reducedMotion: boolean,
    onDone: () => void,
  ): (() => void) | undefined {
    const { firstRing, secondRing, icon } = elements;
    if (typeof firstRing.animate !== "function" || typeof secondRing.animate !== "function" || typeof icon.animate !== "function") return undefined;
    const ringFrames = reducedMotion
      ? [{ opacity: 0.28 }, { opacity: 0 }]
      : [
        { opacity: 0.08, transform: "scale(.32)" },
        { opacity: 0.26, transform: "scale(.9)" },
        { opacity: 0, transform: "scale(2.15)" },
      ];
    const firstAnimation = firstRing.animate(ringFrames, { duration: reducedMotion ? 160 : 420, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
    const secondAnimation = secondRing.animate(ringFrames, { duration: reducedMotion ? 160 : 420, delay: reducedMotion ? 0 : 80, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
    const iconAnimation = icon.animate(
      reducedMotion
        ? [{ opacity: 0.72 }, { opacity: 0 }]
        : [
          { opacity: 0, transform: "translateX(8px) scale(.9)" },
          { opacity: 0.72, transform: "translateX(0) scale(1)" },
          { opacity: 0, transform: "translateX(-8px) scale(.96)" },
        ],
      { duration: reducedMotion ? 160 : 360, easing: "ease-out", fill: "forwards" },
    );
    let cancelled = false;
    Promise.allSettled([firstAnimation.finished, secondAnimation.finished, iconAnimation.finished]).then(() => {
      if (!cancelled) onDone();
    });
    return () => {
      cancelled = true;
      firstAnimation.cancel?.();
      secondAnimation.cancel?.();
      iconAnimation.cancel?.();
    };
  }

  function mountReactViewer(shadowRoot: ShadowRoot | null): void {
    if (!shadowRoot || reactViewMount) return;
    if (!globalThis.ReaderReactViewer || typeof globalThis.ReaderReactViewer.mount !== "function") throw new Error("reader_view_unavailable");
    const root = global.document.createElement("div");
    root.setAttribute("data-reader-react-root", "true");
    Object.assign(root.style, { position: "absolute", inset: "0", pointerEvents: "auto" });
    shadowRoot.append(root);
    performanceReactInitStarted = true;
    markPerformance("reader:react-init-start");
    try {
      reactViewMount = globalThis.ReaderReactViewer.mount(root);
      reactViewHost = root;
    } catch (error) {
      root.remove();
      performanceReactInitStarted = false;
      throw error;
    }
  }

  function unmountReactViewer(): void {
    const root = reactViewHost;
    reactViewMount?.unmount();
    root?.remove();
    reactViewMount = null;
    reactViewHost = null;
    performanceReactInitStarted = false;
    performanceReactInitMarked = false;
  }

  function reactViewModel(): unknown {
    if (activePreparation.kind === "preparing") {
      return { kind: "loading", slow: false, revealed: launchProgress?.revealed === true, reducedMotion: prefersReducedMotion(), mobile: true };
    }
    if (activePreparation.kind === "failed") {
      return { kind: "error", message: preparationFailureLabel(activePreparation.reason), canRetry: true, mobile: true };
    }
    const state = readingSessionState();
    if (state?.mode === "text") {
      return { kind: "text", language: content?.readingContext.language || "ja", blocks: viewBlocks, figures: content?.readingContext.figures || [], position: currentPosition, progress: content?.text ? global.Engine.calculateReadingProgress(currentPosition.sourceOffset, content.text.length) : 0, title: content?.readingContext.title || global.document.title || "", mobile: true };
    }
    const item = state ? flowItems[state.flowIndex] : flowItems[0];
    const unitIndex = state?.unitIndex ?? (item?.kind === "unit" ? item.unitIndex : 0);
    const figureIndex = item?.kind === "figure" ? item.figureIndex : null;
    const figure = figureIndex === null ? null : content?.readingContext.figures?.[figureIndex] || null;
    const figureStatus = figure && figureViewState.kind !== "idle" && figureViewState.figureIndex === figureIndex ? figureViewState.kind : figure ? "loading" : null;
    const unit = item?.kind === "unit" ? units[unitIndex] || null : null;
    const context = unit ? global.Engine.surroundingSentences(units, unitIndex) : { previous: "", next: "" };
    return { kind: "rsvp", previous: context.previous, next: context.next, unit, figure: figure && figureIndex !== null && figureStatus ? { figure, figureIndex, status: figureStatus, token: figureViewState.kind !== "idle" && figureViewState.figureIndex === figureIndex ? figureViewState.token : undefined, loadingVisible: figureStatus === "loading" && figureLoadRevealTimerId === null, brightness: reactFigureBrightness } : null, playing: state?.playback === "playing", controlsVisible, reducedMotion: prefersReducedMotion(), progress: content?.text ? global.Engine.calculateReadingProgress(currentPosition.sourceOffset, content.text.length) : 0, rewindFeedback, headings: content?.readingContext.headings || [], activeHeadingIndex: global.Engine.findActiveHeadingIndex(content?.readingContext.sectionTransitions || [], currentPosition.sourceOffset, content?.readingContext.initialHeadingIndex ?? -1), mobile: true };
  }

  function renderReactView(): void {
    if (!reactViewMount) return;
    const state = readingSessionState();
    const item = state ? flowItems[state.flowIndex] : flowItems[0];
    if (item?.kind === "figure") {
      if (figureViewState.kind === "idle" || figureViewState.figureIndex !== item.figureIndex) {
        invalidateFigureLoad();
        const token = figureLoadToken;
        figureViewState = { kind: "loading", token, figureIndex: item.figureIndex };
        figureLoadRevealTimerId = global.setTimeout(() => {
          figureLoadRevealTimerId = null;
          if (figureViewState.kind === "loading" && figureViewState.token === token) renderReactView();
        }, 100);
      }
    } else if (figureViewState.kind !== "idle") {
      invalidateFigureLoad();
    }
    reactViewMount.render(reactViewModel(), {
      close,
      cancel: () => {
        if (activePreparation.kind === "preparing") cancelOpening(Number(activePreparation.requestId));
        else close();
      },
      retry,
      switchToText: () => switchMode("text"),
      switchToRsvp: () => switchMode("rsvp"),
      previousSentence: goBackFromControl,
      rsvpPointerUp: handleRsvpPointerUp,
      togglePlayback,
      resumeFigure: advanceFromFigure,
      figureLoad: (figureIndex: number, token?: number) => settleReactFigure(figureIndex, true, token),
      figureError: (figureIndex: number, token?: number) => settleReactFigure(figureIndex, false, token),
      figureImage: (element: HTMLImageElement, figureIndex: number, token?: number) => {
        if (typeof token !== "number" || figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token || !element.complete) return;
        const capturedToken = token;
        void Promise.resolve().then(() => {
          if (element.isConnected === false || figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== capturedToken) return;
          settleReactFigure(figureIndex, element.naturalWidth > 0, capturedToken);
        });
      },
      toggleFigureBrightness: (figureIndex: number) => toggleReactFigureBrightness(figureIndex),
      rewindFeedbackDone: clearRewindFeedback,
      loadingAnimation: animateLoadingIndicator,
      rewindAnimation: animateRewindFeedback,
      textScroll: (element: HTMLElement | null) => {
        if (!element) {
          reactTextScroller = null;
          reactTextMarkers = [];
          return;
        }
        if (!content) return;
        reactTextScroller = element;
        reactTextMarkers = Array.from(element.querySelectorAll<HTMLElement>("[data-reader-position-kind=\"text\"], [data-reader-position-kind=\"figure\"]"));
        reactTextRestoreScrollTop = element.scrollTop;
        for (const figure of element.querySelectorAll<HTMLElement>("[data-reader-text-figure=\"true\"]")) {
          attachTextFigureLoadCorrection(element, figure, reactTextMarkers);
        }
        if (reactTextRestorePending) {
          scheduleReactTextRestore(element, reactTextMarkers);
        }
      },
      textPosition: (element: HTMLElement) => {
        if (reactTextRestoring) {
          if (reactTextRestoreScrollTop === null || Math.abs(element.scrollTop - reactTextRestoreScrollTop) < 1) return;
          if (reactTextRestorePending) {
            reactTextRestorePending = false;
            reactTextRestoreGeneration += 1;
          }
        }
        updateTextPosition(element, reactTextMarkers);
        reactTextRestoreScrollTop = element.scrollTop;
      },
    });
    if (performanceReactInitStarted && !performanceReactInitMarked) {
      performanceReactInitMarked = true;
      markPerformance("reader:react-init-end");
    }
    const model = reactViewModel() as { kind: string; unit?: ReaderUnit | null };
    if (model.kind === "rsvp") {
      if (!performanceControlsMarked) {
        performanceControlsMarked = true;
        markPerformance("reader:controls-ready");
      }
      if (model.unit && !performanceUnitMarked) {
        performanceUnitMarked = true;
        markPerformance("reader:first-unit");
      }
    }
  }

  function settleReactFigure(figureIndex: number, loaded: boolean, token?: number): void {
    if (typeof token !== "number" || figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token) return;
    if (figureLoadRevealTimerId !== null) {
      global.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    figureViewState = loaded
      ? { kind: "ready", token: figureViewState.token, figureIndex, brightness: "dimmed" }
      : { kind: "failed", token: figureViewState.token, figureIndex };
    renderReactView();
  }

  function toggleReactFigureBrightness(figureIndex: number): void {
    if (figureViewState.kind === "idle" || figureViewState.figureIndex !== figureIndex) return;
    reactFigureBrightness = reactFigureBrightness === "revealed" ? "dimmed" : "revealed";
    if (figureViewState.kind === "ready") figureViewState = { ...figureViewState, brightness: reactFigureBrightness };
    renderReactView();
  }

  function install() {
    if (!global.document?.documentElement || host) return;
    host = global.document.createElement("div");
    if (!global.document.getElementById(HOST_ID)) host.id = HOST_ID;
    host.dataset.readerOwned = "true";
    const root = host.attachShadow({ mode: "open" });
    shadow = root;
    root.append(createStyles());
    handle = createHandle();
    root.append(handle);
    global.document.documentElement.append(host);
    global.addEventListener("scroll", fadeHandleDuringScroll, { passive: true });
    global.addEventListener("resize", handleViewportChange, { passive: true });
    markPerformance("reader:bootstrap-ready");
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
      .entry.preparing { pointer-events: none; }
      .entry.preparing::after { width: 10px; opacity: 1; }
      .entry.scrolling::after { opacity: .24; }
      .entry[hidden] { display: none; }
      .launch-feedback { position: fixed; z-index: 3; inset: 0; pointer-events: auto; }
      .launch-loader { width: min(56vw, 360px); height: 3px; position: fixed; left: 50%; top: 50%; opacity: 0; transform: translate(-50%, -50%); pointer-events: none; will-change: opacity; }
      .launch-progress-track { width: 100%; height: 100%; overflow: hidden; border-radius: 999px; background: rgba(238,238,239,.24); }
      .launch-progress-indicator { width: 100%; height: 100%; border-radius: inherit; background: var(--reader-text); opacity: 1; transform: translateX(0) scaleX(.35); transform-origin: left center; will-change: transform; }
      .reader { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0,1fr); background: var(--reader-background); color: var(--reader-text); pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
      .topbar { min-height: calc(58px + env(safe-area-inset-top)); padding: calc(8px + env(safe-area-inset-top)) 12px 8px; position: relative; display: flex; align-items: center; justify-content: flex-end; background: var(--reader-background); }
      .mode-button { min-width: 120px; min-height: 44px; padding: 0 12px; position: absolute; z-index: 5; left: 50%; bottom: calc(6px + env(safe-area-inset-bottom)); border: 0; border-radius: 14px; background: rgba(5,5,5,.58); color: var(--reader-secondary); font-size: 14px; font-weight: 600; white-space: nowrap; transform: translateX(-50%); pointer-events: auto; -webkit-tap-highlight-color: transparent; }
      .mode-button:active { opacity: .52; transform: translateX(-50%) scale(.96); }
      .controlbar { height: calc(132px + env(safe-area-inset-bottom)); position: absolute; z-index: 4; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(5,5,5,.96), rgba(5,5,5,0)); pointer-events: none; }
      .control-dock { width: min(100% - 32px, 280px); min-height: 60px; position: absolute; left: 50%; bottom: calc(52px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: 1fr 64px 1fr; align-items: center; background: transparent; transform: translateX(-50%); pointer-events: auto; transition: opacity 140ms ease, transform 140ms ease; }
      .control-dock[hidden] { display: none; }
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
      @keyframes reader-indeterminate { from { transform: translateX(-100%) scaleX(.35); } to { transform: translateX(220%) scaleX(.35); } }
      @media (prefers-reduced-motion: reduce) {
        .entry::after, .dock-button, .control-dock, .icon-button, .reader-image-veil { transition: none; }
        .mode-button:active { transform: translateX(-50%); }
        .dock-button:active, .icon-button:active { transform: none; }
        .launch-loader { animation: none; }
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
    return generation === sessionGeneration && generation === preparationGeneration;
  }

  function destroyLaunchProgress(progress: LaunchProgress): void {
    if (progress.revealTimer !== null) global.clearTimeout(progress.revealTimer);
    if (launchProgress === progress) launchProgress = null;
  }

  async function open() {
    if (overlay || opening || !handle || !shadow) return;
    markPerformance("reader:tap");
    if (sessionDismissed && retainedPageUrl === global.location.href && activePreparation.kind === "ready" && readingSessionState()) {
      reopenRetainedSession();
      return;
    }
    if (sessionDismissed) destroyRetainedSession();
    if (!reactViewMount) mountReactViewer(shadow);
    if (!reactViewMount || !reactViewHost) throw new Error("reader_view_unavailable");
    performanceRenderMarked = false;
    performanceControlsMarked = false;
    performanceUnitMarked = false;
    sessionInitFailure = false;
    const generation = ++sessionGeneration;
    preparationGeneration = generation;
    opening = true;
    activePreparation = { kind: "preparing", requestId: String(generation), startedAt: Date.now() };
    attachSessionLifecycle();
    beginReaderSession(String(generation));
    renderReactView();
    launchFocus = handle;
    makeBackgroundInert(host);
    sourceScrollY = global.scrollY || 0;
    sourceOverflow = global.document.documentElement.style.overflow;
    sourceBodyOverflow = global.document.body?.style.overflow ?? null;
    handle.classList.add("preparing");
    const progress: LaunchProgress = {
      startedAt: Date.now(),
      revealTimer: null,
      revealed: false,
    };
    launchProgress = progress;
    progress.revealTimer = global.setTimeout(() => {
      if (!isCurrentSession(generation) || progress.revealed) return;
      progress.revealed = true;
      progress.revealTimer = null;
      if (handle) handle.hidden = true;
      renderReactView();
    }, LOADER_REVEAL_DELAY_MS);
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    markPerformance("reader:first-feedback");
    await nextPaint();
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    const controller = createAbortController();
    preparationController = controller;
    let preparationError: unknown = null;
    try {
      markPerformance("reader:extraction-start");
      const extractionOptions: ReaderExtractionOptions = { signal: controller.signal };
      const metrics: ReaderExtractionMetrics = {
        dominantArticleMs: 0,
        defuddleMs: 0,
        indexMs: 0,
        contextMs: 0,
      };
      if (global.__READER_PERFORMANCE_ENABLED) {
        extractionOptions.onPhase = (phase, durationMs) => {
          metrics[PERFORMANCE_PHASE_TO_METRIC[phase]] = durationMs;
        };
      }
      let extractedContent: ReaderContent | null;
      try {
        extractedContent = typeof global.Extractor.fromPageAsync === "function"
          ? await global.Extractor.fromPageAsync(global.document, global.Defuddle, extractionOptions)
          : await global.Extractor.fromPage(global.document, global.Defuddle);
      } finally {
        markPerformance("reader:extraction-end");
      }
      if (global.__READER_PERFORMANCE_ENABLED) global.__READER_PERFORMANCE_LAST_METRICS = metrics;
      if (!isCurrentSession(generation)) {
        destroyLaunchProgress(progress);
        return;
      }
      content = extractedContent;
      if (!content?.text) throw new Error("content_not_found");
      const locale = content.readingContext?.language || "ja";
      const sourceBlocks = content.readingContext?.blocks?.length ? content.readingContext.blocks : fallbackBlocks(content.text);
      viewBlocks = sourceBlocks.map((block) => ({ ...block, sentenceSpans: global.Engine.splitSentenceSpans(block.text, locale) }));
      rebuildUnits();
      markPerformance("reader:segmentation-end");
      if (units.length === 0) throw new Error("units_not_found");
      currentPosition = flowItems[0]
        ? global.Engine.positionForFlowItem(flowItems[0], units)
        : { kind: "text", sourceOffset: 0 };
    } catch (error) {
      if (!isCurrentSession(generation)) {
        destroyLaunchProgress(progress);
        return;
      }
      if (isAbortError(error) || controller.signal.aborted) {
        destroyLaunchProgress(progress);
        return;
      }
      preparationError = error;
    }
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    const elapsed = Date.now() - progress.startedAt;
    let launchProgressChanged = false;
    if (elapsed >= LOADER_REVEAL_DELAY_MS) {
      progress.revealed = true;
      if (progress.revealTimer !== null) global.clearTimeout(progress.revealTimer);
      progress.revealTimer = null;
      if (handle) handle.hidden = true;
      launchProgressChanged = true;
    }
    if (launchProgressChanged) renderReactView();
    if (!isCurrentSession(generation)) {
      destroyLaunchProgress(progress);
      return;
    }
    const reader = reactViewHost;
    if (!isCurrentSession(generation)) {
      reader.remove();
      destroyLaunchProgress(progress);
      return;
    }
    overlay = reader;
    global.addEventListener("keydown", handleKeyDown);
    destroyLaunchProgress(progress);
    handle.classList.remove("preparing");
    handle.hidden = true;
    lockSourcePage();
    if (!isCurrentSession(generation)) return;
    if (preparationError) {
      const reason = classifyPreparationFailure(preparationError);
      activePreparation = { kind: "failed", requestId: String(generation), reason };
      showError(reason);
    } else if (sessionInitFailure) {
      activePreparation = { kind: "failed", requestId: String(generation), reason: "session_unavailable" };
      showError("session_unavailable");
    } else {
      activePreparation = { kind: "ready", requestId: String(generation) };
      retainedPageUrl = global.location.href;
      dispatchSession({
        type: "prepareSucceeded",
        requestId: String(generation),
        flow: sessionPreparation(),
      });
      if (!isCurrentSession(generation)) return;
      renderReader();
    }
    global.requestAnimationFrame(() => {
      if (!isCurrentSession(generation)) return;
      findCloseButton()?.focus();
    });
    if (isCurrentSession(generation)) opening = false;
  }

  function createAbortController(): AbortController {
    if (typeof global.AbortController === "function") return new global.AbortController();
    let aborted = false;
    const signal = { get aborted() { return aborted; } } as AbortSignal;
    return {
      signal,
      abort() { aborted = true; },
    } as AbortController;
  }

  function isAbortError(error: unknown): boolean {
    return typeof error === "object"
      && error !== null
      && "name" in error
      && (error as { name?: unknown }).name === "AbortError";
  }

  function classifyPreparationFailure(error: unknown): PreparationFailure {
    if (error instanceof Error && error.message === "content_not_found") return "content_not_found";
    if (error instanceof Error && error.message === "unsupported_page") return "unsupported_page";
    if (error instanceof Error && error.message === "extraction_failed") return "extraction_failed";
    if (isAbortError(error)) return "extraction_failed";
    if (error instanceof Error && /cannot access|not supported|invalid url|restricted/iu.test(error.message)) {
      return "unsupported_page";
    }
    return "extraction_failed";
  }

  function cancelOpening(generation: number): void {
    if (!isCurrentSession(generation)) return;
    preparationController?.abort();
    dispatchSession({ type: "cancel", requestId: String(generation) });
    activePreparation = { kind: "cancelled", requestId: String(generation) };
    close();
  }

  function showError(reason: PreparationFailure) {
    if (reason !== "session_unavailable" && activePreparation.kind !== "idle") {
      dispatchSession({
        type: "prepareFailed",
        requestId: activePreparation.requestId,
        reason,
      });
    }
    renderReactView();
  }

  function preparationFailureLabel(reason: PreparationFailure): string {
    if (reason === "content_not_found") return "文章を読み取れませんでした";
    if (reason === "unsupported_page") return "このページはまだ開けません";
    return "文章を準備できませんでした";
  }

  function retry() {
    close();
    open();
  }

  function renderReader(): void {
    renderReactView();
    if (!performanceRenderMarked) {
      performanceRenderMarked = true;
      markPerformance("reader:first-render");
    }
  }

  function readerSessionAvailable(): boolean {
    const candidate = global.ReaderSession;
    return typeof candidate?.init === "function"
      && typeof candidate.create === "function"
      && typeof candidate.dispatch === "function";
  }

  function sessionPreparation(): ReaderSessionPreparation {
    const sourceText = content?.text || "";
    const sourceFigures = content?.readingContext?.figures || [];
    return {
      textLength: sourceText.length,
      units: units.map((unit, index) => {
        const nextUnit = units[index + 1];
        return {
          sentenceIndex: unit.sentenceIndex,
          kind: unit.kind,
          start: unit.start,
          end: unit.end,
          durationMs: global.Engine.displayDuration(
            unit,
            nextUnit,
            crossesSectionBoundary(unit, nextUnit),
          ),
        };
      }),
      figures: sourceFigures.map((figure) => ({
        sourceOffset: figure.sourceOffset,
        sourceEnd: figure.sourceEnd,
      })),
      flow: flowItems,
    };
  }

  function beginReaderSession(requestId: string): void {
    pendingSessionCommands = [{ type: "open", requestId }];
    if (!readerSessionAvailable()) {
      sessionInitFailure = true;
      return;
    }
    if (global.ReaderSession.ready()) {
      if (sessionHandle) {
        if (!applyingSession) dispatchSession({ type: "close" });
        global.ReaderSession.destroy(sessionHandle);
        sessionHandle = null;
        sessionState = null;
        sessionEnabled = false;
      }
      sessionHandle = global.ReaderSession.create();
      sessionState = sessionHandle.state;
      sessionEnabled = true;
      flushPendingSessionCommands();
      return;
    }
    if (!sessionInitPromise) {
      markPerformance("reader:session-init-start");
      markPerformance("reader:wasm-init-start");
      sessionInitPromise = global.ReaderSession.init()
        .then(() => {
          markPerformance("reader:session-init-end");
          markPerformance("reader:wasm-init-end");
          if (activePreparation.kind === "idle" || activePreparation.kind === "cancelled") return;
          if (sessionHandle) {
            if (!applyingSession) dispatchSession({ type: "close" });
            global.ReaderSession.destroy(sessionHandle);
            sessionHandle = null;
            sessionState = null;
            sessionEnabled = false;
          }
          sessionHandle = global.ReaderSession.create();
          sessionState = sessionHandle.state;
          sessionEnabled = true;
          flushPendingSessionCommands();
        })
        .catch(() => {
          sessionInitPromise = null;
          sessionInitFailure = true;
          if (activePreparation.kind === "ready") showError("session_unavailable");
        });
    }
  }

  function flushPendingSessionCommands(): void {
    const queued = pendingSessionCommands;
    pendingSessionCommands = [];
    for (const command of queued) dispatchSession(command, false);
    if (content && units.length > 0 && sessionState?.phase === "reading") {
      renderReader();
    }
  }

  function syncReaderSessionState(): void {
    const state = sessionState;
    if (!state) return;
    if (state.phase === "reading" && state.position) currentPosition = state.position;
  }

  function dispatchSession(command: ReaderSessionCommand, render = true): void {
    if (applyingSession) return;
    if (!sessionEnabled || !sessionHandle || !sessionState) {
      if (command.type === "open") pendingSessionCommands = [command];
      else pendingSessionCommands.push(command);
      return;
    }
    const wasFigure = sessionState.phase === "reading" && sessionState.currentKind === "figure";
    const transition = global.ReaderSession.dispatch(sessionHandle, command);
    sessionState = transition.state;
    syncReaderSessionState();
    if (!wasFigure && sessionState.phase === "reading" && sessionState.currentKind === "figure") {
      controlsVisible = true;
    }
    applyingSession = true;
    try {
      for (const effect of transition.effects) {
        if (effect.type === "cancelTimer") {
          if (playbackTimer !== null) global.clearTimeout(playbackTimer);
          playbackTimer = null;
        } else if (effect.type === "scheduleTick") {
          if (playbackTimer !== null) global.clearTimeout(playbackTimer);
          const scheduledHandle = sessionHandle;
          const scheduledTimerId = global.setTimeout(() => {
            if (playbackTimer !== scheduledTimerId) return;
            playbackTimer = null;
            if (
              !scheduledHandle
              || sessionHandle !== scheduledHandle
              || sessionState?.phase !== "reading"
              || sessionState.generation !== effect.generation
              || sessionState.playback !== "playing"
            ) return;
            dispatchSession({ type: "tick", generation: effect.generation });
          }, effect.delayMs);
          playbackTimer = scheduledTimerId;
        }
      }
      if (render) renderSessionState();
    } finally {
      applyingSession = false;
    }
  }

  function renderSessionState(): void {
    renderReactView();
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

  function attachTextFigureLoadCorrection(
    scroller: HTMLElement,
    figureElement: HTMLElement,
    positionMarkers: HTMLElement[],
  ): void {
    const existing = reactTextFigureCorrections.get(figureElement);
    if (existing) {
      existing.scroller = scroller;
      existing.positionMarkers = positionMarkers;
      return;
    }
    const correction = { scroller, positionMarkers };
    reactTextFigureCorrections.set(figureElement, correction);
    const surface = Array.from(figureElement.children).find((child) => child.tagName === "BUTTON");
    const image = surface && Array.from(surface.children).find((child) => child.tagName === "IMG") as HTMLImageElement | undefined;
    if (!image) return;
    const source = image.dataset.readerSource;
    const srcset = image.dataset.readerSrcset;
    const sizes = image.dataset.readerSizes;
    if (!source) return;
    delete image.dataset.readerSource;
    delete image.dataset.readerSrcset;
    delete image.dataset.readerSizes;
    const currentMarker = currentTextPositionMarker(correction.positionMarkers);
    const figureOffset = Number(figureElement.dataset.sourceStart);
    const markerOffset = Number(currentMarker?.dataset.sourceStart);
    const shouldCorrect = Boolean(
      currentMarker
      && Number.isFinite(figureOffset)
      && Number.isFinite(markerOffset)
      && figureOffset <= markerOffset,
    );
    const beforeTop = shouldCorrect && currentMarker
      ? currentMarker.getBoundingClientRect().top
      : 0;
    let settled = false;
    const adjustAfterDecode = async () => {
      if (settled) return;
      settled = true;
      if (!shouldCorrect || reactTextScroller !== correction.scroller) return;
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
      }
      if (reactTextScroller !== correction.scroller) return;
      const applyCorrection = () => {
        if (reactTextScroller !== correction.scroller) return;
        const afterTop = (currentMarker as HTMLElement).getBoundingClientRect().top;
        const delta = afterTop - beforeTop;
        if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
          reactTextRestoring = true;
          correction.scroller.scrollTop += delta;
          reactTextRestoreScrollTop = correction.scroller.scrollTop;
          scheduleReactTextRestoreRelease(false);
        }
      };
      if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(applyCorrection);
      else applyCorrection();
    };
    image.addEventListener("load", () => { void adjustAfterDecode(); });
    image.addEventListener("error", () => { void adjustAfterDecode(); });
    if (srcset !== undefined) image.srcset = srcset;
    if (sizes !== undefined) image.sizes = sizes;
    image.src = source;
    if (image.complete && image.naturalWidth > 0) void adjustAfterDecode();
  }

  function currentTextPositionMarker(positionMarkers: HTMLElement[]): HTMLElement | undefined {
    const position = currentPosition;
    if (position.kind === "figure") {
      return positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "figure"
        && Number(marker.dataset.figureIndex) === position.figureIndex
      ));
    }
    return positionMarkers.find((marker) => (
      marker.dataset.readerPositionKind === "text"
      && Number(marker.dataset.sourceStart) <= position.sourceOffset
      && Number(marker.dataset.sourceEnd) > position.sourceOffset
    )) || [...positionMarkers].reverse().find((marker) => (
      Number(marker.dataset.sourceStart) <= position.sourceOffset
    ));
  }

  function updateTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    preferVisualTop = false,
    syncSession = true,
  ): void {
    if (!content) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const visibleTop = scrollerRect.top;
    const visibleBottom = scrollerRect.bottom;
    const readableTop = Math.min(visibleBottom, visibleTop + TEXT_VIEW_READABLE_TOP_PX);
    const readableBottom = Math.max(readableTop, visibleBottom - TEXT_VIEW_READABLE_BOTTOM_PX);
    let firstVisible: HTMLElement | undefined;
    let firstVisibleTop = Number.POSITIVE_INFINITY;
    let firstReadable: HTMLElement | undefined;
    let firstReadableTop = Number.POSITIVE_INFINITY;
    for (const element of positionMarkers) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= visibleTop || rect.top >= visibleBottom) continue;
      if (rect.top < firstVisibleTop) {
        firstVisible = element;
        firstVisibleTop = rect.top;
      }
      const isFullyReadable = rect.top >= readableTop - 1 && rect.bottom <= readableBottom + 1;
      if (isFullyReadable && rect.top < firstReadableTop) {
        firstReadable = element;
        firstReadableTop = rect.top;
      }
    }
    const anchoredFigureIndex = currentPosition.kind === "figure" ? currentPosition.figureIndex : -1;
    const anchoredMarker = currentPosition.kind === "figure"
      ? positionMarkers.find((element) => (
        element.dataset.readerPositionKind === "figure"
        && Number(element.dataset.figureIndex) === anchoredFigureIndex
      ))
      : positionMarkers.find((element) => (
        element.dataset.readerPositionKind === "text"
        && Number(element.dataset.sourceStart) <= currentPosition.sourceOffset
        && Number(element.dataset.sourceEnd) > currentPosition.sourceOffset
      ));
    const anchoredRect = anchoredMarker?.getBoundingClientRect();
    const anchoredVisible = anchoredRect !== undefined
      && anchoredRect.bottom > visibleTop
      && anchoredRect.top < visibleBottom;
    const anchoredReadable = anchoredVisible
      && anchoredRect !== undefined
      && anchoredRect.top >= readableTop - 1
      && anchoredRect.bottom <= readableBottom + 1;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const lastFigureOffset = Math.max(...positionMarkers
      .filter((marker) => marker.dataset.readerPositionKind === "figure")
      .map((marker) => Number(marker.dataset.sourceStart))
      .filter((offset) => Number.isFinite(offset)), -1);
    const firstTextAfterFigure = lastFigureOffset >= 0
      ? positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "text"
        && Number(marker.dataset.sourceStart) > lastFigureOffset
      ))
      : undefined;
    const selected = anchoredReadable
      ? anchoredMarker
      : atBottom && firstTextAfterFigure
        ? firstTextAfterFigure
        : preferVisualTop
          ? firstReadable || (anchoredVisible ? anchoredMarker : firstVisible)
          : firstVisible;
    if (selected) {
      const sourceOffset = Number(selected.dataset.sourceStart);
      currentPosition = selected.dataset.readerPositionKind === "figure"
        ? {
          kind: "figure",
          sourceOffset,
          figureIndex: Number(selected.dataset.figureIndex),
        }
        : { kind: "text", sourceOffset };
      if (syncSession && !applyingSession) {
        dispatchSession({
          type: sessionMode() === "text" ? "switchToText" : "switchToRsvp",
          position: currentPosition,
        });
      }
    }
  }

  function captureTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    force = false,
    syncSession = true,
  ): void {
    const restoredScrollTop = reactTextRestoreScrollTop;
    if (!force && (restoredScrollTop === null || Math.abs(scroller.scrollTop - restoredScrollTop) < 1)) return;
    updateTextPosition(scroller, positionMarkers, force, syncSession);
    reactTextRestoreScrollTop = scroller.scrollTop;
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

  function scheduleReactTextRestoreRelease(invalidate = true): void {
    const generation = invalidate ? ++reactTextRestoreGeneration : reactTextRestoreGeneration;
    const release = () => {
      if (generation === reactTextRestoreGeneration && !reactTextRestorePending) reactTextRestoring = false;
    };
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(() => global.requestAnimationFrame(release));
    } else {
      release();
    }
  }

  function scheduleReactTextRestore(element: HTMLElement, positionMarkers: HTMLElement[]): void {
    const generation = ++reactTextRestoreGeneration;
    const apply = () => {
      if (generation !== reactTextRestoreGeneration || reactTextScroller !== element) return;
      restoreTextPosition(element, positionMarkers);
      reactTextRestoreScrollTop = element.scrollTop;
      reactTextRestorePending = false;
      const release = () => {
        if (generation === reactTextRestoreGeneration && reactTextScroller === element) reactTextRestoring = false;
      };
      if (typeof global.requestAnimationFrame === "function") {
        global.requestAnimationFrame(() => global.requestAnimationFrame(release));
      } else {
        release();
      }
    };
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(() => global.requestAnimationFrame(apply));
    } else {
      apply();
    }
  }

  function switchMode(nextMode: ReadingMode): void {
    const currentMode = sessionMode();
    if (nextMode === currentMode) return;
    const previousFocus = readerActiveElement();
    clearPendingLeftTap();
    const modeRestorePending = reactTextRestorePending;
    reactTextRestorePending = nextMode === "text";
    let capturedPosition = currentPosition;
    if (nextMode === "rsvp" && currentMode === "text") {
      const textScroller = reactTextScroller;
      const textMarkers = reactTextMarkers;
      const scrollChanged = textScroller && (reactTextRestoreScrollTop === null || Math.abs(textScroller.scrollTop - reactTextRestoreScrollTop) >= 1);
      if (!modeRestorePending || scrollChanged) {
        reactTextRestoring = true;
        if (textScroller) captureTextPosition(textScroller, textMarkers, true, false);
      }
      capturedPosition = currentPosition;
    } else if (currentMode === "rsvp") {
      reactTextRestoring = true;
      const currentFlow = flowItems[sessionFlowIndex()];
      if (currentFlow) currentPosition = global.Engine.positionForFlowItem(currentFlow, units);
    }
    invalidateFigureLoad();
    if (!applyingSession) {
      dispatchSession({
        type: nextMode === "text" ? "switchToText" : "switchToRsvp",
        position: capturedPosition,
      }, false);
    }
    if (nextMode === "rsvp") controlsVisible = true;
    renderSessionState();
    if (nextMode === "rsvp") scheduleReactTextRestoreRelease();
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
    if (!applyingSession) {
      dispatchSession({
        type: "rebuildUnits",
        units: sessionPreparation().units,
        position: previousPosition,
      });
    }
  }

  function rebuildFlowItems(): void {
    const articleFigures = content?.readingContext?.figures || [];
    flowItems = global.Engine.buildReadingFlow(units, articleFigures);
  }

  function maxGraphemesForViewport() {
    const availableWidth = Math.max(160, global.innerWidth - 48);
    return Math.min(12, Math.max(3, Math.floor(availableWidth / RSVP_FONT_SIZE) + 1));
  }

  function handleViewportChange() {
    if (!overlay || !content) return;
    rebuildUnits();
    renderSessionState();
  }

  function togglePlayback() {
    if (pendingLeftTap !== null) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
    }
    if (readingSessionState()?.currentKind === "figure") advanceFromFigure();
    else if (sessionIsPlaying()) pause();
    else play();
    showTransportControls();
  }

  function goBackFromControl(): void {
    previousSentence();
    showTransportControls();
  }

  function handleRsvpPointerUp(event: PointerEvent): void {
    if (isReaderControl(event.target)) return;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : (global.innerWidth || 390) / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : (global.innerHeight || 844) / 2;
    const leftSide = clientX <= (global.innerWidth || 390) / 2;
    if (!leftSide) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      toggleTransportControls();
      return;
    }

    const tapAt = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
    const closeToPreviousTap = tapAt - lastLeftTapAt <= 320
      && Math.hypot(clientX - lastLeftTapX, clientY - lastLeftTapY) <= 72;
    if (lastLeftTapAt > 0 && closeToPreviousTap) {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      setRewindFeedback(clientX, clientY);
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
      toggleTransportControls();
    }, 260);
  }

  function toggleTransportControls(): void {
    controlsVisible = !controlsVisible;
    renderReactView();
  }

  function showTransportControls(): void {
    if (controlsVisible) return;
    controlsVisible = true;
    renderReactView();
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

  function setRewindFeedback(clientX: number, clientY: number): void {
    const surface = reactViewHost?.querySelector<HTMLElement>(".content") || reactViewHost || overlay;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    rewindFeedbackId += 1;
    rewindFeedback = { left: clientX - rect.left, top: clientY - rect.top, id: rewindFeedbackId };
    renderReactView();
  }

  function clearRewindFeedback(id: number): void {
    if (!rewindFeedback || rewindFeedback.id !== id) return;
    rewindFeedback = null;
    if (rewindFeedbackClearTimer !== null) global.clearTimeout(rewindFeedbackClearTimer);
    rewindFeedbackClearTimer = global.setTimeout(() => {
      rewindFeedbackClearTimer = null;
      renderReactView();
    }, 0);
  }

  function play() {
    if (!applyingSession) {
      dispatchSession({ type: "play" });
      return;
    }
  }

  function pause() {
    if (!applyingSession) {
      dispatchSession({ type: "pause" });
      return;
    }
  }

  function handleVisibilityChange(): void {
    if (global.document.visibilityState === "hidden") {
      if (!applyingSession) dispatchSession({ type: "visibilityHidden" });
    }
  }

  function attachSessionLifecycle(): void {
    if (sessionLifecycleAttached) return;
    global.document.addEventListener?.("visibilitychange", handleVisibilityChange);
    sessionLifecycleAttached = true;
  }

  function detachSessionLifecycle(): void {
    if (!sessionLifecycleAttached) return;
    global.document.removeEventListener?.("visibilitychange", handleVisibilityChange);
    sessionLifecycleAttached = false;
  }

  function invalidateFigureLoad(): void {
    figureLoadToken += 1;
    figureViewState = { kind: "idle" };
    reactFigureBrightness = "dimmed";
    if (figureLoadRevealTimerId !== null) {
      global.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
  }

  function advanceFromFigure(): void {
    dispatchSession({ type: "resumeFromFigure" });
    showTransportControls();
  }

  function activeHeadingAt(offset: number): number {
    const readingContext = content?.readingContext;
    return global.Engine.findActiveHeadingIndex(
      readingContext?.sectionTransitions || [],
      offset,
      readingContext?.initialHeadingIndex ?? -1,
    );
  }

  function crossesSectionBoundary(unit: ReaderUnit | undefined, nextUnit: ReaderUnit | undefined): boolean {
    if (!unit || !nextUnit) return false;
    return activeHeadingAt(unit.start) !== activeHeadingAt(nextUnit.start);
  }

  function previousSentence() {
    dispatchSession({ type: "previousSentence" });
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
    if (sessionMode() !== "rsvp" || isEditableTarget(event) || isButtonTarget(event)) return;
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

  function reopenRetainedSession(): void {
    if (!handle || !shadow) return;
    const generation = ++sessionGeneration;
    preparationGeneration = generation;
    opening = true;
    performanceRenderMarked = false;
    performanceControlsMarked = false;
    performanceUnitMarked = false;
    mountReactViewer(shadow);
    if (!reactViewMount || !reactViewHost) throw new Error("reader_view_unavailable");
    launchFocus = handle;
    makeBackgroundInert(host);
    sourceScrollY = global.scrollY || 0;
    sourceOverflow = global.document.documentElement.style.overflow;
    sourceBodyOverflow = global.document.body?.style.overflow ?? null;
    handle.classList.remove("preparing");
    handle.hidden = true;
    controlsVisible = true;
    attachSessionLifecycle();
    overlay = reactViewHost;
    global.addEventListener("keydown", handleKeyDown);
    lockSourcePage();
    sessionDismissed = false;
    const shouldResume = resumePlaybackOnReopen;
    resumePlaybackOnReopen = false;
    markPerformance("reader:first-feedback");
    if (shouldResume && sessionMode() === "rsvp") dispatchSession({ type: "play" });
    else renderReader();
    global.requestAnimationFrame(() => {
      if (!isCurrentSession(generation)) return;
      findCloseButton()?.focus();
    });
    if (isCurrentSession(generation)) opening = false;
  }

  function dismissReadySession(): void {
    sessionGeneration += 1;
    preparationGeneration += 1;
    detachSessionLifecycle();
    const restoreFocus = launchFocus;
    resumePlaybackOnReopen = sessionIsPlaying();
    if (sessionHandle && !applyingSession) dispatchSession({ type: "pause" }, false);
    overlay = null;
    clearPendingLeftTap();
    lastLeftTapAt = 0;
    if (rewindFeedbackClearTimer !== null) global.clearTimeout(rewindFeedbackClearTimer);
    rewindFeedbackClearTimer = null;
    rewindFeedback = null;
    invalidateFigureLoad();
    reactTextScroller = null;
    reactTextMarkers = [];
    reactTextRestoreGeneration += 1;
    reactTextRestoring = false;
    reactTextRestorePending = false;
    reactTextRestoreScrollTop = null;
    unmountReactViewer();
    global.removeEventListener?.("keydown", handleKeyDown);
    opening = false;
    launchFocus = null;
    sessionDismissed = true;
    try {
      restoreSourcePage();
      if (handle) {
        handle.classList.remove("preparing");
        handle.hidden = false;
      }
    } finally {
      restoreBackgroundInert();
      const focusTarget = restoreFocus && restoreFocus.isConnected !== false
        ? restoreFocus
        : handle;
      focusTarget?.focus?.();
    }
  }

  function destroyRetainedSession(): void {
    sessionGeneration += 1;
    preparationGeneration += 1;
    if (sessionHandle && !applyingSession) {
      dispatchSession({ type: "close" }, false);
      global.ReaderSession.destroy(sessionHandle);
    }
    destroySessionState();
  }

  function destroySessionState(): void {
    unmountReactViewer();
    if (playbackTimer !== null) global.clearTimeout(playbackTimer);
    playbackTimer = null;
    clearPendingLeftTap();
    if (rewindFeedbackClearTimer !== null) global.clearTimeout(rewindFeedbackClearTimer);
    rewindFeedbackClearTimer = null;
    content = null;
    viewBlocks = [];
    units = [];
    flowItems = [];
    invalidateFigureLoad();
    currentPosition = { kind: "text", sourceOffset: 0 };
    opening = false;
    controlsVisible = true;
    lastLeftTapAt = 0;
    lastLeftTapX = 0;
    lastLeftTapY = 0;
    destroyLaunchProgressIfPresent();
    preparationController = null;
    activePreparation = { kind: "idle" };
    launchFocus = null;
    sessionState = null;
    sessionHandle = null;
    sessionEnabled = false;
    pendingSessionCommands = [];
    sessionInitFailure = false;
    applyingSession = false;
    retainedPageUrl = null;
    sessionDismissed = false;
    resumePlaybackOnReopen = false;
    reactTextScroller = null;
    reactTextMarkers = [];
    reactTextRestoreGeneration += 1;
    reactTextRestoring = false;
    reactTextRestorePending = false;
    reactTextRestoreScrollTop = null;
    rewindFeedback = null;
  }

  function destroyLaunchProgressIfPresent(): void {
    const progress = launchProgress;
    launchProgress = null;
    if (!progress) return;
    destroyLaunchProgress(progress);
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
    if (activePreparation.kind === "ready" && readingSessionState() && content) {
      dismissReadySession();
      return;
    }
    sessionGeneration += 1;
    preparationGeneration += 1;
    detachSessionLifecycle();
    preparationController?.abort();
    const restoreFocus = launchFocus;
    const currentOverlay = overlay;
    overlay = null;
    try {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      if (activePreparation.kind === "preparing") {
        dispatchSession({ type: "cancel", requestId: activePreparation.requestId });
      }
      if (sessionHandle && !applyingSession) {
        dispatchSession({ type: "close" });
        global.ReaderSession.destroy(sessionHandle);
      }
      sessionHandle = null;
      sessionEnabled = false;
      sessionState = null;
      pendingSessionCommands = [];
      if (playbackTimer !== null) global.clearTimeout(playbackTimer);
      playbackTimer = null;
      currentOverlay?.remove();
      global.removeEventListener?.("keydown", handleKeyDown);
      destroySessionState();
    } finally {
      try {
        restoreSourcePage();
        if (handle) {
          handle.classList.remove("preparing");
          handle.hidden = false;
        }
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
