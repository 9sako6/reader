import viewerStyles from "./viewer.css";
import {
  createRsvpTextMeasurer,
  prepareReaderDocument,
  presentReader,
  reflowReaderDocument,
  sessionPreparation as prepareSession,
  type PreparedReaderDocument,
  type ReaderPresentationUiState,
} from "../../../../../packages/presentation/src/presentation";

(function installMobileViewer(root: typeof globalThis, factory: (global: typeof globalThis) => ReaderMobileViewer) {
  if (root.MobileViewer) return;
  root.MobileViewer = factory(root);
})(globalThis, function createMobileViewer(global: typeof globalThis): ReaderMobileViewer {
  type ReadingMode = "rsvp" | "text";
  type FigureViewState =
    | { kind: "idle" }
    | { kind: "loading"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "ready"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "failed"; token: number; figureIndex: number };
  interface LaunchProgress {
    startedAt: number;
    revealTimer: number | null;
    revealed: boolean;
  }
  const HOST_ID = "__reader-host";
  const LOADER_REVEAL_DELAY_MS = 200;
  const TEXT_VIEW_READABLE_TOP_PX = 72;
  const TEXT_VIEW_READABLE_BOTTOM_PX = 96;
  const PERFORMANCE_PHASE_TO_METRIC: Record<ReaderExtractionPhase, keyof ReaderExtractionMetrics> = {
    dominant_article: "dominantArticleMs",
    defuddle_parse: "defuddleMs",
    canonical_text: "indexMs",
    blocks_figures: "contextMs",
  };
  let shadow: ShadowRoot | null = null;
  let host: HTMLDivElement | null = null;
  let rootStyle: HTMLStyleElement | null = null;
  let handle: HTMLButtonElement | null = null;
  let overlay: HTMLElement | null = null;
  let scrollFadeTimer: number | null = null;
  let sourceScrollY = 0;
  let sourceOverflow: string | null = null;
  let sourceBodyOverflow: string | null = null;
  let preparedDocument: PreparedReaderDocument | null = null;
  let figureViewState: FigureViewState = { kind: "idle" };
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
  let uiGeneration = 0;
  let preparationController: AbortController | null = null;
  let sessionState: ReaderSessionState | null = null;
  let sessionHandle: ReaderSessionHandle | null = null;
  let applyingSession = false;
  let retainedPageUrl: string | null = null;
  let sessionDismissed = false;
  let resumePlaybackOnReopen = false;
  let sessionLifecycleAttached = false;
  let reactViewMount: ReaderViewMount<"mobile"> | null = null;
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
  const measureRsvpText = createRsvpTextMeasurer(global.document);
  let rsvpFrameWidth = 0;
  let performanceReactInitStarted = false;
  let performanceReactInitMarked = false;

  function readingSessionState(): Extract<ReaderSessionState, { phase: "reading" }> | null {
    return sessionState?.phase === "reading" ? sessionState : null;
  }

  function sessionMode(): ReadingMode {
    return readingSessionState()?.mode ?? "rsvp";
  }

  function sessionFlowIndex(): number {
    return readingSessionState()?.flowIndex ?? 0;
  }

  function sessionIsPlaying(): boolean {
    return readingSessionState()?.playback === "playing";
  }

  function sessionPosition(): ReaderPosition {
    const state = readingSessionState();
    if (state) return state.position;
    const first = preparedDocument?.flow[0];
    return first && preparedDocument
      ? global.Engine.positionForFlowItem(first, preparedDocument.frames)
      : { kind: "text", sourceOffset: 0 };
  }

  function isPreparingRequest(requestId: string): boolean {
    return sessionState?.phase === "preparing" && sessionState.requestId === requestId;
  }

  function currentRsvpFrameLayout() {
    const viewportWidth = global.innerWidth || global.document.documentElement.clientWidth || 320;
    return {
      maxWidth: Math.max(1, viewportWidth - 40),
      measureText: measureRsvpText,
    };
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
    if (!globalThis.ReaderView || typeof globalThis.ReaderView.mount !== "function") throw new Error("reader_view_unavailable");
    const root = global.document.createElement("div");
    root.setAttribute("data-reader-react-root", "true");
    Object.assign(root.style, { position: "absolute", inset: "0", pointerEvents: "auto" });
    shadowRoot.append(root);
    if (rootStyle) shadowRoot.append(rootStyle);
    performanceReactInitStarted = true;
    markPerformance("reader:react-init-start");
    try {
      reactViewMount = globalThis.ReaderView.mount(root, { layout: "mobile" });
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

  function reactScreen(): ReaderScreen {
    const figure = figureViewState.kind === "loading"
      ? { ...figureViewState, loadingVisible: figureLoadRevealTimerId === null }
      : figureViewState;
    const ui: ReaderPresentationUiState = {
      loadingSlow: false,
      loadingRevealed: launchProgress?.revealed === true,
      loadingCover: false,
      controlsVisible,
      reducedMotion: prefersReducedMotion(),
      rewindFeedback,
      figure,
    };
    return presentReader(preparedDocument, sessionState, ui);
  }

  function renderReactView(): void {
    if (!reactViewMount) return;
    const state = readingSessionState();
    const item = state ? preparedDocument?.flow[state.flowIndex] : preparedDocument?.flow[0];
    if (item?.kind === "figure") {
      if (figureViewState.kind === "idle" || figureViewState.figureIndex !== item.figureIndex) {
        invalidateFigureLoad();
        const token = figureLoadToken;
        const figure = preparedDocument?.figures[item.figureIndex];
        if (figure?.kind === "code" || (figure?.kind === "mermaid" && !figure.src)) {
          figureViewState = { kind: "ready", token, figureIndex: item.figureIndex, brightness: "revealed" };
        } else {
          figureViewState = { kind: "loading", token, figureIndex: item.figureIndex, brightness: "dimmed" };
          figureLoadRevealTimerId = global.setTimeout(() => {
            figureLoadRevealTimerId = null;
            if (figureViewState.kind === "loading" && figureViewState.token === token) renderReactView();
          }, 100);
        }
      }
    } else if (figureViewState.kind !== "idle") {
      invalidateFigureLoad();
    }
    const screen = reactScreen();
    reactViewMount.render(screen, {
      close,
      cancel: () => {
        if (sessionState?.phase === "preparing") cancelOpening(Number(sessionState.requestId));
        else close();
      },
      retry,
      switchToText: () => switchMode("text"),
      switchToRsvp: () => switchMode("rsvp"),
      previousSentence: goBackFromControl,
      rsvpPointerUp: handleRsvpPointerUp,
      togglePlayback,
      resumeFigure: advanceFromFigure,
      figureLoad: (figureIndex: number, token: number) => settleReactFigure(figureIndex, true, token),
      figureError: (figureIndex: number, token: number) => settleReactFigure(figureIndex, false, token),
      figureImage: (element: HTMLImageElement, figureIndex: number, token: number) => {
        if (figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token || !element.complete) return;
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
        if (!preparedDocument) return;
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
    if (screen.kind === "rsvp-unit" || screen.kind === "rsvp-figure") {
      if (!performanceControlsMarked) {
        performanceControlsMarked = true;
        markPerformance("reader:controls-ready");
      }
      if (screen.kind === "rsvp-unit" && !performanceUnitMarked) {
        performanceUnitMarked = true;
        markPerformance("reader:first-unit");
      }
    }
  }

  function settleReactFigure(figureIndex: number, loaded: boolean, token: number): void {
    if (figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token) return;
    if (figureLoadRevealTimerId !== null) {
      global.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    figureViewState = loaded
      ? { kind: "ready", token: figureViewState.token, figureIndex, brightness: figureViewState.brightness }
      : { kind: "failed", token: figureViewState.token, figureIndex };
    renderReactView();
  }

  function toggleReactFigureBrightness(figureIndex: number): void {
    if ((figureViewState.kind !== "loading" && figureViewState.kind !== "ready") || figureViewState.figureIndex !== figureIndex) return;
    figureViewState = { ...figureViewState, brightness: figureViewState.brightness === "revealed" ? "dimmed" : "revealed" };
    renderReactView();
  }

  function install() {
    if (!global.document?.documentElement || host) return;
    host = global.document.createElement("div");
    if (!global.document.getElementById(HOST_ID)) host.id = HOST_ID;
    host.dataset.readerOwned = "true";
    const root = host.attachShadow({ mode: "open" });
    shadow = root;
    rootStyle = createStyles();
    root.append(rootStyle);
    handle = createHandle();
    root.append(handle);
    global.document.documentElement.append(host);
    global.addEventListener("scroll", fadeHandleDuringScroll, { passive: true });
    global.addEventListener("resize", handleViewportChange, { passive: true });
    markPerformance("reader:bootstrap-ready");
  }

  function createStyles() {
    const style = global.document.createElement("style");
    style.textContent = viewerStyles;
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
    return generation === uiGeneration;
  }

  function destroyLaunchProgress(progress: LaunchProgress): void {
    if (progress.revealTimer !== null) global.clearTimeout(progress.revealTimer);
    if (launchProgress === progress) launchProgress = null;
  }

  async function open() {
    if (overlay || opening || !handle || !shadow) return;
    markPerformance("reader:tap");
    if (sessionDismissed && retainedPageUrl === global.location.href && preparedDocument && readingSessionState()) {
      reopenRetainedSession();
      return;
    }
    if (sessionDismissed) destroyRetainedSession();
    if (!reactViewMount) mountReactViewer(shadow);
    if (!reactViewMount || !reactViewHost) throw new Error("reader_view_unavailable");
    performanceRenderMarked = false;
    performanceControlsMarked = false;
    performanceUnitMarked = false;
    const generation = ++uiGeneration;
    opening = true;
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
      if (!extractedContent?.text) throw new Error("content_not_found");
      const layout = currentRsvpFrameLayout();
      preparedDocument = prepareReaderDocument(
        extractedContent,
        global.Engine,
        layout,
        global.document.title || "",
      );
      rsvpFrameWidth = layout.maxWidth;
      markPerformance("reader:segmentation-end");
      if (preparedDocument.frames.length === 0) throw new Error("units_not_found");
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
      showError(String(generation), reason);
    } else if (sessionState?.phase === "error") {
      renderReactView();
    } else {
      retainedPageUrl = global.location.href;
      dispatchSession({
        type: "prepareSucceeded",
        requestId: String(generation),
        flow: prepareSession(preparedDocument!),
      });
      if (!isCurrentSession(generation)) return;
      renderReader();
    }
    focusCloseButtonAfterPaint(generation);
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
    if (isPreparingRequest(String(generation))) {
      dispatchSession({ type: "cancel", requestId: String(generation) });
    }
    close();
  }

  function showError(requestId: string, reason: PreparationFailure) {
    if (isPreparingRequest(requestId)) dispatchSession({ type: "prepareFailed", requestId, reason });
    renderReactView();
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
    return typeof global.ReaderSession?.create === "function";
  }

  function beginReaderSession(requestId: string): void {
    if (!readerSessionAvailable()) throw new Error("reader_session_unavailable");
    if (sessionHandle) {
      if (!applyingSession) sessionHandle.dispatch({ type: "close" });
      sessionHandle.destroy();
    }
    markPerformance("reader:session-init-start");
    markPerformance("reader:wasm-init-start");
    const handle = global.ReaderSession.create((state) => {
      if (sessionHandle !== handle) return;
      const becameReading = sessionState?.phase !== "reading" && state.phase === "reading";
      const wasFigure = sessionState?.phase === "reading" && sessionState.currentKind === "figure";
      sessionState = state;
      if (!wasFigure && state.phase === "reading" && state.currentKind === "figure") controlsVisible = true;
      applyingSession = true;
      try {
        renderSessionState();
      } finally {
        applyingSession = false;
      }
      if (becameReading) focusCloseButtonAfterPaint(uiGeneration);
    });
    sessionHandle = handle;
    sessionState = null;
    handle.dispatch({ type: "open", requestId });
    void handle.ready.then(() => {
      if (sessionHandle !== handle) return;
      markPerformance("reader:session-init-end");
      markPerformance("reader:wasm-init-end");
    }).catch(() => {
      if (sessionHandle !== handle) return;
      renderSessionState();
    });
  }

  function dispatchSession(command: ReaderSessionCommand): void {
    if (applyingSession) return;
    sessionHandle?.dispatch(command);
  }

  function renderSessionState(): void {
    if (!reactViewMount) return;
    renderReactView();
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
    const position = sessionPosition();
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
  ): ReaderPosition | null {
    if (!preparedDocument) return null;
    const currentPosition = sessionPosition();
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
    if (!selected) return null;
    const lastTextMarker = [...positionMarkers].reverse().find((marker) => (
      marker.dataset.readerPositionKind === "text"
    ));
    const sourceOffset = atBottom
      && scroller.scrollTop > 0
      && selected === lastTextMarker
      ? preparedDocument.text.length
      : Number(selected.dataset.sourceStart);
    const position: ReaderPosition = selected.dataset.readerPositionKind === "figure"
      ? {
        kind: "figure",
        sourceOffset,
        figureIndex: Number(selected.dataset.figureIndex),
      }
      : { kind: "text", sourceOffset };
    if (syncSession && !applyingSession) {
      dispatchSession({
        type: sessionMode() === "text" ? "switchToText" : "switchToRsvp",
        position,
      });
    }
    return position;
  }

  function captureTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    force = false,
    syncSession = true,
  ): ReaderPosition | null {
    const restoredScrollTop = reactTextRestoreScrollTop;
    if (!force && (restoredScrollTop === null || Math.abs(scroller.scrollTop - restoredScrollTop) < 1)) return null;
    const position = updateTextPosition(scroller, positionMarkers, force, syncSession);
    reactTextRestoreScrollTop = scroller.scrollTop;
    return position;
  }

  function restoreTextPosition(scroller: HTMLElement, positionMarkers: HTMLElement[]): void {
    const currentPosition = sessionPosition();
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
    let capturedPosition = sessionPosition();
    if (nextMode === "rsvp" && currentMode === "text") {
      const textScroller = reactTextScroller;
      const textMarkers = reactTextMarkers;
      const scrollChanged = textScroller && (reactTextRestoreScrollTop === null || Math.abs(textScroller.scrollTop - reactTextRestoreScrollTop) >= 1);
      if (!modeRestorePending || scrollChanged) {
        reactTextRestoring = true;
        if (textScroller) capturedPosition = captureTextPosition(textScroller, textMarkers, true, false) || capturedPosition;
      }
    } else if (currentMode === "rsvp") {
      reactTextRestoring = true;
    }
    invalidateFigureLoad();
    if (!applyingSession) {
      dispatchSession({
        type: nextMode === "text" ? "switchToText" : "switchToRsvp",
        position: capturedPosition,
      });
    }
    if (nextMode === "rsvp") controlsVisible = true;
    renderSessionState();
    if (nextMode === "rsvp") scheduleReactTextRestoreRelease();
    if (!containsReaderElement(previousFocus)) {
      global.requestAnimationFrame(() => findCloseButton()?.focus());
    }
  }

  function reflowForViewport() {
    if (!preparedDocument) return;
    const layout = currentRsvpFrameLayout();
    if (Math.abs(layout.maxWidth - rsvpFrameWidth) < 1) {
      renderSessionState();
      return;
    }
    const position = sessionPosition();
    preparedDocument = reflowReaderDocument(preparedDocument, global.Engine, layout);
    rsvpFrameWidth = layout.maxWidth;
    if (readingSessionState() && !applyingSession) {
      dispatchSession({
        type: "rebuildUnits",
        units: prepareSession(preparedDocument).units,
        position,
      });
    } else {
      renderSessionState();
    }
  }

  function handleViewportChange() {
    if (!overlay || !preparedDocument) return;
    reflowForViewport();
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
    const generation = uiGeneration;
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
    if (figureLoadRevealTimerId !== null) {
      global.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
  }

  function advanceFromFigure(): void {
    dispatchSession({ type: "resumeFromFigure" });
    showTransportControls();
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

  function focusCloseButtonAfterPaint(generation: number): void {
    global.requestAnimationFrame(() => {
      global.requestAnimationFrame(() => {
        if (!isCurrentSession(generation) || !overlay) return;
        findCloseButton()?.focus();
      });
    });
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
    const generation = ++uiGeneration;
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
    focusCloseButtonAfterPaint(generation);
    if (isCurrentSession(generation)) opening = false;
  }

  function dismissReadySession(): void {
    uiGeneration += 1;
    detachSessionLifecycle();
    const restoreFocus = launchFocus;
    resumePlaybackOnReopen = sessionIsPlaying();
    if (sessionHandle && !applyingSession) dispatchSession({ type: "pause" });
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
    uiGeneration += 1;
    if (sessionHandle && !applyingSession) {
      dispatchSession({ type: "close" });
      sessionHandle.destroy();
    }
    destroySessionState();
  }

  function destroySessionState(): void {
    unmountReactViewer();
    clearPendingLeftTap();
    if (rewindFeedbackClearTimer !== null) global.clearTimeout(rewindFeedbackClearTimer);
    rewindFeedbackClearTimer = null;
    preparedDocument = null;
    rsvpFrameWidth = 0;
    invalidateFigureLoad();
    opening = false;
    controlsVisible = true;
    lastLeftTapAt = 0;
    lastLeftTapX = 0;
    lastLeftTapY = 0;
    destroyLaunchProgressIfPresent();
    preparationController = null;
    launchFocus = null;
    sessionState = null;
    sessionHandle = null;
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
    if (readingSessionState() && preparedDocument) {
      dismissReadySession();
      return;
    }
    uiGeneration += 1;
    detachSessionLifecycle();
    preparationController?.abort();
    const restoreFocus = launchFocus;
    const currentOverlay = overlay;
    overlay = null;
    try {
      clearPendingLeftTap();
      lastLeftTapAt = 0;
      if (sessionState?.phase === "preparing") {
        dispatchSession({ type: "cancel", requestId: sessionState.requestId });
      }
      if (sessionHandle && !applyingSession) {
        dispatchSession({ type: "close" });
        sessionHandle.destroy();
      }
      sessionHandle = null;
      sessionState = null;
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

export {};
