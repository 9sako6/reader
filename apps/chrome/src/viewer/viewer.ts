import viewerStyles from "./viewer.css";
import {
  createSpotTextMeasurer,
  prepareReaderDocument,
  presentReader,
  reflowReaderDocument,
  sessionPreparation as prepareSession,
  type PreparedReaderDocument,
  type ReaderPresentationUiState,
} from "../../../../packages/presentation/src/presentation";

(() => {
  type PlaybackState = "idle" | "paused" | "playing";
  type FigureViewState =
    | { kind: "idle" }
    | { kind: "loading"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "ready"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "failed"; token: number; figureIndex: number };
  type ReaderMessage =
    | { type: "SHOW_READER_LOADING"; requestId: string }
    | { type: "START_READER"; requestId: string; text: string; readingContext?: Partial<ReadingContext> | null }
    | { type: "READER_ERROR"; requestId: string; reason?: PreparationFailure };

  if (globalThis.__readerInstalled) return;
  globalThis.__readerInstalled = true;

  const ROOT_ID = "__reader-root";
  const LOADER_REVEAL_DELAY_MS = 200;
  const SLOW_PREPARATION_DELAY_MS = 400;
  const LOADING_COVER_TRANSITION_MS = 220;

  function markPerformance(name: string): void {
    globalThis.performance?.mark?.(name);
  }

  let preparedDocument: PreparedReaderDocument | null = null;
  let rootHost: HTMLDivElement | null = null;
  let readerShadow: ShadowRoot | null = null;
  let root: HTMLDialogElement | HTMLDivElement | null = null;
  let rootStyle: HTMLStyleElement | null = null;
  let loadingRevealTimerId: number | null = null;
  let loadingSlowTimerId: number | null = null;
  let loadingRevealRequestId: string | null = null;
  let loadingStartedAt: number | null = null;
  let loadingSlowVisible = false;
  let loadingCoverVisible = false;
  let display: HTMLDivElement | null = null;
  let displayResizeObserver: ResizeObserver | null = null;
  let figureViewState: FigureViewState = { kind: "idle" };
  let figureLoadToken = 0;
  let figureLoadRevealTimerId: number | null = null;
  let pageScroller: HTMLElement | null = null;
  let pagePositionMarkers: HTMLElement[] = [];
  let pagePositionDirty = false;
  let pageRestoreScrollTop: number | null = null;
  let pageRestoring = false;
  let pageRestoreGeneration = 0;
  let pageRestorePending = false;
  let reactPageFigureCorrections = new WeakMap<HTMLImageElement, {
    scroller: HTMLElement;
    positionMarkers: HTMLElement[];
    currentMarker?: HTMLElement;
    shouldCorrect: boolean;
    beforeTop: number;
    settled: boolean;
  }>();
  let launchFocus: HTMLElement | null = null;
  let sourceScrollPosition: { left: number; top: number } | null = null;
  let sourcePageLock: {
    documentElementOverflow: string;
    bodyOverflow: string;
  } | null = null;
  let inertedElements: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  let backgroundInert = false;
  let keydownListenerAttached = false;
  let lastReaderFocusedElement: HTMLElement | null = null;
  let dialogCancelListener: ((event: Event) => void) | null = null;
  let closeInProgress = false;
  let sessionState: ReaderSessionState | null = null;
  let sessionHandle: ReaderSessionHandle | null = null;
  let applyingSession = false;
  let sessionLifecycleAttached = false;
  let reactViewMount: ReaderViewMount<"desktop"> | null = null;
  let reactRenderedKind: ReactReaderScreen["kind"] | null = null;
  let reactRenderedPositionKey: string | null = null;
  let reactLoadingRevealed = false;
  let performanceReactInitStarted = false;
  let performanceReactInitMarked = false;
  let performanceSpotMarked = false;
  const measureSpotText = createSpotTextMeasurer(document);
  let spotWidth = 0;

  type ReactReaderScreen = ReaderScreen;

  function reactViewerAvailable(): boolean {
    return typeof globalThis.ReaderView?.mount === "function";
  }

  function mountReactViewer(dialog: HTMLDialogElement): void {
    if (reactViewMount) return;
    if (!reactViewerAvailable()) throw new Error("reader_view_unavailable");
    const host = document.createElement("div");
    host.setAttribute("data-reader-react-root", "true");
    Object.assign(host.style, { position: "absolute", inset: "0", pointerEvents: "auto" });
    dialog.append(host);
    const viewer = globalThis.ReaderView;
    if (!viewer) throw new Error("reader_view_unavailable");
    performanceReactInitStarted = true;
    markPerformance("reader:react-init-start");
    try {
      reactViewMount = viewer.mount(host, { layout: "desktop" });
    } catch (error) {
      host.remove();
      performanceReactInitStarted = false;
      throw error;
    }
  }

  function unmountReactViewer(): void {
    reactViewMount?.unmount();
    reactViewMount = null;
    performanceReactInitStarted = false;
    performanceReactInitMarked = false;
    performanceSpotMarked = false;
  }

  function renderReactView(screen: ReactReaderScreen): void {
    if (!reactViewMount) return;
    const wasVisibleLoading = reactRenderedKind === "loading" && reactLoadingRevealed;
    const previousDisplay = display;
    const previousPositionKey = reactRenderedPositionKey;
    const nextPositionKey = screen.kind === "spot-figure"
      ? `figure:${screen.figure.figureIndex}`
      : screen.kind === "spot"
        ? `text:${screen.spot.start}`
        : null;
    reactViewMount.render(screen, {
      close,
      cancel: cancelLoading,
      retry: retryPreparation,
      switchToPage: showPageView,
      switchToSpots: showSpotsView,
      previousSentence: goBackOneSentence,
      headingSelect: jumpToHeading,
      togglePlayback: togglePlayPause,
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
      loadingAnimation: animateLoadingIndicator,
      pageScroll: (element: HTMLElement | null) => {
        if (!element) {
          pageScroller = null;
          pagePositionMarkers = [];
          return;
        }
        pageScroller = element;
        pagePositionMarkers = [...element.querySelectorAll<HTMLElement>('[data-reader-position-kind="text"], [data-reader-position-kind="figure"]')];
        pageRestoreScrollTop = element.scrollTop;
        attachReactPageFigureLoadCorrections(element);
        if (pageRestorePending) {
          schedulePageRestore(element, pagePositionMarkers);
        }
      },
      pagePosition: (element: HTMLElement) => {
        if (pageRestoring) {
          if (pageRestoreScrollTop === null || Math.abs(element.scrollTop - pageRestoreScrollTop) < 1) return;
          if (pageRestorePending) {
            pageRestorePending = false;
            pageRestoreGeneration += 1;
          }
        }
        updatePagePosition(element, pagePositionMarkers);
        pageRestoreScrollTop = element.scrollTop;
      },
    });
    if (screen.kind === "spot" && !performanceSpotMarked) {
      performanceSpotMarked = true;
      markPerformance("reader:first-spot");
    }
    if (performanceReactInitStarted && !performanceReactInitMarked) {
      performanceReactInitMarked = true;
      markPerformance("reader:react-init-end");
    }
    display = root?.querySelector?.<HTMLDivElement>('[data-reader-spot="true"]') || null;
    if (
      (screen.kind === "spot" || screen.kind === "spot-figure")
      && previousDisplay
      && previousPositionKey
      && nextPositionKey
      && previousPositionKey !== nextPositionKey
      && nextPositionKey.startsWith("figure:")
      && !prefersReducedMotion()
    ) {
      previousDisplay.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 180, easing: "ease-out" },
      );
      root?.querySelector?.<HTMLElement>('[aria-label="本文画像"]')?.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 180, easing: "ease-out" },
      );
    }
    const stage = root?.querySelector?.<HTMLDivElement>('[data-reader-stage="true"]');
    if (stage && (screen.kind === "spot" || screen.kind === "spot-figure") && wasVisibleLoading && !prefersReducedMotion()) {
      stage.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: LOADING_COVER_TRANSITION_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
    reactLoadingRevealed = screen.kind === "loading" && screen.revealed;
    reactRenderedKind = screen.kind;
    reactRenderedPositionKey = nextPositionKey;
  }

  function reactScreen(): ReactReaderScreen {
    const figure = figureViewState.kind === "loading"
      ? { ...figureViewState, loadingVisible: figureLoadRevealTimerId === null }
      : figureViewState;
    const ui: ReaderPresentationUiState = {
      loadingSlow: loadingSlowVisible,
      loadingRevealed: loadingRevealTimerId === null,
      loadingCover: loadingCoverVisible,
      controlsVisible: true,
      reducedMotion: prefersReducedMotion(),
      rewindFeedback: null,
      figure,
    };
    return presentReader(preparedDocument, sessionState, ui);
  }

  function settleReactFigure(figureIndex: number, loaded: boolean, token: number): void {
    if (figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token) return;
    if (figureLoadRevealTimerId !== null) {
      globalThis.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    figureViewState = loaded
      ? { kind: "ready", token: figureViewState.token, figureIndex, brightness: figureViewState.brightness }
      : { kind: "failed", token: figureViewState.token, figureIndex };
    renderReactView(reactScreen());
  }

  function toggleReactFigureBrightness(figureIndex: number): void {
    if ((figureViewState.kind !== "ready" && figureViewState.kind !== "loading") || figureViewState.figureIndex !== figureIndex) return;
    figureViewState = { ...figureViewState, brightness: figureViewState.brightness === "revealed" ? "dimmed" : "revealed" };
    renderReactView(reactScreen());
  }

  function readingSessionState(): Extract<ReaderSessionState, { phase: "reading" }> | null {
    return sessionState?.phase === "reading" ? sessionState : null;
  }

  function sessionFlowIndex(): number {
    return readingSessionState()?.flowIndex ?? 0;
  }

  function sessionPlaybackState(): PlaybackState {
    const state = readingSessionState();
    if (state) return state.playback;
    return sessionState?.phase === "ended" ? "idle" : "paused";
  }

  function sessionMode(): ReaderSessionMode {
    return readingSessionState()?.mode ?? "spots";
  }

  function sessionPosition(): ReaderPosition {
    const state = readingSessionState();
    if (state) return state.position;
    const first = preparedDocument?.flow[0];
    return first && preparedDocument
      ? globalThis.Engine.positionForFlowItem(first, preparedDocument.spots)
      : { kind: "text", sourceOffset: 0 };
  }

  function isPreparingRequest(requestId: string): boolean {
    return sessionState?.phase === "preparing" && sessionState.requestId === requestId;
  }

  function currentSpotLayout() {
    const viewportWidth = root?.clientWidth
      || document.documentElement.clientWidth
      || globalThis.innerWidth
      || 320;
    const horizontalInset = viewportWidth <= 720 ? 32 : viewportWidth <= 1279 ? 64 : 80;
    return {
      maxWidth: Math.max(1, Math.min(640, viewportWidth - horizontalInset)),
      measureText: measureSpotText,
    };
  }

  function isReaderMessage(value: unknown): value is ReaderMessage {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;
    const message = value as Record<string, unknown>;
    if (typeof message.requestId !== "string") return false;
    if (message.type === "SHOW_READER_LOADING" || message.type === "READER_ERROR") return true;
    return message.type === "START_READER" && typeof message.text === "string";
  }

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isReaderMessage(message)) return;
    if (message?.type === "SHOW_READER_LOADING" && typeof message.requestId === "string") {
      showLoading(message.requestId);
      return;
    }

    if (message?.type === "START_READER" && typeof message.text === "string") {
      start(message.text, message.requestId, message.readingContext);
      return;
    }

    if (message?.type === "READER_ERROR") {
      showError(message.requestId, message.reason);
    }
  });

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden" && !applyingSession) {
      dispatchSession({ type: "visibilityHidden" });
    }
  }

  function attachSessionLifecycle(): void {
    if (sessionLifecycleAttached) return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    sessionLifecycleAttached = true;
  }

  function detachSessionLifecycle(): void {
    if (!sessionLifecycleAttached) return;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    sessionLifecycleAttached = false;
  }

  function showLoading(requestId: string): void {
    const existingLaunchFocus = launchFocus
      && launchFocus.isConnected !== false
      ? launchFocus
      : null;
    const activeElement = document.activeElement;
    close(false, true);
    launchFocus = existingLaunchFocus || (activeElement && typeof (activeElement as HTMLElement).focus === "function"
      ? activeElement as HTMLElement
      : null);
    lockSourcePage();
    loadingSlowVisible = false;
    beginReaderSession(requestId);
    loadingStartedAt = Date.now();
    loadingRevealRequestId = requestId;
    loadingRevealTimerId = globalThis.setTimeout(() => {
      loadingRevealTimerId = null;
      if (!isPreparingRequest(requestId) || requestId !== loadingRevealRequestId || reactRenderedKind === "loading") return;
      loadingRevealRequestId = null;
      createLoadingOverlay();
    }, LOADER_REVEAL_DELAY_MS);
    loadingSlowTimerId = globalThis.setTimeout(() => {
      loadingSlowTimerId = null;
      if (!isPreparingRequest(requestId)) return;
      if (!root) createLoadingOverlay();
      showSlowLoading();
    }, SLOW_PREPARATION_DELAY_MS);
  }

  function start(
    text: string,
    requestId: string,
    suppliedReadingContext: Partial<ReadingContext> | null | undefined,
  ): void {
    if (!isPreparingRequest(requestId)) return;

    const loadingWasVisible = loadingCoverVisible || (reactRenderedKind === "loading" && reactLoadingRevealed);
    const elapsed = loadingStartedAt === null ? 0 : Date.now() - loadingStartedAt;
    if (!loadingWasVisible && elapsed >= LOADER_REVEAL_DELAY_MS) {
      cancelLoadingReveal();
      createLoadingOverlay();
      if (elapsed >= SLOW_PREPARATION_DELAY_MS) showSlowLoading();
    } else {
      cancelLoadingReveal();
    }


    const content = globalThis.Extractor.fromText(
      text,
      suppliedReadingContext || collectReadingContext(text),
    );
    if (!content) {
      showError(requestId, "content_not_found");
      return;
    }
    const layout = currentSpotLayout();
    preparedDocument = prepareReaderDocument(content, globalThis.Engine, layout);
    spotWidth = layout.maxWidth;
    if (preparedDocument.spots.length === 0) {
      showError(requestId, "content_not_found");
      return;
    }

    loadingCoverVisible = false;
    prepareReactFigure(preparedDocument.flow[0]);
    dispatchSession({
      type: "prepareSucceeded",
      requestId,
      flow: prepareSession(preparedDocument),
    });
    focusAfterPaint(root);
  }

  function readerSessionAvailable(): boolean {
    return typeof globalThis.ReaderSession?.create === "function";
  }

  function beginReaderSession(requestId: string): void {
    attachSessionLifecycle();
    if (!readerSessionAvailable()) {
      showSessionUnavailable(requestId);
      return;
    }
    if (sessionHandle) {
      if (!applyingSession) sessionHandle.dispatch({ type: "close" });
      sessionHandle.destroy();
    }
    markPerformance("reader:session-init-start");
    markPerformance("reader:wasm-init-start");
    const handle = globalThis.ReaderSession.create((state) => {
      if (sessionHandle !== handle) return;
      sessionState = state;
      applyingSession = true;
      try {
        renderSessionState();
      } finally {
        applyingSession = false;
      }
    });
    sessionHandle = handle;
    sessionState = null;
    handle.dispatch({ type: "open", requestId });
    void handle.ready.then(() => {
      if (sessionHandle !== handle) return;
      markPerformance("reader:session-init-end");
      markPerformance("reader:wasm-init-end");
    }).catch((error: unknown) => {
      console.error("ReaderSession failed", error);
      if (sessionHandle === handle && sessionState?.phase !== "error") showSessionUnavailable(requestId);
    });
  }

  function showSessionUnavailable(requestId: string): void {
    if (!isPreparingRequest(requestId)) return;
    showError(requestId, "session_unavailable");
  }

  function dispatchSession(command: ReaderSessionCommand): void {
    if (applyingSession) return;
    sessionHandle?.dispatch(command);
  }

  function renderSessionState(): void {
    if (readingSessionState()) prepareReactFigure(preparedDocument?.flow[sessionFlowIndex()]);
    if (!root) {
      if (readingSessionState()) {
        createOverlay();
      } else if (sessionState?.phase === "error") {
        root = createRoot();
        renderReactView(reactScreen());
        attachKeydownListener();
        focusAfterPaint(findCloseButton());
      }
      return;
    }
    renderReactView(reactScreen());
  }

  function createLoadingOverlay() {
    loadingCoverVisible = true;
    if (!root) root = createRoot();
    renderReactView(reactScreen());
    attachKeydownListener();
  }

  function showSlowLoading(): void {
    loadingSlowVisible = true;
    if (reactViewMount) {
      renderReactView(reactScreen());
      focusAfterPaint(findLoadingCancelButton());
      return;
    }
    if (!root) root = createRoot();
    renderReactView(reactScreen());
    focusAfterPaint(findLoadingCancelButton());
    return;
  }

  function cancelLoadingReveal(): void {
    loadingRevealRequestId = null;
    if (loadingRevealTimerId !== null) {
      globalThis.clearTimeout(loadingRevealTimerId);
      loadingRevealTimerId = null;
    }
    if (loadingSlowTimerId !== null) {
      globalThis.clearTimeout(loadingSlowTimerId);
      loadingSlowTimerId = null;
    }
    loadingSlowVisible = false;
  }

  function cancelLoading(): void {
    const requestId = sessionState?.phase === "preparing" ? sessionState.requestId : null;
    if (!requestId) return;
    sendPreparationMessage({ type: "CANCEL_READER", requestId });
    dispatchSession({ type: "cancel", requestId });
    close(false);
  }

  function showError(requestId: string, reason: PreparationFailure = "extraction_failed"): void {
    if (!isPreparingRequest(requestId)) return;
    dispatchSession({ type: "prepareFailed", requestId, reason });
    cancelLoadingReveal();
    loadingCoverVisible = false;
    if (!root) root = createRoot();
    renderReactView(reactScreen());
    attachKeydownListener();
    focusAfterPaint(findCloseButton());
    return;
  }

  function retryPreparation(): void {
    const requestId = sessionState?.phase === "error" ? sessionState.requestId : null;
    if (!requestId) return;
    sendPreparationMessage({ type: "RETRY_READER", requestId });
  }

  function sendPreparationMessage(message: { type: "CANCEL_READER" | "RETRY_READER"; requestId: string }): void {
    const sendMessage = chrome.runtime.sendMessage;
    if (typeof sendMessage !== "function") return;
    try {
      void sendMessage(message);
    } catch {
      return;
    }
  }

  function collectReadingContext(sourceText: string): Partial<ReadingContext> {
    const headingEntries = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((element) => ({
        element,
        text: (element.textContent || "").trim(),
        level: Number(element.tagName.slice(1)),
      }))
      .filter((entry) => entry.text.length > 0);

    const context: Partial<ReadingContext> & {
      language: string;
      headings: ReaderHeading[];
      sectionTransitions: ReaderSectionTransition[];
      initialHeadingIndex: number;
      figures: ReaderFigure[];
    } = {
      language: document.documentElement.lang || "ja",
      headings: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    };

    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return context;
    }

    const range = selection.getRangeAt(0);
    let precedingHeadingIndex = -1;
    const transitions: ReaderSectionTransition[] = [];

    headingEntries.forEach(({ element }, headingIndex) => {
      try {
        const position = range.comparePoint(element, 0);
        if (position === -1) {
          precedingHeadingIndex = headingIndex;
          return;
        }

        if (position === 0) {
          const prefixRange = range.cloneRange();
          prefixRange.setEndBefore(element);
          transitions.push({
            offset: prefixRange.toString().length,
            headingIndex,
          });
        }
      } catch {
        // Ignore headings that cannot be compared with the selection range.
      }
    });

    const relevantHeadingIndexes = [...new Set([
      precedingHeadingIndex,
      ...transitions.map(({ headingIndex }) => headingIndex),
    ].filter((index) => index >= 0))];
    const remappedIndexes = new Map(
      relevantHeadingIndexes.map((headingIndex, index) => [headingIndex, index]),
    );

    context.headings = relevantHeadingIndexes.flatMap((headingIndex) => {
      const heading = headingEntries[headingIndex];
      return heading ? [{ text: heading.text, level: heading.level }] : [];
    });
    context.initialHeadingIndex = remappedIndexes.get(precedingHeadingIndex) ?? -1;
    context.sectionTransitions = transitions
      .flatMap(({ offset, headingIndex }) => {
        const mappedHeadingIndex = remappedIndexes.get(headingIndex);
        return mappedHeadingIndex === undefined
          ? []
          : [{ offset: Math.min(offset, sourceText.length), headingIndex: mappedHeadingIndex }];
      })
      .sort((left, right) => left.offset - right.offset);
    return context;
  }

  function createOverlay(): void {
    if (!root) root = createRoot();
    renderReactView(reactScreen());
    attachKeydownListener();
    focusAfterPaint(root);
    if (typeof globalThis.ResizeObserver === "function" && root && !displayResizeObserver) {
      displayResizeObserver = new globalThis.ResizeObserver(() => {
        reflowForViewport();
      });
      displayResizeObserver.observe(root);
    }
  }

  function reflowForViewport(): void {
    if (!preparedDocument) return;
    const layout = currentSpotLayout();
    if (Math.abs(layout.maxWidth - spotWidth) < 1) {
      renderSessionState();
      return;
    }
    const position = sessionPosition();
    preparedDocument = reflowReaderDocument(preparedDocument, globalThis.Engine, layout);
    spotWidth = layout.maxWidth;
    if (readingSessionState() && !applyingSession) {
      dispatchSession({
        type: "rebuildSpots",
        spots: prepareSession(preparedDocument).spots,
        position,
      });
    } else {
      renderSessionState();
    }
  }

  function createRoot(): HTMLDialogElement | HTMLDivElement {
    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.dataset.readerOwned = "true";
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "block",
      pointerEvents: "none",
      colorScheme: "dark",
    });
    rootHost = host;

    const dialog = document.createElement("dialog") as HTMLDialogElement;
    dialog.className = "reader-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "reader");
    dialog.setAttribute("tabindex", "-1");
    Object.assign(dialog.style, {
      display: "block",
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100dvh",
      maxWidth: "none",
      maxHeight: "none",
      margin: "0",
      padding: "0",
      border: "0",
      boxSizing: "border-box",
      background: "radial-gradient(circle at 68% 44%, rgba(44,44,44,0.32), transparent 38%), #090909",
      color: "#ffffff",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
      colorScheme: "dark",
      lineHeight: "normal",
      writingMode: "horizontal-tb",
      pointerEvents: "auto",
      overflow: "hidden",
      outline: "none",
      WebkitFontSmoothing: "antialiased",
    });

    const style = document.createElement("style");
    style.textContent = viewerStyles;
    rootStyle = style;

    try {
      readerShadow = typeof host.attachShadow === "function"
        ? host.attachShadow({ mode: "open" })
        : null;
    } catch {
      readerShadow = null;
    }
    if (readerShadow) readerShadow.append(style, dialog);
    else host.append(style, dialog);

    root = dialog;
    try {
      mountReactViewer(dialog);
      (readerShadow || host).append(style);
    } catch (error) {
      host.remove();
      root = null;
      rootHost = null;
      readerShadow = null;
      rootStyle = null;
      throw error;
    }
    root.addEventListener("focusin", rememberReaderFocus, true);
    dialogCancelListener = (event: Event) => {
      event.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", dialogCancelListener);
    document.documentElement.append(host);
    makeBackgroundInert(host);
    presentDialog(dialog);
    return dialog;
  }

  function presentDialog(dialog: HTMLDialogElement): void {
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
        return;
      } catch {
      }
    }
    dialog.setAttribute("open", "");
  }

  function makeBackgroundInert(readerHost: HTMLElement): void {
    if (backgroundInert) return;
    backgroundInert = true;
    const documentChildren = Array.from(document.documentElement.children) as HTMLElement[];
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

  function lockSourcePage(): void {
    if (sourcePageLock) return;
    const scroll = sourceScrollPosition || {
      left: globalThis.scrollX || 0,
      top: globalThis.scrollY || 0,
    };
    sourcePageLock = {
      documentElementOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
    };
    sourceScrollPosition = scroll;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  function restoreSourcePage(): void {
    const lock = sourcePageLock;
    sourcePageLock = null;
    if (!lock) return;
    try {
      document.documentElement.style.overflow = lock.documentElementOverflow;
    } catch {
    }
    try {
      document.body.style.overflow = lock.bodyOverflow;
    } catch {
    }
  }

  function findCloseButton(): HTMLButtonElement | null {
    return findReaderButton((button) => button.getAttribute("aria-label") === "readerを閉じる");
  }

  function findLoadingCancelButton(): HTMLButtonElement | null {
    return root?.querySelector?.<HTMLButtonElement>('[data-reader-loading-cancel="true"]') || null;
  }

  function findModeButton(mode: "spots" | "page"): HTMLButtonElement | null {
    return findReaderButton((button) => button.getAttribute("data-reader-mode") === mode);
  }

  function findReaderButton(predicate: (button: HTMLButtonElement) => boolean): HTMLButtonElement | null {
    if (!root) return null;
    const pending: Element[] = [root];
    const visited = new Set<Element>();
    while (pending.length > 0) {
      const element = pending.shift();
      if (!element || visited.has(element)) continue;
      visited.add(element);
      for (const child of Array.from(element.children)) {
        const candidate = child as HTMLElement;
        if (candidate.tagName.toLowerCase() === "button" && predicate(candidate as HTMLButtonElement)) {
          return candidate as HTMLButtonElement;
        }
        pending.push(candidate);
      }
    }
    return null;
  }

  function focusAfterPaint(
    element: HTMLElement | null,
    scrollPosition: { left: number; top: number } | null = null,
  ): void {
    if (!element) return;
    const focus = () => {
      element.focus?.({ preventScroll: true });
      if (scrollPosition) globalThis.scrollTo?.({ ...scrollPosition, behavior: "auto" });
    };
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(focus);
    else focus();
  }

  function readerActiveElement(): HTMLElement | null {
    const rootNode = root?.getRootNode?.();
    const activeElement = rootNode && "activeElement" in rootNode
      ? (rootNode as ShadowRoot).activeElement
      : document.activeElement;
    return activeElement && typeof (activeElement as HTMLElement).focus === "function"
      ? activeElement as HTMLElement
      : null;
  }

  function rememberReaderFocus(event: FocusEvent): void {
    const focused = eventPath(event).find((target) => (
      typeof target === "object"
      && target !== null
      && target instanceof HTMLElement
      && containsReaderElement(target)
    ));
    if (focused instanceof HTMLElement) lastReaderFocusedElement = focused;
  }

  function containsReaderElement(element: HTMLElement | null): boolean {
    if (!element || !root || element === root) return false;
    let current: HTMLElement | null = element;
    const visited = new Set<HTMLElement>();
    while (current && !visited.has(current)) {
      if (current === root) return true;
      visited.add(current);
      current = current.parentElement
        || (current as unknown as { parent?: HTMLElement | null }).parent
        || null;
    }
    return false;
  }

  function focusSurfaceIfNeeded(previousFocus: HTMLElement | null): void {
    if (containsReaderElement(previousFocus)) return;
    const focusSurface = () => {
      if (readerHasFocus()) return;
      root?.focus?.({ preventScroll: true });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        focusSurface();
        globalThis.requestAnimationFrame(focusSurface);
      });
    } else {
      focusSurface();
    }
  }

  function readerHasFocus(): boolean {
    if (readerActiveElement() === root) return true;
    if (containsReaderElement(readerActiveElement())) return true;
    return lastReaderFocusedElement !== null
      && containsReaderElement(lastReaderFocusedElement)
      && rootHost !== null
      && document.activeElement === rootHost;
  }

  function attachKeydownListener(): void {
    if (keydownListenerAttached) return;
    document.addEventListener("keydown", handleKeyDown, true);
    keydownListenerAttached = true;
  }

  function detachKeydownListener(): void {
    if (!keydownListenerAttached) return;
    document.removeEventListener("keydown", handleKeyDown, true);
    keydownListenerAttached = false;
  }

  function detachDialogCancelListener(): void {
    if (!root || !dialogCancelListener) return;
    root.removeEventListener("cancel", dialogCancelListener);
    dialogCancelListener = null;
  }

  function showPageView() {
    if (!root || !preparedDocument) return;
    pageRestoring = true;
    pageRestorePending = true;
    if (!applyingSession) {
      dispatchSession({ type: "switchToPage", position: sessionPosition() });
    }
    renderReactView(reactScreen());
    attachKeydownListener();
    focusAfterPaint(findModeButton("page"));
    return;
  }

  function showSpotsView() {
    if (!root || !preparedDocument || preparedDocument.spots.length === 0) return;
    const modeRestorePending = pageRestorePending;
    pageRestorePending = false;
    let capturedPosition = sessionPosition();
    if (sessionMode() === "page" && pageScroller) {
      const scrollChanged = pageRestoreScrollTop === null || Math.abs(pageScroller.scrollTop - pageRestoreScrollTop) >= 1;
      if (!modeRestorePending || scrollChanged) {
        pageRestoring = true;
        capturedPosition = updatePagePosition(pageScroller, pagePositionMarkers, true, false) || capturedPosition;
      }
    }
    dispatchSession({ type: "switchToSpots", position: capturedPosition });
    renderReactView(reactScreen());
    schedulePageRestoreRelease();
    attachKeydownListener();
    focusAfterPaint(findModeButton("spots"));
    return;
  }

  function attachReactPageFigureLoadCorrections(scroller: HTMLElement): void {
    const positionMarkers = [...scroller.querySelectorAll<HTMLElement>('[data-reader-position-kind="text"], [data-reader-position-kind="figure"]')];
    for (const figureElement of scroller.querySelectorAll<HTMLElement>('[data-reader-page-figure="true"]')) {
      const image = figureElement.querySelector<HTMLImageElement>("img");
      if (!image) continue;
      const existing = reactPageFigureCorrections.get(image);
      if (existing) {
        existing.scroller = scroller;
        existing.positionMarkers = positionMarkers;
        continue;
      }
      const currentMarker = currentPagePositionMarker(positionMarkers);
      const figureOffset = Number(figureElement.dataset.sourceStart);
      const markerOffset = Number(currentMarker?.dataset.sourceStart);
      const shouldCorrect = Boolean(
        currentMarker
        && Number.isFinite(figureOffset)
        && Number.isFinite(markerOffset)
        && figureOffset <= markerOffset,
      );
      const beforeTop = shouldCorrect ? elementRect(currentMarker as HTMLElement, 0, 100).top : 0;
      const correction = {
        scroller,
        positionMarkers,
        currentMarker,
        shouldCorrect,
        beforeTop,
        settled: false,
      };
      reactPageFigureCorrections.set(image, correction);
      const adjustAfterDecode = async () => {
        if (correction.settled) return;
        correction.settled = true;
        if (!correction.shouldCorrect || pageScroller !== correction.scroller) return;
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch {
        }
        if (pageScroller !== correction.scroller) return;
        const applyCorrection = () => {
          if (pageScroller !== correction.scroller || !correction.currentMarker) return;
          const afterTop = elementRect(correction.currentMarker, 0, 100).top;
          const delta = afterTop - correction.beforeTop;
          if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
            pageRestoring = true;
            correction.scroller.scrollTop += delta;
            pageRestoreScrollTop = correction.scroller.scrollTop;
            schedulePageRestoreRelease(false);
          }
        };
        if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(applyCorrection);
        else applyCorrection();
      };
      image.addEventListener("load", () => { void adjustAfterDecode(); });
      image.addEventListener("error", () => { void adjustAfterDecode(); });
      if (image.complete && image.naturalWidth > 0) void adjustAfterDecode();
    }
  }

  function currentPagePositionMarker(positionMarkers: HTMLElement[]): HTMLElement | undefined {
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

  function updatePagePosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    preferReadableTop = false,
    syncSession = true,
  ): ReaderPosition | null {
    const currentPosition = sessionPosition();
    const scrollerRect = elementRect(scroller, 0, scroller.clientHeight || 500);
    const visibleTop = scrollerRect.top;
    const visibleBottom = scrollerRect.bottom;
    const readableTop = Math.min(visibleBottom, visibleTop + 72);
    const readableBottom = Math.max(readableTop, visibleBottom - 112);
    let firstVisible: HTMLElement | undefined;
    let firstVisibleTop = Number.POSITIVE_INFINITY;
    let firstReadable: HTMLElement | undefined;
    let firstReadableTop = Number.POSITIVE_INFINITY;
    for (const marker of positionMarkers) {
      const rect = elementRect(marker, visibleTop, visibleTop + 100);
      if (rect.bottom <= visibleTop || rect.top >= visibleBottom) continue;
      if (rect.top < firstVisibleTop) {
        firstVisible = marker;
        firstVisibleTop = rect.top;
      }
      const isFullyReadable = rect.top >= readableTop && rect.bottom <= readableBottom;
      if (isFullyReadable && rect.top < firstReadableTop) {
        firstReadable = marker;
        firstReadableTop = rect.top;
      }
    }
    const anchoredFigureIndex = currentPosition.kind === "figure" ? currentPosition.figureIndex : -1;
    const anchoredMarker = currentPosition.kind === "figure"
      ? positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "figure"
        && Number(marker.dataset.figureIndex) === anchoredFigureIndex
      ))
      : positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "text"
        && Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset
        && Number(marker.dataset.sourceEnd) > currentPosition.sourceOffset
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
        : preferReadableTop
          ? firstReadable || (anchoredVisible ? anchoredMarker : firstVisible)
        : firstVisible;
    if (!selected) return null;
    const lastTextMarker = [...positionMarkers].reverse().find((marker) => (
      marker.dataset.readerPositionKind === "text"
    ));
    const sourceOffset = atBottom
      && scroller.scrollTop > 0
      && selected === lastTextMarker
      ? preparedDocument?.text.length ?? Number(selected.dataset.sourceStart)
      : Number(selected.dataset.sourceStart);
    if (!Number.isFinite(sourceOffset)) return null;
    const position: ReaderPosition = selected.dataset.readerPositionKind === "figure"
      ? {
        kind: "figure",
        sourceOffset,
        figureIndex: Number(selected.dataset.figureIndex),
      }
      : { kind: "text", sourceOffset };
    if (syncSession && !applyingSession) {
      dispatchSession({
        type: sessionMode() === "page" ? "switchToPage" : "switchToSpots",
        position,
      });
    }
    return position;
  }

  function restorePagePosition(scroller: HTMLElement, positionMarkers: HTMLElement[]): void {
    const currentPosition = sessionPosition();
    const figureIndex = currentPosition.kind === "figure" ? currentPosition.figureIndex : -1;
    const target = currentPosition.kind === "figure"
      ? positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "figure"
        && Number(marker.dataset.figureIndex) === figureIndex
      ))
      : positionMarkers.find((marker) => (
        marker.dataset.readerPositionKind === "text"
        && Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset
        && Number(marker.dataset.sourceEnd) > currentPosition.sourceOffset
      )) || [...positionMarkers].reverse().find((marker) => (
        Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset
      ));
    const fallback = target || positionMarkers[0];
    if (!fallback) return;
    const targetRect = elementRect(fallback, 0, 100);
    const scrollerRect = elementRect(scroller, 0, scroller.clientHeight || 500);
    const targetY = targetRect.top - scrollerRect.top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, targetY - 72);
  }

  function schedulePageRestoreRelease(invalidate = true): void {
    const generation = invalidate ? ++pageRestoreGeneration : pageRestoreGeneration;
    const release = () => {
      if (generation === pageRestoreGeneration && !pageRestorePending) pageRestoring = false;
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(release));
    } else {
      release();
    }
  }

  function schedulePageRestore(element: HTMLElement, positionMarkers: HTMLElement[]): void {
    const generation = ++pageRestoreGeneration;
    const apply = () => {
      if (generation !== pageRestoreGeneration || pageScroller !== element) return;
      restorePagePosition(element, positionMarkers);
      pageRestoreScrollTop = element.scrollTop;
      pageRestorePending = false;
      const release = () => {
        if (generation === pageRestoreGeneration && pageScroller === element) pageRestoring = false;
      };
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(release));
      } else {
        release();
      }
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(apply));
    } else {
      apply();
    }
  }

  function elementRect(element: HTMLElement, fallbackTop: number, fallbackBottom: number): DOMRect {
    if (typeof element.getBoundingClientRect === "function") return element.getBoundingClientRect();
    return {
      top: fallbackTop,
      bottom: fallbackBottom,
      left: 0,
      right: 0,
      width: 0,
      height: fallbackBottom - fallbackTop,
      x: 0,
      y: fallbackTop,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function prepareReactFigure(item: ReaderFlowItem | undefined): void {
    if (!item || item.kind !== "figure") {
      invalidateFigureLoad();
      return;
    }
    const figure = preparedDocument?.figures[item.figureIndex];
    if (!figure) return;
    if (figureViewState.kind === "idle" || figureViewState.figureIndex !== item.figureIndex) {
      invalidateFigureLoad();
      const token = ++figureLoadToken;
      if (figure.kind === "code" || (figure.kind === "mermaid" && !figure.src)) {
        figureViewState = { kind: "ready", token, figureIndex: item.figureIndex, brightness: "revealed" };
        return;
      }
      figureViewState = { kind: "loading", token, figureIndex: item.figureIndex, brightness: "dimmed" };
      figureLoadRevealTimerId = globalThis.setTimeout(() => {
        figureLoadRevealTimerId = null;
        if (figureViewState.kind === "loading" && figureViewState.token === token) renderReactView(reactScreen());
      }, 100);
    }
  }

  function advanceFromFigure() {
    dispatchSession({ type: "resumeFromFigure" });
  }

  function invalidateFigureLoad(): void {
    figureLoadToken += 1;
    figureViewState = { kind: "idle" };
    if (figureLoadRevealTimerId !== null) {
      globalThis.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
  }

  function play() {
    dispatchSession({ type: "play" });
  }

  function pause() {
    dispatchSession({ type: "pause" });
  }

  function togglePlayPause() {
    if (readingSessionState()?.currentKind === "figure") {
      advanceFromFigure();
      return;
    }
    if (sessionPlaybackState() === "playing") {
      pause();
    } else {
      play();
    }
  }

  function goBackOneSentence() {
    dispatchSession({ type: "previousSentence" });
  }

  function jumpToHeading(headingIndex: number): void {
    if (!preparedDocument || preparedDocument.spots.length === 0) return;
    const transition = preparedDocument.sectionTransitions.find((entry) => entry.headingIndex === headingIndex);
    const targetOffset = transition?.offset ?? 0;
    if (sessionMode() === "page") {
      pageRestoring = true;
      dispatchSession({
        type: "switchToPage",
        position: { kind: "text", sourceOffset: targetOffset },
      });
      if (pageScroller) {
        restorePagePosition(pageScroller, pagePositionMarkers);
        pageRestoreScrollTop = pageScroller.scrollTop;
      }
      schedulePageRestoreRelease();
      return;
    }
    dispatchSession({
      type: "switchToSpots",
      position: { kind: "text", sourceOffset: targetOffset },
    });
    pause();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!root || event.repeat) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      trapFocus(event);
      return;
    }
    if (sessionMode() !== "spots" || isEditableTarget(event) || isImageSurfaceTarget(event)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      togglePlayPause();
    } else if (event.code === "ArrowLeft" || event.key === "ArrowLeft") {
      event.preventDefault();
      goBackOneSentence();
    }
  }

  function trapFocus(event: KeyboardEvent): void {
    if (!root) return;
    const active = readerActiveElement() || eventPath(event).find((target) => (
      typeof target === "object"
      && target !== null
      && target instanceof HTMLElement
      && containsReaderElement(target)
    )) as HTMLElement | undefined;
    if (sessionMode() === "page") {
      const activeMode = active?.getAttribute?.("data-reader-mode");
      const closeButton = findCloseButton();
      const spotsButton = findModeButton("spots");
      const pageButton = findModeButton("page");
      let nextPageControl: HTMLButtonElement | null = null;
      if (event.shiftKey) {
        if (active === closeButton) nextPageControl = pageButton;
        else if (activeMode === "spots") nextPageControl = closeButton;
        else if (activeMode === "page") nextPageControl = spotsButton;
      } else {
        if (active === closeButton) nextPageControl = spotsButton;
        else if (activeMode === "spots") nextPageControl = pageButton;
        else if (activeMode === "page") nextPageControl = closeButton;
      }
      if (nextPageControl) {
        event.preventDefault();
        nextPageControl.focus?.({ preventScroll: true });
        return;
      }
    }
    const focusable = focusableReaderElements();
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(active as HTMLElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
      : currentIndex < 0 || currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
    event.preventDefault();
    const next = focusable[nextIndex];
    next?.focus?.({ preventScroll: true });
    if (next && typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => {
        if (containsReaderElement(next)) next.focus?.({ preventScroll: true });
      }));
    }
  }

  function focusableReaderElements(): HTMLElement[] {
    if (!root) return [];
    const focusable: HTMLElement[] = [];
    const visited = new Set<Element>();
    const visit = (element: Element): void => {
      if (visited.has(element)) return;
      visited.add(element);
      for (const child of Array.from(element.children)) {
        const candidate = child as HTMLElement;
        if (isFocusableReaderElement(candidate)) focusable.push(candidate);
        visit(candidate);
      }
    };
    visit(root);
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
    return true;
  }

  function eventPath(event: Event): EventTarget[] {
    if (typeof event.composedPath === "function") return event.composedPath();
    return event.target ? [event.target] : [];
  }

  function isEditableTarget(event: KeyboardEvent): boolean {
    const targets = eventPath(event);
    for (const target of targets) {
      if (typeof target !== "object" || target === null) continue;
      const candidate = target as HTMLElement;
      const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
      if (candidate.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select") return true;
    }
    return false;
  }

  function isImageSurfaceTarget(event: KeyboardEvent): boolean {
    return eventPath(event).some((target) => (
      typeof target === "object"
      && target !== null
      && (target as HTMLElement).getAttribute?.("data-reader-image-surface") === "true"
    ));
  }

  function prefersReducedMotion() {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
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

  function removeOverlay() {
    cancelLoadingReveal();
    invalidateFigureLoad();
    detachKeydownListener();
    displayResizeObserver?.disconnect();
    displayResizeObserver = null;
    detachDialogCancelListener();
    const dialog = root;
    dialog?.removeEventListener("focusin", rememberReaderFocus as EventListener, true);
    if (dialog && isOpenDialog(dialog)) {
      try {
        dialog.close();
      } catch {
      }
    }
    const host = rootHost;
    try {
      unmountReactViewer();
      host?.remove();
    } finally {
      root = null;
      rootHost = null;
      readerShadow = null;
      rootStyle = null;
      loadingSlowVisible = false;
      loadingCoverVisible = false;
      display = null;
      pageScroller = null;
      pagePositionMarkers = [];
      pagePositionDirty = false;
      pageRestoreScrollTop = null;
      pageRestoring = false;
      pageRestorePending = false;
      pageRestoreGeneration += 1;
      reactPageFigureCorrections = new WeakMap();
      lastReaderFocusedElement = null;
      reactRenderedKind = null;
      reactLoadingRevealed = false;
    }
  }

  function isOpenDialog(element: HTMLDialogElement | HTMLDivElement): element is HTMLDialogElement {
    if (element.tagName.toLowerCase() !== "dialog") return false;
    const dialog = element as HTMLDialogElement;
    return dialog.open === true || dialog.hasAttribute("open");
  }

  function close(notifyServiceWorker = true, preserveSourceScroll = false) {
    if (closeInProgress) return;
    closeInProgress = true;
    detachSessionLifecycle();
    const requestId = sessionState && "requestId" in sessionState ? sessionState.requestId : null;
    try {
      if (sessionState?.phase === "preparing" && requestId && !applyingSession) {
        dispatchSession({ type: "cancel", requestId });
      }
      if (sessionHandle && !applyingSession) {
        dispatchSession({ type: "close" });
        sessionHandle.destroy();
      }
      sessionHandle = null;
      sessionState = null;
      if (notifyServiceWorker && requestId) {
        sendPreparationMessage({ type: "CANCEL_READER", requestId });
      }
      const restoreFocus = launchFocus;
      const restoreScroll = sourceScrollPosition;
      try {
        removeOverlay();
      } finally {
        try {
          restoreBackgroundInert();
        } finally {
          loadingStartedAt = null;
          preparedDocument = null;
          spotWidth = 0;
          launchFocus = null;
          restoreSourcePage();
          sourceScrollPosition = preserveSourceScroll ? restoreScroll : null;
          if (restoreFocus && restoreFocus.isConnected !== false && typeof restoreFocus.focus === "function") {
            focusAfterPaint(restoreFocus, restoreScroll);
          } else if (restoreScroll) {
            globalThis.scrollTo?.({ ...restoreScroll, behavior: "auto" });
          }
        }
      }
    } finally {
      closeInProgress = false;
    }
  }
})();

export {};
