(() => {
  type PlaybackState = "idle" | "paused" | "playing";
  type FigureViewState =
    | { kind: "idle" }
    | { kind: "loading"; token: number; figureIndex: number; brightness?: "dimmed" | "revealed" }
    | { kind: "ready"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "failed"; token: number; figureIndex: number };
  type ReactReaderBlock = ReaderBlock & { sentenceSpans: SentenceSpan[] };
  type ReaderMessage =
    | { type: "SHOW_RSVP_LOADING"; requestId: string }
    | { type: "START_RSVP"; requestId: string; text: string; readingContext?: Partial<ReadingContext> | null }
    | { type: "RSVP_ERROR"; requestId: string; reason?: PreparationFailure };

  if (globalThis.__rsvpReaderInstalled) return;
  globalThis.__rsvpReaderInstalled = true;

  const ROOT_ID = "__rsvp-reader-root";
  const DISPLAY_FONT_SIZE = "clamp(36px, 4.5vw, 64px)";
  const LOADER_REVEAL_DELAY_MS = 100;
  const SLOW_PREPARATION_DELAY_MS = 400;
  const LOADING_COVER_TRANSITION_MS = 220;

  function markPerformance(name: string): void {
    globalThis.performance?.mark?.(name);
  }

  let baseUnits: ReaderUnit[] = [];
  let units: ReaderUnit[] = [];
  let segmentationLocale = "ja";
  let currentGraphemeLimit = 12;
  let timerId: number | null = null;
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
  let loadingCoverTimerId: number | null = null;
  let display: HTMLDivElement | null = null;
  let headings: ReaderHeading[] = [];
  let sectionTransitions: ReaderSectionTransition[] = [];
  let initialHeadingIndex = -1;
  let activeRequestId: string | null = null;
  let displayResizeObserver: ResizeObserver | null = null;
  let figures: ReaderFigure[] = [];
  let flowItems: ReaderFlowItem[] = [];
  let figureViewState: FigureViewState = { kind: "idle" };
  let figureLoadToken = 0;
  let figureLoadRevealTimerId: number | null = null;
  let sourceText = "";
  let blocks: ReaderBlock[] = [];
  let viewBlocks: ReactReaderBlock[] = [];
  let currentPosition: ReaderPosition = { kind: "text", sourceOffset: 0 };
  let textScroller: HTMLElement | null = null;
  let textPositionMarkers: HTMLElement[] = [];
  let textPositionDirty = false;
  let textRestoreScrollTop: number | null = null;
  let textRestoring = false;
  let textRestoreGeneration = 0;
  let textRestorePending = false;
  let reactTextFigureCorrections = new WeakMap<HTMLImageElement, {
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
    scroll: { left: number; top: number };
  } | null = null;
  let inertedElements: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  let backgroundInert = false;
  let keydownListenerAttached = false;
  let lastReaderFocusedElement: HTMLElement | null = null;
  let dialogCancelListener: ((event: Event) => void) | null = null;
  let closeInProgress = false;
  let activePreparation: PreparationState = { kind: "idle" };
  let sessionState: ReaderSessionState | null = null;
  let sessionHandle: ReaderSessionHandle | null = null;
  let sessionInitPromise: Promise<void> | null = null;
  let pendingSessionCommands: ReaderSessionCommand[] = [];
  let sessionEnabled = false;
  let applyingSession = false;
  let sessionLifecycleAttached = false;
  let reactViewMount: ReaderReactViewerMount | null = null;
  let reactRenderedKind: ReactReaderViewModel["kind"] | null = null;
  let reactRenderedPositionKey: string | null = null;
  let reactLoadingRevealed = false;
  let performanceReactInitStarted = false;
  let performanceReactInitMarked = false;
  let performanceUnitMarked = false;

  type ReactReaderViewModel = {
    kind: "closed" | "loading" | "error" | "rsvp" | "text";
    slow?: boolean;
    revealed?: boolean;
    reducedMotion?: boolean;
    message?: string;
    canRetry?: boolean;
    previous?: string;
    next?: string;
    unit?: ReaderUnit | null;
    figure?: { figure: ReaderFigure; figureIndex: number; status: "loading" | "ready" | "failed" } | null;
    playing?: boolean;
    progress?: number;
    loadingCover?: boolean;
    headings?: ReaderHeading[];
    activeHeadingIndex?: number;
    blocks?: ReactReaderBlock[];
    figures?: ReaderFigure[];
    language?: string;
    position?: ReaderPosition;
    title?: string;
  };

  function reactViewerAvailable(): boolean {
    return typeof globalThis.ReaderReactViewer?.mount === "function";
  }

  function mountReactViewer(dialog: HTMLDialogElement): void {
    if (reactViewMount) return;
    if (!reactViewerAvailable()) throw new Error("reader_view_unavailable");
    const host = document.createElement("div");
    host.setAttribute("data-reader-react-root", "true");
    Object.assign(host.style, { position: "absolute", inset: "0", pointerEvents: "auto" });
    dialog.append(host);
    const viewer = globalThis.ReaderReactViewer;
    if (!viewer) throw new Error("reader_view_unavailable");
    performanceReactInitStarted = true;
    markPerformance("reader:react-init-start");
    try {
      reactViewMount = viewer.mount(host);
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
    performanceUnitMarked = false;
  }

  function renderReactView(model: ReactReaderViewModel): void {
    if (!reactViewMount) return;
    const wasVisibleLoading = reactRenderedKind === "loading" && reactLoadingRevealed;
    const previousDisplay = display;
    const previousPositionKey = reactRenderedPositionKey;
    const nextPositionKey = model.kind === "rsvp"
      ? model.figure
        ? `figure:${model.figure.figureIndex}`
        : `text:${model.unit?.start ?? 0}`
      : null;
    reactViewMount.render(model, {
      close,
      cancel: cancelLoading,
      retry: retryPreparation,
      switchToText: showTextView,
      switchToRsvp: showRsvpView,
      previousSentence: goBackOneSentence,
      headingSelect: jumpToHeading,
      togglePlayback: togglePlayPause,
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
      loadingAnimation: animateLoadingIndicator,
      rewindAnimation: animateRewindFeedback,
      textScroll: (element: HTMLElement | null) => {
        if (!element) {
          textScroller = null;
          textPositionMarkers = [];
          return;
        }
        textScroller = element;
        textPositionMarkers = [...element.querySelectorAll<HTMLElement>('[data-reader-position-kind="text"], [data-reader-position-kind="figure"]')];
        textRestoreScrollTop = element.scrollTop;
        attachReactTextFigureLoadCorrections(element);
        if (textRestorePending) {
          scheduleTextRestore(element, textPositionMarkers);
        }
      },
      textPosition: (element: HTMLElement) => {
        if (textRestoring) {
          if (textRestoreScrollTop === null || Math.abs(element.scrollTop - textRestoreScrollTop) < 1) return;
          if (textRestorePending) {
            textRestorePending = false;
            textRestoreGeneration += 1;
          }
        }
        updateTextPosition(element, textPositionMarkers);
        textRestoreScrollTop = element.scrollTop;
      },
    });
    if (model.kind === "rsvp" && model.unit && !performanceUnitMarked) {
      performanceUnitMarked = true;
      markPerformance("reader:first-unit");
    }
    if (performanceReactInitStarted && !performanceReactInitMarked) {
      performanceReactInitMarked = true;
      markPerformance("reader:react-init-end");
    }
    display = root?.querySelector?.<HTMLDivElement>('[data-reader-unit="true"]') || null;
    if (
      model.kind === "rsvp"
      && previousDisplay
      && previousPositionKey
      && nextPositionKey
      && previousPositionKey !== nextPositionKey
      && !prefersReducedMotion()
    ) {
      const enteringFigure = nextPositionKey.startsWith("figure:");
      previousDisplay.animate(
        enteringFigure ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
        { duration: 180, easing: "ease-out" },
      );
      if (enteringFigure) {
        root?.querySelector?.<HTMLElement>('[aria-label="本文画像"]')?.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 180, easing: "ease-out" },
        );
      }
    }
    const stage = root?.querySelector?.<HTMLDivElement>('[data-reader-stage="true"]');
    if (stage && model.kind === "rsvp" && wasVisibleLoading && !prefersReducedMotion()) {
      stage.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: LOADING_COVER_TRANSITION_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
    if (model.kind === "rsvp" && model.next && !prefersReducedMotion()) {
      root?.querySelector?.<HTMLDivElement>('[data-reader-context-next="true"]')?.animate(
        [{ opacity: 0.12 }, { opacity: 0.26 }],
        { duration: 120, easing: "ease-out" },
      );
    }
    reactLoadingRevealed = model.kind === "loading" && model.revealed !== false;
    reactRenderedKind = model.kind;
    reactRenderedPositionKey = nextPositionKey;
  }

  function reactViewModel(): ReactReaderViewModel {
    if (activePreparation.kind === "preparing") {
      return { kind: "loading", slow: loadingSlowVisible, revealed: loadingRevealTimerId === null, reducedMotion: prefersReducedMotion() };
    }
    if (activePreparation.kind === "failed") {
      return { kind: "error", message: preparationFailureLabel(activePreparation.reason), canRetry: true };
    }
    const state = readingSessionState();
    if (state?.mode === "text") {
      return {
        kind: "text",
        blocks: viewBlocks,
        figures,
        language: segmentationLocale,
        position: currentPosition,
        progress: sourceText ? globalThis.Engine.calculateReadingProgress(currentPosition.sourceOffset, sourceText.length) : 0,
        title: "",
      };
    }
    const item = state ? flowItems[state.flowIndex] : flowItems[0];
    const unitIndex = state?.unitIndex ?? (item?.kind === "unit" ? item.unitIndex : 0);
    const unit = item?.kind === "unit" ? units[unitIndex] || null : null;
    const figureIndex = item?.kind === "figure" ? item.figureIndex : null;
    const figure = figureIndex === null ? null : figures[figureIndex] || null;
    const figureState = figure && figureViewState.kind !== "idle" && figureViewState.figureIndex === figureIndex
      ? figureViewState.kind
      : figure ? "loading" : null;
    const figureView = figureIndex !== null && figure && figureState
      ? {
        figure,
        figureIndex,
        status: figureState,
        token: figureViewState.kind !== "idle" && figureViewState.figureIndex === figureIndex ? figureViewState.token : undefined,
        loadingVisible: figureState === "loading" && figureLoadRevealTimerId === null,
        brightness: figureViewState.kind === "ready" || figureViewState.kind === "loading"
          ? figureViewState.brightness || "dimmed"
          : "dimmed",
      }
      : null;
    const position = state?.position || currentPosition;
    return {
      kind: "rsvp",
      previous: unit ? globalThis.Engine.surroundingSentences(units, unitIndex).previous : "",
      next: unit ? globalThis.Engine.surroundingSentences(units, unitIndex).next : "",
      unit,
      figure: figureView,
      playing: state?.playback === "playing",
      reducedMotion: prefersReducedMotion(),
      progress: sourceText ? globalThis.Engine.calculateReadingProgress(position.sourceOffset, sourceText.length) : 0,
      loadingCover: loadingCoverVisible,
      headings,
      activeHeadingIndex: activeHeadingAt(position.sourceOffset),
    };
  }

  function settleReactFigure(figureIndex: number, loaded: boolean, token?: number): void {
    if (typeof token !== "number" || figureViewState.kind !== "loading" || figureViewState.figureIndex !== figureIndex || figureViewState.token !== token) return;
    if (figureLoadRevealTimerId !== null) {
      globalThis.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    const brightness = figureViewState.brightness;
    figureViewState = loaded
      ? { kind: "ready", token: figureViewState.token, figureIndex, brightness: brightness || "dimmed" }
      : { kind: "failed", token: figureViewState.token, figureIndex };
    renderReactView(reactViewModel());
  }

  function toggleReactFigureBrightness(figureIndex: number): void {
    if ((figureViewState.kind !== "ready" && figureViewState.kind !== "loading") || figureViewState.figureIndex !== figureIndex) return;
    figureViewState = { ...figureViewState, brightness: figureViewState.brightness === "revealed" ? "dimmed" : "revealed" };
    renderReactView(reactViewModel());
  }

  function readingSessionState(): ReaderSessionObservableState | null {
    return sessionState?.phase === "reading" ? sessionState : null;
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

  function sessionPlaybackState(): PlaybackState {
    const state = readingSessionState();
    if (state) return state.playback;
    return sessionState?.phase === "ended" ? "idle" : "paused";
  }

  function sessionMode(): ReaderSessionMode {
    return readingSessionState()?.mode ?? "rsvp";
  }

  function isReaderMessage(value: unknown): value is ReaderMessage {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;
    const message = value as Record<string, unknown>;
    if (typeof message.requestId !== "string") return false;
    if (message.type === "SHOW_RSVP_LOADING" || message.type === "RSVP_ERROR") return true;
    return message.type === "START_RSVP" && typeof message.text === "string";
  }

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isReaderMessage(message)) return;
    if (message?.type === "SHOW_RSVP_LOADING" && typeof message.requestId === "string") {
      showLoading(message.requestId);
      return;
    }

    if (message?.type === "START_RSVP" && typeof message.text === "string") {
      start(message.text, message.requestId, message.readingContext);
      return;
    }

    if (message?.type === "RSVP_ERROR") {
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
    activeRequestId = requestId;
    activePreparation = { kind: "preparing", requestId, startedAt: Date.now() };
    loadingSlowVisible = false;
    beginReaderSession(requestId);
    loadingStartedAt = Date.now();
    loadingRevealRequestId = requestId;
    loadingRevealTimerId = globalThis.setTimeout(() => {
      loadingRevealTimerId = null;
      if (requestId !== activeRequestId || requestId !== loadingRevealRequestId || reactRenderedKind === "loading") return;
      loadingRevealRequestId = null;
      createLoadingOverlay();
    }, LOADER_REVEAL_DELAY_MS);
    loadingSlowTimerId = globalThis.setTimeout(() => {
      loadingSlowTimerId = null;
      if (requestId !== activeRequestId || activePreparation.kind !== "preparing") return;
      if (!root) createLoadingOverlay();
      showSlowLoading();
    }, SLOW_PREPARATION_DELAY_MS);
  }

  function start(
    text: string,
    requestId: string,
    suppliedReadingContext: Partial<ReadingContext> | null | undefined,
  ): void {
    if (requestId !== activeRequestId || activePreparation.kind !== "preparing") return;

    const loadingWasVisible = loadingCoverVisible || (reactRenderedKind === "loading" && reactLoadingRevealed);
    const elapsed = loadingStartedAt === null ? 0 : Date.now() - loadingStartedAt;
    if (!loadingWasVisible && elapsed >= LOADER_REVEAL_DELAY_MS) {
      cancelLoadingReveal();
      createLoadingOverlay();
      if (elapsed >= SLOW_PREPARATION_DELAY_MS) showSlowLoading();
    } else {
      cancelLoadingReveal();
    }

    stopTimer();

    const content = globalThis.Extractor.fromText(
      text,
      suppliedReadingContext || collectReadingContext(text),
    );
    if (!content) {
      showError(requestId, "content_not_found");
      return;
    }
    const readingContext = content.readingContext;
    sourceText = content.text;
    blocks = Array.isArray(readingContext.blocks) ? readingContext.blocks : [];
    headings = readingContext.headings;
    sectionTransitions = readingContext.sectionTransitions;
    initialHeadingIndex = readingContext.initialHeadingIndex;
    figures = Array.isArray(readingContext.figures) ? readingContext.figures : [];

    const figureBoundaries = figures.flatMap((figure) => [figure.sourceOffset, figure.sourceEnd]);
    segmentationLocale = readingContext.language;
    viewBlocks = buildViewBlocks(blocks.length > 0 ? blocks : fallbackBlocks(sourceText), segmentationLocale);
    baseUnits = globalThis.Engine.segmentText(content.text, segmentationLocale, figureBoundaries)
      .map((unit) => {
        const value = unit.text.trim();
        const leadingWhitespace = unit.text.length - unit.text.trimStart().length;
        return { ...unit, text: value, start: unit.start + leadingWhitespace, end: unit.start + leadingWhitespace + value.length };
      })
      .filter((unit) => unit.text.trim().length > 0)
      .filter((unit) => !figures.some((figure) => (
        figure.sourceEnd > figure.sourceOffset
        && unit.start >= figure.sourceOffset
        && unit.end <= figure.sourceEnd
      )));
    if (baseUnits.length === 0) {
      showError(requestId, "content_not_found");
      return;
    }

    units = baseUnits;
    currentGraphemeLimit = 12;
    flowItems = globalThis.Engine.buildReadingFlow(units, figures);
    currentPosition = flowItems[0]
      ? globalThis.Engine.positionForFlowItem(flowItems[0], units)
      : { kind: "text", sourceOffset: 0 };
    activePreparation = { kind: "ready", requestId };
    createOverlay();
    rebuildUnitsForViewport();
    renderReactView(reactViewModel());
    if (loadingCoverVisible) {
      if (loadingCoverTimerId !== null) globalThis.clearTimeout(loadingCoverTimerId);
      loadingCoverTimerId = globalThis.setTimeout(() => {
        loadingCoverTimerId = null;
        loadingCoverVisible = false;
        renderReactView(reactViewModel());
      }, LOADING_COVER_TRANSITION_MS);
    }
    dispatchSession({
      type: "prepareSucceeded",
      requestId,
      flow: sessionPreparation(),
    });
    focusAfterPaint(findCloseButton());
  }

  function readerSessionAvailable(): boolean {
    const candidate = globalThis.ReaderSession;
    return typeof candidate?.init === "function"
      && typeof candidate.create === "function"
      && typeof candidate.dispatch === "function";
  }

  function sessionPreparation(): ReaderSessionPreparation {
    return {
      textLength: sourceText.length,
      units: units.map((unit, index) => {
        const nextUnit = units[index + 1];
        return {
          sentenceIndex: unit.sentenceIndex,
          kind: unit.kind,
          start: unit.start,
          end: unit.end,
          durationMs: globalThis.Engine.displayDuration(
            unit,
            nextUnit,
            Boolean(nextUnit) && activeHeadingAt(unit.start) !== activeHeadingAt(nextUnit?.start ?? unit.start),
          ),
        };
      }),
      figures: figures.map((figure) => ({
        sourceOffset: figure.sourceOffset,
        sourceEnd: figure.sourceEnd,
      })),
      flow: flowItems,
    };
  }

  function beginReaderSession(requestId: string): void {
    attachSessionLifecycle();
    pendingSessionCommands = [{ type: "open", requestId }];
    if (!readerSessionAvailable()) {
      showSessionUnavailable(requestId);
      return;
    }
    if (globalThis.ReaderSession.ready()) {
      if (sessionHandle) {
        if (!applyingSession) dispatchSession({ type: "close" });
        globalThis.ReaderSession.destroy(sessionHandle);
        sessionHandle = null;
        sessionState = null;
        sessionEnabled = false;
      }
      sessionHandle = globalThis.ReaderSession.create();
      sessionState = sessionHandle.state;
      sessionEnabled = true;
      const queued = pendingSessionCommands;
      pendingSessionCommands = [];
      for (const command of queued) dispatchSession(command);
      return;
    }
    if (!sessionInitPromise) {
      markPerformance("reader:session-init-start");
      markPerformance("reader:wasm-init-start");
      sessionInitPromise = globalThis.ReaderSession.init()
        .then(() => {
          markPerformance("reader:session-init-end");
          markPerformance("reader:wasm-init-end");
          const currentRequestId = activeRequestId;
          if (!currentRequestId || activePreparation.kind === "cancelled") return;
          if (sessionHandle) {
            if (!applyingSession) dispatchSession({ type: "close" });
            globalThis.ReaderSession.destroy(sessionHandle);
            sessionHandle = null;
            sessionState = null;
            sessionEnabled = false;
          }
          sessionHandle = globalThis.ReaderSession.create();
          sessionState = sessionHandle.state;
          sessionEnabled = true;
          const queued = pendingSessionCommands;
          pendingSessionCommands = [];
          for (const command of queued) dispatchSession(command);
        })
        .catch(() => {
          sessionInitPromise = null;
          const currentRequestId = activeRequestId;
          if (currentRequestId) showSessionUnavailable(currentRequestId);
        });
    }
  }

  function showSessionUnavailable(requestId: string): void {
    if (requestId !== activeRequestId) return;
    dispatchSession({ type: "prepareFailed", requestId, reason: "session_unavailable" });
    showError(requestId, "session_unavailable");
  }

  function syncReaderSessionState(): void {
    const state = sessionState;
    if (!state) return;
    if (state.phase === "reading" && state.position) currentPosition = state.position;
  }

  function dispatchSession(command: ReaderSessionCommand): void {
    if (applyingSession) return;
    if (!sessionEnabled || !sessionHandle || !sessionState) {
      if (command.type === "open") pendingSessionCommands = [command];
      else pendingSessionCommands.push(command);
      return;
    }
    const transition = globalThis.ReaderSession.dispatch(sessionHandle, command);
    sessionState = transition.state;
    syncReaderSessionState();
    applyingSession = true;
    try {
      for (const effect of transition.effects) {
        if (effect.type === "cancelTimer") {
          stopTimer();
        } else if (effect.type === "scheduleTick") {
          stopTimer();
          const scheduledHandle = sessionHandle;
          const scheduledTimerId = globalThis.setTimeout(() => {
            if (timerId !== scheduledTimerId) return;
            timerId = null;
            if (
              !scheduledHandle
              || sessionHandle !== scheduledHandle
              || !sessionEnabled
              || sessionState?.phase !== "reading"
              || sessionState.generation !== effect.generation
              || sessionState.playback !== "playing"
            ) return;
            dispatchSession({ type: "tick", generation: effect.generation });
          }, effect.delayMs);
          timerId = scheduledTimerId;
        }
      }
      renderSessionState();
    } finally {
      applyingSession = false;
    }
  }

  function renderSessionState(): void {
    prepareReactFigure(flowItems[sessionFlowIndex()]);
    renderReactView(reactViewModel());
  }

  function createLoadingOverlay() {
    loadingCoverVisible = true;
    if (!root) root = createRoot();
    renderReactView(reactViewModel());
    attachKeydownListener();
  }

  function showSlowLoading(): void {
    loadingSlowVisible = true;
    if (reactViewMount) {
      renderReactView(reactViewModel());
      focusAfterPaint(findLoadingCancelButton());
      return;
    }
    if (!root) root = createRoot();
    renderReactView(reactViewModel());
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
    const requestId = activeRequestId;
    if (!requestId) return;
    sendPreparationMessage({ type: "CANCEL_RSVP", requestId });
    dispatchSession({ type: "cancel", requestId });
    activePreparation = { kind: "cancelled", requestId };
    close(false);
  }

  function showError(requestId: string, reason: PreparationFailure = "extraction_failed"): void {
    if (requestId !== activeRequestId) return;
    if (reason !== "session_unavailable") {
      dispatchSession({ type: "prepareFailed", requestId, reason });
    }
    cancelLoadingReveal();
    activePreparation = { kind: "failed", requestId, reason };
    loadingCoverVisible = false;
    if (loadingCoverTimerId !== null) {
      globalThis.clearTimeout(loadingCoverTimerId);
      loadingCoverTimerId = null;
    }
    if (!root) root = createRoot();
    renderReactView(reactViewModel());
    attachKeydownListener();
    focusAfterPaint(findCloseButton());
    return;
  }

  function preparationFailureLabel(reason: PreparationFailure): string {
    if (reason === "content_not_found") return "文章を読み取れませんでした";
    if (reason === "unsupported_page") return "このページはまだ開けません";
    return "文章を準備できませんでした";
  }

  function retryPreparation(): void {
    const requestId = activeRequestId;
    if (!requestId) return;
    sendPreparationMessage({ type: "RETRY_RSVP", requestId });
  }

  function sendPreparationMessage(message: { type: "CANCEL_RSVP" | "RETRY_RSVP"; requestId: string }): void {
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
    renderReactView(reactViewModel());
    attachKeydownListener();
    focusAfterPaint(findCloseButton());
    if (typeof globalThis.ResizeObserver === "function" && root && !displayResizeObserver) {
      displayResizeObserver = new globalThis.ResizeObserver(() => {
        if (rebuildUnitsForViewport()) renderSessionState();
      });
      displayResizeObserver.observe(root);
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
      WebkitFontSmoothing: "antialiased",
    });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        display: block !important;
        pointer-events: none !important;
        color-scheme: dark !important;
        contain: layout style paint;
      }

      *, *::before, *::after { box-sizing: border-box; }
      button, input, select, textarea { font: inherit; }
      button { appearance: none; -webkit-appearance: none; }
      img { max-width: 100%; filter: none; }
      svg { max-width: 100%; }

      dialog.reader-dialog {
        all: initial;
        display: block;
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100dvh;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 0;
        border: 0;
        box-sizing: border-box;
        background: #090909;
        color: #fff;
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
        line-height: normal;
        writing-mode: horizontal-tb;
        pointer-events: auto;
        overflow: hidden;
      }

      dialog.reader-dialog::backdrop { background: transparent; }
      nav::-webkit-scrollbar { display: none; }
      [data-reader-text-scroller] { overscroll-behavior: contain; }
      nav button:focus-visible { outline: 1px solid rgba(255,255,255,0.72); outline-offset: -2px; }
      @media (max-width: 1080px) {
        [data-reader-stage] { width: calc(100% - 32px) !important; height: calc(100% - 32px) !important; grid-template-columns: minmax(0, 1fr) !important; column-gap: 0 !important; }
        [data-reader-minimap] { display: none !important; }
      }
      @media (max-width: 720px) {
        [data-reader-stage] { width: 100% !important; height: 100% !important; }
        [data-reader-text-shell] { width: 100% !important; height: 100% !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; }
        [data-reader-text-scroller] { padding: 64px 20px 96px !important; }
      }
      @media (prefers-contrast: more) {
        :host {
          --reader-contrast-text: #ffffff;
          --reader-contrast-background: #000000;
        }

        [data-reader-topbar] button,
        [data-reader-stage] button { color: var(--reader-contrast-text) !important; }

        [data-reader-topbar] button {
          background: var(--reader-contrast-background) !important;
          border: 1px solid var(--reader-contrast-text) !important;
        }

        [data-reader-topbar] [data-reader-mode-button] {
          background: var(--reader-contrast-text) !important;
          color: var(--reader-contrast-background) !important;
        }

        [data-reader-stage] [aria-label="1文戻る"],
        [data-reader-stage] [aria-label="再生"],
        [data-reader-stage] [aria-label="一時停止"],
        [data-reader-stage] [aria-label="続きを読む"] {
          background: var(--reader-contrast-background) !important;
          border: 1px solid var(--reader-contrast-text) !important;
          color: var(--reader-contrast-text) !important;
        }

        [data-reader-stage] [aria-label="続きを読む"],
        [data-reader-minimap] button[aria-current="location"] {
          background: var(--reader-contrast-text) !important;
          color: var(--reader-contrast-background) !important;
        }

        [data-reader-stage] [data-reader-context-previous],
        [data-reader-stage] [data-reader-context-next],
        [data-reader-progress],
        [data-reader-text-shell] .article {
          color: var(--reader-contrast-text) !important;
          opacity: 1 !important;
        }

        [data-reader-minimap] {
          background: var(--reader-contrast-background) !important;
          border-color: var(--reader-contrast-text) !important;
          box-shadow: none !important;
          color: var(--reader-contrast-text) !important;
        }

        [data-reader-minimap] button {
          background: transparent !important;
          border: 1px solid transparent !important;
          color: var(--reader-contrast-text) !important;
        }

        [data-reader-minimap] button[aria-current="location"] {
          border-color: var(--reader-contrast-text) !important;
        }

        [data-reader-figure-status],
        [data-reader-figure-description],
        figcaption,
        [data-reader-loading-label],
        [data-reader-error] {
          color: var(--reader-contrast-text) !important;
        }

        [data-reader-figure-indicator],
        [data-reader-loading-bar],
        [data-reader-loading-indicator] {
          background: var(--reader-contrast-text) !important;
        }

        [data-reader-loading] button,
        [data-reader-error] button {
          background: var(--reader-contrast-background) !important;
          border: 1px solid var(--reader-contrast-text) !important;
          color: var(--reader-contrast-text) !important;
        }

        [data-reader-topbar] button:focus-visible,
        [data-reader-stage] button:focus-visible,
        [data-reader-minimap] button:focus-visible,
        [data-reader-loading] button:focus-visible,
        [data-reader-error] button:focus-visible,
        [data-reader-image-surface]:focus-visible {
          outline: 2px solid var(--reader-contrast-text) !important;
          outline-offset: 2px !important;
        }
      }
    `;
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
      scroll,
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
    if (!root) return null;
    const queried = root.querySelector?.<HTMLButtonElement>('[aria-label="readerを閉じる"]');
    if (queried) return queried;
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
    return find(root);
  }

  function findLoadingCancelButton(): HTMLButtonElement | null {
    return root?.querySelector?.<HTMLButtonElement>('[data-reader-loading-cancel="true"]') || null;
  }

  function findModeButton(): HTMLButtonElement | null {
    if (!root) return null;
    const queried = root.querySelector?.<HTMLButtonElement>('[data-reader-mode-button="true"]');
    if (queried) return queried;
    const find = (element: Element): HTMLButtonElement | null => {
      for (const child of Array.from(element.children)) {
        const candidate = child as HTMLElement;
        if (candidate.tagName.toLowerCase() === "button" && candidate.getAttribute?.("data-reader-mode-button") === "true") {
          return candidate as HTMLButtonElement;
        }
        const nested = find(candidate);
        if (nested) return nested;
      }
      return null;
    };
    return find(root);
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
    if (typeof root.contains === "function") return root.contains(element);
    let current: HTMLElement | null = element;
    while (current) {
      if (current === root) return true;
      current = current.parentElement;
    }
    return false;
  }

  function focusCloseIfNeeded(previousFocus: HTMLElement | null): void {
    if (containsReaderElement(previousFocus)) return;
    const closeButton = findCloseButton();
    const focusClose = () => {
      if (readerHasFocus()) return;
      if (containsReaderElement(closeButton)) closeButton?.focus?.({ preventScroll: true });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        focusClose();
        globalThis.requestAnimationFrame(focusClose);
      });
    } else {
      focusClose();
    }
  }

  function readerHasFocus(): boolean {
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

  function showTextView() {
    if (!root || !sourceText) return;
    const activeElement = readerActiveElement();
    textRestoring = true;
    textRestorePending = true;
    if (!applyingSession) {
      dispatchSession({ type: "switchToText", position: currentPosition });
    }
    renderReactView(reactViewModel());
    attachKeydownListener();
    focusCloseIfNeeded(activeElement);
    return;
  }

  function showRsvpView() {
    if (!root || units.length === 0) return;
    const previousFocus = readerActiveElement();
    const restoreModeFocus = previousFocus?.getAttribute?.("data-reader-mode-button") === "true";
    const modeRestorePending = textRestorePending;
    textRestorePending = false;
    let capturedPosition = currentPosition;
    if (sessionMode() === "text" && textScroller) {
      const scrollChanged = textRestoreScrollTop === null || Math.abs(textScroller.scrollTop - textRestoreScrollTop) >= 1;
      if (!modeRestorePending || scrollChanged) {
        textRestoring = true;
        updateTextPosition(textScroller, textPositionMarkers, true, false);
      }
      capturedPosition = currentPosition;
    }
    dispatchSession({ type: "switchToRsvp", position: capturedPosition });
    renderReactView(reactViewModel());
    scheduleTextRestoreRelease();
    attachKeydownListener();
    if (restoreModeFocus) focusAfterPaint(findModeButton());
    return;
  }

  function fallbackBlocks(text: string): ReaderBlock[] {
    const result: ReaderBlock[] = [];
    let searchFrom = 0;
    for (const rawValue of text.split(/\n\s*\n|\n(?=\s*[\p{L}\p{N}「『（(])/u)) {
      const value = rawValue.trim();
      if (!value) continue;
      const start = text.indexOf(value, searchFrom);
      result.push({ text: value, kind: "paragraph", level: null, start, end: start + value.length });
      searchFrom = start + value.length;
    }
    return result;
  }

  function buildViewBlocks(sourceBlocks: ReaderBlock[], locale: string): ReactReaderBlock[] {
    return sourceBlocks.map((block) => ({ ...block, sentenceSpans: globalThis.Engine.splitSentenceSpans(block.text, locale) }));
  }

  function attachReactTextFigureLoadCorrections(scroller: HTMLElement): void {
    const positionMarkers = [...scroller.querySelectorAll<HTMLElement>('[data-reader-position-kind="text"], [data-reader-position-kind="figure"]')];
    for (const figureElement of scroller.querySelectorAll<HTMLElement>('[data-reader-text-figure="true"]')) {
      const image = figureElement.querySelector<HTMLImageElement>("img");
      if (!image) continue;
      const existing = reactTextFigureCorrections.get(image);
      if (existing) {
        existing.scroller = scroller;
        existing.positionMarkers = positionMarkers;
        continue;
      }
      const currentMarker = currentTextPositionMarker(positionMarkers);
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
      reactTextFigureCorrections.set(image, correction);
      const adjustAfterDecode = async () => {
        if (correction.settled) return;
        correction.settled = true;
        if (!correction.shouldCorrect || textScroller !== correction.scroller) return;
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch {
        }
        if (textScroller !== correction.scroller) return;
        const applyCorrection = () => {
          if (textScroller !== correction.scroller || !correction.currentMarker) return;
          const afterTop = elementRect(correction.currentMarker, 0, 100).top;
          const delta = afterTop - correction.beforeTop;
          if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
            textRestoring = true;
            correction.scroller.scrollTop += delta;
            textRestoreScrollTop = correction.scroller.scrollTop;
            scheduleTextRestoreRelease(false);
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
      && Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset
      && Number(marker.dataset.sourceEnd) > currentPosition.sourceOffset
    )) || [...positionMarkers].reverse().find((marker) => (
      Number(marker.dataset.sourceStart) <= currentPosition.sourceOffset
    ));
  }

  function updateTextPosition(
    scroller: HTMLElement,
    positionMarkers: HTMLElement[],
    preferReadableTop = false,
    syncSession = true,
  ): void {
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
    if (!selected) return;
    const sourceOffset = Number(selected.dataset.sourceStart);
    if (!Number.isFinite(sourceOffset)) return;
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

  function restoreTextPosition(scroller: HTMLElement, positionMarkers: HTMLElement[]): void {
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

  function scheduleTextRestoreRelease(invalidate = true): void {
    const generation = invalidate ? ++textRestoreGeneration : textRestoreGeneration;
    const release = () => {
      if (generation === textRestoreGeneration && !textRestorePending) textRestoring = false;
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(release));
    } else {
      release();
    }
  }

  function scheduleTextRestore(element: HTMLElement, positionMarkers: HTMLElement[]): void {
    const generation = ++textRestoreGeneration;
    const apply = () => {
      if (generation !== textRestoreGeneration || textScroller !== element) return;
      restoreTextPosition(element, positionMarkers);
      textRestoreScrollTop = element.scrollTop;
      textRestorePending = false;
      const release = () => {
        if (generation === textRestoreGeneration && textScroller === element) textRestoring = false;
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

  function computedFixedFontSize(): number {
    const computedStyle = display ? globalThis.getComputedStyle?.(display) : null;
    const value = Number.parseFloat(computedStyle?.fontSize || "");
    return Number.isFinite(value) && value > 0 ? value : 64;
  }

  function maxGraphemesForViewport(): number {
    const displayAreaWidth = display?.clientWidth || globalThis.innerWidth || 0;
    const availableWidth = Math.max(160, displayAreaWidth - 32);
    const fontSize = computedFixedFontSize();
    return Math.min(12, Math.max(3, Math.floor(availableWidth / fontSize)));
  }

  function rebuildUnitsForViewport(): boolean {
    if (baseUnits.length === 0) return false;
    const nextLimit = maxGraphemesForViewport();
    if (nextLimit === currentGraphemeLimit && units.length > 0) return false;

    const position = currentPosition;
    currentGraphemeLimit = nextLimit;
    units = globalThis.Engine.splitLongUnits(baseUnits, segmentationLocale, currentGraphemeLimit);
    flowItems = globalThis.Engine.buildReadingFlow(units, figures);
    if (!applyingSession) {
      dispatchSession({
        type: "rebuildUnits",
        units: sessionPreparation().units,
        position,
      });
    }
    return true;
  }

  function activeHeadingAt(offset: number): number {
    return globalThis.Engine.findActiveHeadingIndex(
      sectionTransitions,
      offset,
      initialHeadingIndex,
    );
  }

  function prepareReactFigure(item: ReaderFlowItem | undefined): void {
    if (!item || item.kind !== "figure") {
      invalidateFigureLoad();
      return;
    }
    const figure = figures[item.figureIndex];
    if (!figure) return;
    if (figureViewState.kind === "idle" || figureViewState.figureIndex !== item.figureIndex) {
      invalidateFigureLoad();
      const token = ++figureLoadToken;
      figureViewState = { kind: "loading", token, figureIndex: item.figureIndex };
      figureLoadRevealTimerId = globalThis.setTimeout(() => {
        figureLoadRevealTimerId = null;
        if (figureViewState.kind === "loading" && figureViewState.token === token) renderReactView(reactViewModel());
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
    if (units.length === 0) return;
    const transition = sectionTransitions.find((entry) => entry.headingIndex === headingIndex);
    const targetOffset = transition?.offset ?? 0;
    dispatchSession({
      type: "switchToRsvp",
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
    if (isEditableTarget(event) || isButtonTarget(event)) return;
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
    const focusable = focusableReaderElements();
    if (focusable.length === 0) return;
    const active = readerActiveElement() || eventPath(event).find((target) => (
      typeof target === "object"
      && target !== null
      && target instanceof HTMLElement
      && containsReaderElement(target)
    )) as HTMLElement | undefined;
    const currentIndex = focusable.indexOf(active as HTMLElement);
    const textShell = root.querySelector?.("[data-reader-text-shell]");
    const activeTopbar = active?.parentElement?.getAttribute?.("data-reader-topbar") === "true";
    if (textShell && activeTopbar) {
      const isCloseButton = active?.getAttribute?.("aria-label") === "readerを閉じる";
      const closeButton = findCloseButton();
      const modeButton = active?.parentElement?.querySelector?.("button:not([aria-label='readerを閉じる'])") as HTMLButtonElement | null;
      const nextTopbarButton = event.shiftKey && !isCloseButton ? closeButton : !event.shiftKey && isCloseButton ? modeButton : null;
      if (nextTopbarButton) {
        event.preventDefault();
        nextTopbarButton.focus?.({ preventScroll: true });
        return;
      }
    }
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
    const visit = (element: Element): void => {
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

  function isButtonTarget(event: KeyboardEvent): boolean {
    return eventPath(event).some((target) => (
      typeof target === "object"
      && target !== null
      && (target as HTMLElement).tagName?.toLowerCase() === "button"
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

  function stopTimer() {
    if (timerId !== null) {
      globalThis.clearTimeout(timerId);
      timerId = null;
    }
  }

  function removeOverlay() {
    cancelLoadingReveal();
    invalidateFigureLoad();
    if (loadingCoverTimerId !== null) {
      globalThis.clearTimeout(loadingCoverTimerId);
      loadingCoverTimerId = null;
    }
    stopTimer();
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
      textScroller = null;
      textPositionMarkers = [];
      textPositionDirty = false;
      textRestoreScrollTop = null;
      textRestoring = false;
      textRestorePending = false;
      textRestoreGeneration += 1;
      reactTextFigureCorrections = new WeakMap();
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
    const requestId = activeRequestId;
    try {
      if (activePreparation.kind === "preparing" && requestId && !applyingSession) {
        dispatchSession({ type: "cancel", requestId });
      }
      if (sessionHandle && !applyingSession) {
        dispatchSession({ type: "close" });
        globalThis.ReaderSession.destroy(sessionHandle);
      }
      sessionHandle = null;
      sessionEnabled = false;
      sessionState = null;
      pendingSessionCommands = [];
      if (notifyServiceWorker && requestId) {
        sendPreparationMessage({ type: "CANCEL_RSVP", requestId });
        if (activePreparation.kind !== "idle") activePreparation = { kind: "cancelled", requestId };
      }
      const restoreFocus = launchFocus;
      const restoreScroll = sourceScrollPosition;
      try {
        stopTimer();
        removeOverlay();
      } finally {
        try {
          restoreBackgroundInert();
        } finally {
          activeRequestId = null;
          activePreparation = { kind: "idle" };
          loadingStartedAt = null;
          units = [];
          headings = [];
          sectionTransitions = [];
          initialHeadingIndex = -1;
          figures = [];
          flowItems = [];
          sourceText = "";
          blocks = [];
          viewBlocks = [];
          baseUnits = [];
          currentPosition = { kind: "text", sourceOffset: 0 };
          segmentationLocale = "ja";
          currentGraphemeLimit = 12;
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
