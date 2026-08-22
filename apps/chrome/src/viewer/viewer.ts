(() => {
  type PlaybackState = "idle" | "paused" | "playing";
  type FigureViewState =
    | { kind: "idle" }
    | { kind: "loading"; token: number; figureIndex: number }
    | { kind: "ready"; token: number; figureIndex: number; brightness: "dimmed" | "revealed" }
    | { kind: "failed"; token: number; figureIndex: number };
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
  let loadingLayer: HTMLDivElement | null = null;
  let loadingRevealTimerId: number | null = null;
  let loadingSlowTimerId: number | null = null;
  let loadingRevealRequestId: string | null = null;
  let loadingStartedAt: number | null = null;
  let loadingIndicator: HTMLDivElement | null = null;
  let loadingIndicatorAnimation: Animation | null = null;
  let loadingStatus: HTMLDivElement | null = null;
  let loadingCancelButton: HTMLButtonElement | null = null;
  let previousContext: HTMLDivElement | null = null;
  let display: HTMLDivElement | null = null;
  let nextContext: HTMLDivElement | null = null;
  let contextSentenceIndex: number | null = null;
  let playPauseButton: HTMLButtonElement | null = null;
  let headings: ReaderHeading[] = [];
  let headingNodes: HTMLButtonElement[] = [];
  let sectionTransitions: ReaderSectionTransition[] = [];
  let initialHeadingIndex = -1;
  let activeRequestId: string | null = null;
  let progressLabel: HTMLSpanElement | null = null;
  let displayResizeObserver: ResizeObserver | null = null;
  let figures: ReaderFigure[] = [];
  let flowItems: ReaderFlowItem[] = [];
  let figurePanel: HTMLElement | null = null;
  let figureViewState: FigureViewState = { kind: "idle" };
  let figureLoadToken = 0;
  let figureLoadRevealTimerId: number | null = null;
  let readerMain: HTMLDivElement | null = null;
  let sourceText = "";
  let blocks: ReaderBlock[] = [];
  let currentPosition: ReaderPosition = { kind: "text", sourceOffset: 0 };
  let textScroller: HTMLElement | null = null;
  let textPositionMarkers: HTMLElement[] = [];
  let textPositionDirty = false;
  let textRestoreScrollTop: number | null = null;
  let textRestoring = false;
  let launchFocus: HTMLElement | null = null;
  let sourceScrollPosition: { left: number; top: number } | null = null;
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") dispatchSession({ type: "visibilityHidden" });
  });

  function showLoading(requestId: string): void {
    const existingLaunchFocus = launchFocus
      && launchFocus.isConnected !== false
      ? launchFocus
      : null;
    const activeElement = document.activeElement;
    sourceScrollPosition = {
      left: globalThis.scrollX || 0,
      top: globalThis.scrollY || 0,
    };
    close(false, true);
    launchFocus = existingLaunchFocus || (activeElement && typeof (activeElement as HTMLElement).focus === "function"
      ? activeElement as HTMLElement
      : null);
    activeRequestId = requestId;
    activePreparation = { kind: "preparing", requestId, startedAt: Date.now() };
    beginReaderSession(requestId);
    loadingStartedAt = Date.now();
    loadingRevealRequestId = requestId;
    loadingRevealTimerId = globalThis.setTimeout(() => {
      loadingRevealTimerId = null;
      if (requestId !== activeRequestId || requestId !== loadingRevealRequestId || loadingLayer) return;
      loadingRevealRequestId = null;
      createLoadingOverlay();
    }, LOADER_REVEAL_DELAY_MS);
    loadingSlowTimerId = globalThis.setTimeout(() => {
      loadingSlowTimerId = null;
      if (requestId !== activeRequestId || activePreparation.kind !== "preparing") return;
      if (!loadingLayer) createLoadingOverlay();
      showSlowLoading();
    }, SLOW_PREPARATION_DELAY_MS);
  }

  function start(
    text: string,
    requestId: string,
    suppliedReadingContext: Partial<ReadingContext> | null | undefined,
  ): void {
    if (requestId !== activeRequestId || activePreparation.kind !== "preparing") return;

    const loadingWasVisible = loadingLayer !== null;
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
    createOverlay();
    rebuildUnitsForViewport();
    activePreparation = { kind: "ready", requestId };
    renderCurrentFlowItem();
    dispatchSession({
      type: "prepareSucceeded",
      requestId,
      flow: sessionPreparation(),
    });
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
      sessionInitPromise = globalThis.ReaderSession.init()
        .then(() => {
          markPerformance("reader:session-init-end");
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
    updatePlayPauseButton();
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
            if (!scheduledHandle || sessionHandle !== scheduledHandle || !sessionEnabled) return;
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
    const state = sessionState;
    if (!state || state.phase !== "reading" || state.mode !== "rsvp") return;
    renderCurrentFlowItem();
  }

  function createLoadingOverlay() {
    if (loadingLayer) return;
    root = createRoot();
    loadingLayer = document.createElement("div");
    loadingLayer.setAttribute("data-reader-loading", "true");
    Object.assign(loadingLayer.style, {
      position: "absolute",
      inset: "0",
    });

    const track = document.createElement("div");
    track.setAttribute("data-reader-loading-bar", "true");
    track.setAttribute("aria-hidden", "true");
    Object.assign(track.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(180px, calc(100% - 48px))",
      height: "2px",
      borderRadius: "999px",
      overflow: "hidden",
      background: "rgba(255,255,255,0.18)",
      pointerEvents: "none",
    });

    const indicator = document.createElement("div");
    indicator.setAttribute("data-reader-loading-indicator", "true");
    Object.assign(indicator.style, {
      width: "100%",
      height: "100%",
      borderRadius: "inherit",
      background: "rgba(255,255,255,0.82)",
      transform: "translateX(-100%) scaleX(.35)",
      transformOrigin: "left center",
    });
    if (!prefersReducedMotion()) {
      loadingIndicatorAnimation = indicator.animate(
        [
          { transform: "translateX(-100%) scaleX(.35)" },
          { transform: "translateX(220%) scaleX(.35)" },
        ],
        { duration: 1100, iterations: Infinity, easing: "linear" },
      );
    } else indicator.style.transform = "translateX(0) scaleX(.35)";
    loadingIndicator = indicator;
    track.append(indicator);
    loadingLayer.append(track);
    root.append(loadingLayer);
    attachKeydownListener();
  }

  function showSlowLoading(): void {
    if (!loadingLayer || loadingStatus || loadingCancelButton) return;
    loadingLayer.style.pointerEvents = "auto";
    loadingStatus = document.createElement("div");
    loadingStatus.setAttribute("data-reader-loading-label", "true");
    loadingStatus.setAttribute("role", "status");
    loadingStatus.textContent = "文章を準備しています";
    Object.assign(loadingStatus.style, {
      position: "absolute",
      left: "50%",
      top: "calc(50% + 24px)",
      transform: "translateX(-50%)",
      color: "rgba(255,255,255,0.82)",
      fontSize: "14px",
      whiteSpace: "nowrap",
    });

    loadingCancelButton = createButton("中止", cancelLoading);
    Object.assign(loadingCancelButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });
    const closeButton = createButton("閉じる", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      right: "24px",
      bottom: "24px",
      pointerEvents: "auto",
    });
    loadingLayer.append(loadingStatus, loadingCancelButton, closeButton);
    focusAfterPaint(loadingCancelButton);
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
    loadingIndicatorAnimation?.cancel?.();
    loadingIndicatorAnimation = null;
    loadingIndicator = null;
    loadingStatus = null;
    loadingCancelButton = null;
    loadingLayer = null;
    activePreparation = { kind: "failed", requestId, reason };
    if (!root) {
      root = createRoot();
    }
    root.replaceChildren(...(rootStyle ? [rootStyle] : []));

    const status = document.createElement("div");
    status.textContent = preparationFailureLabel(reason);
    Object.assign(status.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "clamp(22px, 3vw, 34px)",
      fontWeight: "600",
    });

    const closeButton = createButton("元に戻る", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
      display: "flex",
      gap: "10px",
    });
    const retryButton = createButton("やり直す", retryPreparation);
    actions.append(retryButton, closeButton);
    root.append(status, actions);
    attachKeydownListener();
    focusAfterPaint(closeButton);
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

  function createOverlay() {
    if (!root) {
      root = createRoot();
    }

    const stage = document.createElement("div");
    stage.setAttribute("data-reader-stage", "true");
    Object.assign(stage.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(980px, calc(100% - 48px))",
      height: "calc(100% - 48px)",
      display: "grid",
      gridTemplateColumns: headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)",
      columnGap: headings.length > 0 ? "32px" : "0",
      alignItems: "stretch",
    });

    if (headings.length > 0) {
      stage.append(createMinimap());
    }

    const main = document.createElement("div");
    Object.assign(main.style, {
      position: "relative",
      minWidth: "0",
      height: "100%",
    });
    readerMain = main;

    previousContext = createContext("previous");

    display = document.createElement("div");
    display.setAttribute("data-reader-unit", "true");
    display.setAttribute("aria-live", "off");
    display.setAttribute("aria-atomic", "false");
    Object.assign(display.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(100%, 640px)",
      maxWidth: "calc(100% - 32px)",
      height: "1.35em",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 12px",
      borderRadius: "12px",
      fontSize: DISPLAY_FONT_SIZE,
      fontWeight: "600",
      lineHeight: "1.35",
      textAlign: "center",
      whiteSpace: "nowrap",
      overflow: "hidden",
      overflowWrap: "normal",
      wordBreak: "keep-all",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "color 120ms ease, background-color 120ms ease",
    });

    nextContext = createContext("next");
    contextSentenceIndex = null;

    progressLabel = document.createElement("span");
    progressLabel.setAttribute("data-reader-progress", "true");
    progressLabel.textContent = "0%";
    Object.assign(progressLabel.style, {
      position: "absolute",
      right: "16px",
      bottom: "16px",
      zIndex: "3",
      color: "rgba(235,235,235,0.58)",
      fontSize: "13px",
      fontVariantNumeric: "tabular-nums",
      pointerEvents: "none",
    });

    const topbar = createTopbar("文章で読む", showTextView);
    const controls = document.createElement("div");
    Object.assign(controls.style, {
      position: "absolute",
      left: "50%",
      bottom: "8px",
      transform: "translateX(-50%)",
      width: "min(100%, 264px)",
      minHeight: "56px",
      display: "grid",
      gridTemplateColumns: "1fr 56px 1fr",
      alignItems: "center",
    });

    const backButton = createIconControl("previous", "1文戻る", goBackOneSentence, 30, 52);
    playPauseButton = createIconControl("play", "再生", togglePlayPause, 30, 56);
    backButton.setAttribute("aria-keyshortcuts", "ArrowLeft");
    playPauseButton.setAttribute("aria-keyshortcuts", "Space");

    controls.append(backButton, playPauseButton);
    main.append(topbar, previousContext, display, nextContext, controls, progressLabel);
    stage.append(main);
    revealReader(stage);
    attachKeydownListener();
    focusAfterPaint(findCloseButton());

    if (typeof globalThis.ResizeObserver === "function") {
      displayResizeObserver = new globalThis.ResizeObserver(() => {
        if (rebuildUnitsForViewport()) renderCurrentFlowItem();
      });
      displayResizeObserver.observe(main);
    }
  }

  function createTopbar(modeLabel: string, switchMode: () => void): HTMLDivElement {
    const topbar = document.createElement("div");
    topbar.setAttribute("data-reader-topbar", "true");
    Object.assign(topbar.style, {
      position: "absolute",
      top: "8px",
      left: "0",
      right: "0",
      height: "44px",
      zIndex: "2",
      pointerEvents: "none",
    });

    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.setAttribute("data-reader-mode-button", "true");
    modeButton.textContent = modeLabel;
    Object.assign(modeButton.style, {
      position: "absolute",
      left: "50%",
      top: "0",
      transform: "translateX(-50%)",
      minWidth: "112px",
      height: "40px",
      padding: "0 12px",
      border: "1px solid transparent",
      borderRadius: "14px",
      background: "transparent",
      color: "rgba(245,245,247,0.66)",
      font: "inherit",
      fontSize: "14px",
      fontWeight: "600",
      whiteSpace: "nowrap",
      cursor: "pointer",
      pointerEvents: "auto",
      transition: "color 120ms ease, background-color 120ms ease, scale 100ms ease",
    });
    modeButton.addEventListener("pointerenter", () => {
      modeButton.style.color = "rgba(245,245,247,0.86)";
      modeButton.style.background = "rgba(255,255,255,0.06)";
    });
    modeButton.addEventListener("pointerleave", () => {
      modeButton.style.color = "rgba(245,245,247,0.66)";
      modeButton.style.background = "transparent";
      modeButton.style.scale = "1";
    });
    modeButton.addEventListener("pointerdown", () => {
      if (prefersReducedMotion()) return;
      modeButton.style.scale = "0.96";
    });
    modeButton.addEventListener("pointerup", () => {
      modeButton.style.scale = "1";
    });
    modeButton.addEventListener("focus", () => {
      modeButton.style.borderColor = "rgba(255,255,255,0.52)";
    });
    modeButton.addEventListener("blur", () => {
      modeButton.style.borderColor = "transparent";
    });
    modeButton.addEventListener("click", switchMode);

    const closeButton = createIconControl("close", "readerを閉じる", close, 22, 44);
    Object.assign(closeButton.style, {
      position: "absolute",
      top: "0",
      right: "0",
      pointerEvents: "auto",
    });
    topbar.append(modeButton, closeButton);
    return topbar;
  }

  function createIconControl(
    icon: ReaderIconName,
    accessibilityLabel: string,
    action: () => void,
    iconSize: number,
    buttonSize: number,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.replaceChildren(globalThis.ReaderIcons.create(document, icon, iconSize));
    button.setAttribute("aria-label", accessibilityLabel);
    button.title = accessibilityLabel;
    Object.assign(button.style, {
      appearance: "none",
      width: `${buttonSize}px`,
      height: `${buttonSize}px`,
      minWidth: "44px",
      minHeight: "44px",
      padding: "0",
      border: "1px solid transparent",
      borderRadius: "14px",
      background: "transparent",
      color: "rgba(245,245,247,0.66)",
      display: "grid",
      placeItems: "center",
      justifySelf: "center",
      cursor: "pointer",
      transition: "background-color 120ms ease, opacity 100ms ease, scale 100ms ease",
    });
    button.addEventListener("pointerenter", () => {
      button.style.background = "rgba(255,255,255,0.08)";
      button.style.color = "rgba(245,245,247,0.86)";
    });
    button.addEventListener("pointerleave", () => {
      button.style.background = "transparent";
      button.style.color = "rgba(245,245,247,0.66)";
      button.style.opacity = "1";
      button.style.scale = "1";
    });
    button.addEventListener("pointerdown", () => {
      if (prefersReducedMotion()) return;
      button.style.opacity = "0.62";
      button.style.scale = "0.94";
    });
    button.addEventListener("pointerup", () => {
      button.style.opacity = "1";
      button.style.scale = "1";
    });
    button.addEventListener("focus", () => {
      button.style.borderColor = "rgba(255,255,255,0.52)";
    });
    button.addEventListener("blur", () => {
      button.style.borderColor = "transparent";
    });
    button.addEventListener("click", action);
    return button;
  }

  function createContext(position: "previous" | "next"): HTMLDivElement {
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(100%, 640px)",
      maxWidth: "calc(100% - 32px)",
      display: "-webkit-box",
      overflow: "hidden",
      color: "rgba(255,255,255,0.26)",
      fontSize: "clamp(16px, 1.5vw, 20px)",
      fontWeight: "550",
      lineHeight: "1.4",
      textAlign: "center",
      opacity: "0.26",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: "2",
      ...(position === "previous"
        ? { bottom: "calc(50% + 82px)" }
        : { top: "calc(50% + 82px)" }),
    });
    return element;
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
        :host { --reader-contrast-text: #ffffff; }
        [data-reader-topbar] button,
        [data-reader-stage] button { color: var(--reader-contrast-text) !important; }
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

  function revealReader(stage: HTMLDivElement): void {
    if (!root || !rootStyle) return;
    if (!loadingLayer) {
      root.append(stage);
      return;
    }

    const outgoing = loadingLayer;
    loadingLayer = null;
    loadingIndicatorAnimation?.cancel?.();
    loadingIndicatorAnimation = null;
    loadingStatus = null;
    loadingCancelButton = null;
    loadingIndicator = null;
    outgoing.style.pointerEvents = "none";
    root.replaceChildren(rootStyle, stage, outgoing);
    const outgoingAnimation = animateOpacity(outgoing, 1, 0, LOADING_COVER_TRANSITION_MS);
    animateOpacity(stage, 0, 1, LOADING_COVER_TRANSITION_MS);
    afterAnimation(outgoingAnimation, () => outgoing.remove());
  }

  function createMinimap() {
    const minimap = document.createElement("aside");
    minimap.setAttribute("data-reader-minimap", "true");
    minimap.setAttribute("aria-label", "読書位置");
    Object.assign(minimap.style, {
      position: "relative",
      width: "100%",
      maxHeight: "min(72vh, 640px)",
      boxSizing: "border-box",
      zIndex: "1",
      display: "flex",
      flexDirection: "column",
      alignSelf: "center",
      padding: "14px 10px 10px",
      border: "1px solid rgba(255,255,255,0.11)",
      borderRadius: "18px",
      background: "rgba(36,36,36,0.72)",
      boxShadow: "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
      backdropFilter: "blur(28px) saturate(150%)",
      WebkitBackdropFilter: "blur(28px) saturate(150%)",
    });

    const location = document.createElement("div");
    Object.assign(location.style, {
      minWidth: "0",
      padding: "0 6px 10px",
    });

    const locationMeta = document.createElement("div");
    Object.assign(locationMeta.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: "5px",
      color: "rgba(235,235,235,0.60)",
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.02em",
      fontVariantNumeric: "tabular-nums",
    });
    const locationLabel = document.createElement("span");
    locationLabel.textContent = "記事の構成";
    locationMeta.append(locationLabel);

    const outline = document.createElement("nav");
    outline.setAttribute("aria-label", "記事の構成");
    Object.assign(outline.style, {
      minHeight: "0",
      overflowY: "auto",
      padding: "2px 0",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
    });

    headingNodes = headings.map((heading, headingIndex) => {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = heading.text;
      item.title = heading.text;
      Object.assign(item.style, {
        appearance: "none",
        width: "100%",
        marginBottom: "2px",
        padding: "7px 8px",
        paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px`,
        border: "0",
        borderRadius: "8px",
        background: "transparent",
        color: "rgba(235,235,235,0.58)",
        fontFamily: "inherit",
        fontSize: "13px",
        fontWeight: heading.level === 1 ? "600" : "450",
        lineHeight: "1.35",
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        cursor: "pointer",
        transition: "color 180ms ease, background-color 180ms ease",
      });
      item.addEventListener("click", () => jumpToHeading(headingIndex));
      outline.append(item);
      return item;
    });

    location.append(locationMeta);
    minimap.append(location, outline);

    return minimap;
  }

  function createButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      appearance: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid transparent",
      borderRadius: "999px",
      padding: "10px 16px",
      boxSizing: "border-box",
      background: "rgba(118,118,118,0.18)",
      color: "#ffffff",
      font: "inherit",
      fontSize: "14px",
      fontWeight: "500",
      textAlign: "center",
      whiteSpace: "nowrap",
      cursor: "pointer",
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      transition: "background-color 180ms ease, transform 120ms ease",
    });
    button.addEventListener("pointerenter", () => {
      button.style.background = "rgba(174,174,174,0.26)";
    });
    button.addEventListener("pointerleave", () => {
      button.style.background = "rgba(118,118,118,0.18)";
      button.style.scale = "1";
    });
    button.addEventListener("pointerdown", () => {
      if (prefersReducedMotion()) return;
      button.style.scale = "0.97";
    });
    button.addEventListener("pointerup", () => {
      button.style.scale = "1";
    });
    button.addEventListener("focus", () => {
      button.style.borderColor = "rgba(255,255,255,0.86)";
    });
    button.addEventListener("blur", () => {
      button.style.borderColor = "transparent";
    });
    button.addEventListener("click", onClick);
    return button;
  }

  function showTextView() {
    if (!root || !sourceText) return;
    const activeElement = readerActiveElement();
    if (!applyingSession) {
      dispatchSession({ type: "switchToText", position: currentPosition });
    }
    clearRenderedView();

    const shell = document.createElement("div");
    shell.setAttribute("data-reader-text-shell", "true");
    Object.assign(shell.style, {
      width: "min(900px, calc(100% - 32px))",
      height: "calc(100% - 32px)",
      margin: "16px auto",
      position: "relative",
      boxSizing: "border-box",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: "24px",
      background: "rgba(24,24,24,0.92)",
      overflow: "hidden",
    });

    const scroller = document.createElement("main");
    scroller.setAttribute("data-reader-text-scroller", "true");
    Object.assign(scroller.style, {
      width: "100%",
      height: "100%",
      overflowY: "auto",
      boxSizing: "border-box",
      padding: "72px clamp(24px, 7vw, 96px) 112px",
      scrollbarGutter: "stable",
    });
    const article = document.createElement("article");
    Object.assign(article.style, {
      maxWidth: "42rem",
      margin: "0 auto",
      color: "rgba(255,255,255,0.92)",
      fontSize: "clamp(17px, 1.7vw, 20px)",
      lineHeight: "1.9",
      letterSpacing: "0.01em",
    });

    const readableBlocks = blocks.length > 0 ? blocks : fallbackBlocks(sourceText);
    const blockElements = readableBlocks.map((block) => createTextBlock(block));
    const figureElements: HTMLElement[] = [];
    appendTextContent(article, readableBlocks, blockElements, figures, figureElements);
    const positionMarkers = [...blockElements.flatMap((element) => descendantElements(element)
      .filter((child) => child.dataset.readerTextAnchor === "true")), ...figureElements].sort((left, right) => (
      Number(left.dataset.sourceStart) - Number(right.dataset.sourceStart)
      || (left.dataset.readerPositionKind === right.dataset.readerPositionKind
        ? Number(left.dataset.figureIndex || 0) - Number(right.dataset.figureIndex || 0)
        : left.dataset.readerPositionKind === "figure" ? -1 : 1)
    ));
    scroller.append(article);

    textScroller = scroller;
    textPositionMarkers = positionMarkers;
    textPositionDirty = false;
    textRestoreScrollTop = null;
    const topbar = createTopbar("RSVPで読む", () => {
      updateTextPosition(scroller, positionMarkers, true, false);
      showRsvpView();
    });
    Object.assign(topbar.style, { left: "16px", right: "16px" });
    progressLabel = document.createElement("span");
    progressLabel.setAttribute("data-reader-progress", "true");
    progressLabel.textContent = `${globalThis.Engine.calculateReadingProgress(
      currentPosition.sourceOffset,
      sourceText.length,
    )}%`;
    Object.assign(progressLabel.style, {
      position: "absolute",
      right: "16px",
      bottom: "16px",
      zIndex: "3",
      color: "rgba(235,235,235,0.58)",
      fontSize: "13px",
      fontVariantNumeric: "tabular-nums",
      pointerEvents: "none",
    });
    shell.append(topbar, scroller, progressLabel);
    root.append(shell);
    attachKeydownListener();

    const updatePosition = () => {
      if (textRestoring) return;
      if (textRestoreScrollTop !== null && Math.abs(scroller.scrollTop - textRestoreScrollTop) < 1) return;
      textPositionDirty = true;
      updateTextPosition(scroller, positionMarkers);
    };
    scroller.addEventListener("scroll", updatePosition, { passive: true });
    const initializeTextView = () => {
      textRestoring = true;
      if (scroller.scrollTop > 0) updateTextPosition(scroller, positionMarkers);
      else restoreTextPosition(scroller, positionMarkers);
      textRestoreScrollTop = scroller.scrollTop;
      textPositionDirty = false;
      textRestoring = false;
      figureElements.forEach((figureElement) => attachTextFigureLoadCorrection(scroller, figureElement, positionMarkers));
    };
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(initializeTextView);
    else {
      initializeTextView();
      textRestoreScrollTop = null;
    }
    focusCloseIfNeeded(activeElement);
  }

  function showRsvpView() {
    if (!root || units.length === 0) return;
    const previousFocus = readerActiveElement();
    const restoreModeFocus = previousFocus?.getAttribute?.("data-reader-mode-button") === "true";
    dispatchSession({ type: "switchToRsvp", position: currentPosition });
    clearRenderedView();
    createOverlay();
    renderCurrentFlowItem();
    if (restoreModeFocus) focusAfterPaint(findModeButton());
  }

  function clearRenderedView() {
    if (!root || !rootStyle) return;
    invalidateFigureLoad();
    figurePanel = null;
    detachKeydownListener();
    displayResizeObserver?.disconnect();
    displayResizeObserver = null;
    root.replaceChildren(rootStyle);
    previousContext = null;
    display = null;
    nextContext = null;
    contextSentenceIndex = null;
    playPauseButton = null;
    headingNodes = [];
    progressLabel = null;
    readerMain = null;
    textScroller = null;
    textPositionMarkers = [];
    textPositionDirty = false;
    textRestoreScrollTop = null;
    textRestoring = false;
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

  function createTextBlock(block: ReaderBlock): HTMLElement {
    let tagName = "p";
    if (block.kind === "heading") tagName = `h${Math.min(6, Math.max(1, block.level || 2))}`;
    if (block.kind === "quote") tagName = "blockquote";
    if (block.kind === "preformatted") tagName = "pre";
    const element = document.createElement(tagName);
    element.dataset.sourceStart = String(block.start ?? 0);
    element.dataset.sourceEnd = String(block.end ?? (block.start ?? 0) + block.text.length);
    Object.assign(element.style, {
      margin: tagName === "p" ? "0 0 1.45em" : "1.8em 0 0.8em",
      whiteSpace: tagName === "pre" ? "pre-wrap" : "pre-line",
      overflowWrap: "anywhere",
    });
    if (tagName === "blockquote") {
      Object.assign(element.style, {
        paddingLeft: "1em",
        borderLeft: "2px solid rgba(255,255,255,0.28)",
        color: "rgba(255,255,255,0.68)",
      });
    }
    const sentenceSpans = globalThis.Engine.splitSentenceSpans(block.text, segmentationLocale);
    if (sentenceSpans.length === 0) {
      element.textContent = block.text;
      element.setAttribute("data-reader-text-anchor", "true");
      element.dataset.readerTextAnchor = "true";
      element.dataset.readerPositionKind = "text";
      return element;
    }
    for (const sentence of sentenceSpans) {
      const anchor = document.createElement("span");
      anchor.setAttribute("data-reader-text-anchor", "true");
      anchor.dataset.readerTextAnchor = "true";
      anchor.dataset.sourceStart = String((block.start ?? 0) + sentence.start);
      anchor.dataset.sourceEnd = String((block.start ?? 0) + sentence.end);
      anchor.dataset.readerPositionKind = "text";
      anchor.textContent = block.text.slice(sentence.start, sentence.end);
      element.append(anchor);
    }
    return element;
  }

  function descendantElements(element: HTMLElement): HTMLElement[] {
    return [...element.children].flatMap((child) => {
      const childElement = child as HTMLElement;
      return [childElement, ...descendantElements(childElement)];
    });
  }

  function appendTextContent(
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
        const figureElement = createTextFigure(currentFigure.figure, currentFigure.figureIndex);
        article.append(figureElement);
        figureElements.push(figureElement);
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
      const blockElement = blockElements[blockIndex];
      if (blockElement) article.append(blockElement);
      currentFigure = orderedFigures[figureIndex];
      while (currentFigure && currentFigure.figure.sourceOffset <= block.end) {
        const figureElement = createTextFigure(currentFigure.figure, currentFigure.figureIndex);
        article.append(figureElement);
        figureElements.push(figureElement);
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
    });
    let currentFigure = orderedFigures[figureIndex];
    while (currentFigure) {
      const figureElement = createTextFigure(currentFigure.figure, currentFigure.figureIndex);
      article.append(figureElement);
      figureElements.push(figureElement);
      figureIndex += 1;
      currentFigure = orderedFigures[figureIndex];
    }
  }

  function createTextFigure(figure: ReaderFigure, figureIndex: number): HTMLElement {
    const container = document.createElement("figure");
    container.setAttribute("data-reader-text-figure", "true");
    container.dataset.sourceStart = String(figure.sourceOffset);
    container.dataset.sourceEnd = String(figure.sourceEnd);
    container.dataset.readerPositionKind = "figure";
    container.dataset.figureIndex = String(figureIndex);
    Object.assign(container.style, {
      margin: "2em 0",
    });
    const image = document.createElement("img");
    configureFigureImage(image, figure, true, true);
    image.dataset.readerSource = figure.src;
    const imageSurface = createVeiledImageSurface(image, "72vh", "10px");
    Object.assign(image.style, {
      display: "block",
      width: "auto",
      maxWidth: "100%",
      objectFit: "contain",
    });
    container.append(imageSurface);
    if (figure.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = figure.caption;
      Object.assign(caption.style, {
        marginTop: "0.65em",
        color: "rgba(255,255,255,0.58)",
        fontSize: "0.78em",
        lineHeight: "1.5",
        textAlign: "center",
      });
      container.append(caption);
    }
    return container;
  }

  function configureFigureImage(
    image: HTMLImageElement,
    figure: ReaderFigure,
    lazy: boolean,
    deferSource = false,
  ): void {
    if (deferSource) {
      if (figure.srcset !== undefined) image.dataset.readerSrcset = figure.srcset;
      if (figure.sizes !== undefined) image.dataset.readerSizes = figure.sizes;
    } else {
      if (figure.srcset !== undefined) image.srcset = figure.srcset;
      if (figure.sizes !== undefined) image.sizes = figure.sizes;
    }
    if (figure.width !== undefined) image.width = figure.width;
    if (figure.height !== undefined) image.height = figure.height;
    image.alt = figure.alt || figure.caption || "本文画像";
    image.decoding = "async";
    if (lazy) image.loading = "lazy";
  }

  function createVeiledImageSurface(image: HTMLImageElement, maxHeight: string, borderRadius: string): HTMLButtonElement {
    const surface = document.createElement("button");
    surface.type = "button";
    surface.setAttribute("data-reader-image-surface", "true");
    surface.setAttribute("aria-pressed", "false");
    surface.setAttribute("aria-label", "画像を明るく表示");
    surface.title = "画像を明るく表示";
    Object.assign(surface.style, {
      appearance: "none",
      border: "0",
      padding: "0",
      background: "transparent",
      color: "inherit",
      position: "relative",
      width: "min(100%, 720px)",
      margin: "0 auto",
      overflow: "hidden",
      borderRadius,
      touchAction: "manipulation",
    });
    image.style.width = "100%";
    image.style.height = "auto";
    image.style.maxHeight = maxHeight;
    const veil = document.createElement("div");
    veil.setAttribute("data-reader-image-veil", "true");
    Object.assign(veil.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.46)",
      opacity: "1",
      pointerEvents: "none",
      transition: prefersReducedMotion() ? "none" : "opacity 120ms ease-out",
    });
    let revealed = false;
    const updateBrightness = () => {
      surface.setAttribute("aria-pressed", String(revealed));
      const label = revealed ? "画像を暗く表示" : "画像を明るく表示";
      surface.setAttribute("aria-label", label);
      surface.title = label;
      veil.style.opacity = revealed ? "0" : "1";
      if (figureViewState.kind === "ready") {
        figureViewState = {
          ...figureViewState,
          brightness: revealed ? "revealed" : "dimmed",
        };
      }
    };
    surface.addEventListener("click", () => {
      revealed = !revealed;
      updateBrightness();
    });
    surface.append(image, veil);
    return surface;
  }

  function attachTextFigureLoadCorrection(
    scroller: HTMLElement,
    figureElement: HTMLElement,
    positionMarkers: HTMLElement[],
  ): void {
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
    let settled = false;
    const adjustAfterDecode = async () => {
      if (settled) return;
      settled = true;
      if (!shouldCorrect || textScroller !== scroller) return;
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
      }
      if (textScroller !== scroller) return;
      const applyCorrection = () => {
        if (textScroller !== scroller) return;
        const afterTop = elementRect(currentMarker as HTMLElement, 0, 100).top;
        const delta = afterTop - beforeTop;
        if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
          textRestoring = true;
          scroller.scrollTop += delta;
          textRestoreScrollTop = scroller.scrollTop;
          textRestoring = false;
        }
      };
      if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(applyCorrection);
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
    if (progressLabel && sourceText) {
      progressLabel.textContent = `${globalThis.Engine.calculateReadingProgress(
        currentPosition.sourceOffset,
        sourceText.length,
      )}%`;
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

  function renderCurrentFlowItem(): boolean {
    const item = flowItems[sessionFlowIndex()];
    if (!item) return true;
    if (item.kind === "figure") {
      const figure = figures[item.figureIndex];
      if (figure) {
        showFigure(figure, item.figureIndex);
        return true;
      }
    }
    dismissFigurePanel();
    renderCurrentUnit();
    updatePlayPauseButton();
    return false;
  }

  function renderCurrentUnit() {
    if (!display || units.length === 0) return;

    const unitIndex = sessionUnitIndex();
    const unit = units[unitIndex];
    if (!unit) return;
    if (globalThis.performance?.getEntriesByName?.("reader:first-unit", "mark").length === 0) {
      globalThis.performance?.mark?.("reader:first-unit");
    }
    currentPosition = { kind: "text", sourceOffset: unit.start };
    if (unit.sentenceIndex !== contextSentenceIndex) {
      const context = globalThis.Engine.surroundingSentences(units, unitIndex);
      if (previousContext) {
        previousContext.textContent = context.previous;
        fadeContext(previousContext);
      }
      if (nextContext) {
        nextContext.textContent = context.next;
        fadeContext(nextContext);
      }
      contextSentenceIndex = unit.sentenceIndex;
    }
    display.textContent = unit.text;
    display.dataset.sourceStart = String(unit.start);
    display.dataset.sourceEnd = String(unit.end);
    display.dataset.readerPositionKind = "text";
    applyUnitStyle(unit.kind);
    updateMinimap(currentPosition.sourceOffset);
  }

  function fadeContext(element: HTMLElement): void {
    if (!element.textContent || prefersReducedMotion()) return;
    element.animate(
      [{ opacity: 0.12 }, { opacity: 0.26 }],
      { duration: 120, easing: "ease-out" },
    );
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

  function applyUnitStyle(kind: ReaderUnitKind): void {
    const displayNode = display;
    if (!displayNode) return;
    Object.assign(displayNode.style, {
      color: "#ffffff",
      backgroundColor: "transparent",
      opacity: "1",
    });

    if (kind === "aside") {
      Object.assign(displayNode.style, {
        color: "rgba(255,255,255,0.58)",
        backgroundColor: "rgba(255,255,255,0.025)",
      });
    } else if (kind === "quote") {
      Object.assign(displayNode.style, {
        color: "rgba(255,255,255,0.90)",
        backgroundColor: "rgba(255,255,255,0.04)",
      });
    }
  }

  function updateMinimap(currentSourceOffset: number): void {
    const activeHeadingIndex = globalThis.Engine.findActiveHeadingIndex(
      sectionTransitions,
      currentSourceOffset,
      initialHeadingIndex,
    );

    if (progressLabel && sourceText) {
      const progress = globalThis.Engine.calculateReadingProgress(
        currentPosition.sourceOffset,
        sourceText.length,
      );
      progressLabel.textContent = `${progress}%`;
    }
    if (headingNodes.length === 0) return;
    headingNodes.forEach((node, index) => {
      const active = index === activeHeadingIndex;
      const heading = headings[index];
      Object.assign(node.style, {
        color: active ? "rgba(255,255,255,0.98)" : "rgba(235,235,235,0.58)",
        background: active ? "rgba(118,118,118,0.18)" : "transparent",
        boxShadow: "none",
        fontWeight: active ? "600" : heading?.level === 1 ? "600" : "450",
      });
      node.setAttribute("aria-current", active ? "location" : "false");
    });
  }

  function activeHeadingAt(offset: number): number {
    return globalThis.Engine.findActiveHeadingIndex(
      sectionTransitions,
      offset,
      initialHeadingIndex,
    );
  }

  function showFigure(figure: ReaderFigure, figureIndex: number): void {
    if (!readerMain || !display) return;
    if (
      figurePanel?.isConnected
      && figurePanel.dataset.figureIndex === String(figureIndex)
      && figureViewState.kind !== "idle"
    ) {
      updatePlayPauseButton();
      return;
    }
    dismissFigurePanel();
    const token = ++figureLoadToken;
    figureViewState = { kind: "loading", token, figureIndex };

    currentPosition = {
      kind: "figure",
      sourceOffset: figure.sourceOffset,
      figureIndex,
    };
    updateMinimap(currentPosition.sourceOffset);

    animateOpacity(display, 1, 0, 180);
    display.style.pointerEvents = "none";

    const panel = document.createElement("figure");
    panel.setAttribute("aria-label", "本文画像");
    panel.dataset.sourceStart = String(figure.sourceOffset);
    panel.dataset.sourceEnd = String(figure.sourceEnd);
    panel.dataset.readerPositionKind = "figure";
    panel.dataset.figureIndex = String(figureIndex);
    Object.assign(panel.style, {
      position: "absolute",
      inset: "52px 0 64px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "20px 16px 8px",
      boxSizing: "border-box",
    });

    const image = document.createElement("img");
    configureFigureImage(image, figure, false, true);
    const imageSurface = createVeiledImageSurface(image, "min(54vh, 560px)", "12px");
    imageSurface.hidden = true;
    imageSurface.disabled = true;
    imageSurface.setAttribute("aria-hidden", "true");
    Object.assign(image.style, {
      display: "block",
      maxWidth: "100%",
      objectFit: "contain",
    });

    const status = createFigureStatus();
    const description = document.createElement("div");
    description.setAttribute("data-reader-figure-description", "true");
    description.textContent = figureDescription(figure);
    description.hidden = true;
    Object.assign(description.style, {
      color: "rgba(255,255,255,0.72)",
      fontSize: "14px",
      lineHeight: "1.45",
      textAlign: "center",
    });
    let caption: HTMLElement | null = null;
    if (figure.caption) {
      caption = document.createElement("figcaption");
      caption.textContent = figure.caption;
      Object.assign(caption.style, {
        width: "min(720px, 100%)",
        color: "rgba(255,255,255,0.58)",
        fontSize: "13px",
        lineHeight: "1.4",
        textAlign: "center",
      });
    }
    image.addEventListener("load", () => {
      void settleFigureImage(token, image, panel, status, description, imageSurface, caption);
    });
    image.addEventListener("error", () => {
      failFigureImage(token, figureIndex, panel, status, description, imageSurface, caption);
    });

    panel.append(imageSurface, status, description);
    if (caption) panel.append(caption);
    figurePanel = panel;
    readerMain.append(panel);
    updatePlayPauseButton();
    scheduleFigureLoadingIndicator(token, panel, status, description, caption);
    if (figure.srcset !== undefined) image.srcset = figure.srcset;
    if (figure.sizes !== undefined) image.sizes = figure.sizes;
    image.src = figure.src;
    if (image.complete && image.naturalWidth > 0) {
      void settleFigureImage(token, image, panel, status, description, imageSurface, caption);
    }
    animateOpacity(panel, 0, 1, 180);
  }

  function createFigureStatus(): HTMLDivElement {
    const status = document.createElement("div");
    status.setAttribute("data-reader-figure-status", "true");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "画像を準備しています";
    status.hidden = true;
    Object.assign(status.style, {
      display: "none",
      alignItems: "center",
      gap: "8px",
      color: "rgba(255,255,255,0.72)",
      fontSize: "14px",
      lineHeight: "1.4",
    });
    return status;
  }

  function figureDescription(figure: ReaderFigure): string {
    const alt = figure.alt.trim();
    const caption = figure.caption.trim();
    if (alt && caption && alt !== caption) return `${alt}。${caption}`;
    return alt || caption || "本文画像";
  }

  function scheduleFigureLoadingIndicator(
    token: number,
    panel: HTMLElement,
    status: HTMLElement,
    description: HTMLElement,
    caption: HTMLElement | null,
  ): void {
    if (figureLoadRevealTimerId !== null) globalThis.clearTimeout(figureLoadRevealTimerId);
    figureLoadRevealTimerId = globalThis.setTimeout(() => {
      figureLoadRevealTimerId = null;
      if (figureViewState.kind !== "loading" || figureViewState.token !== token || figurePanel !== panel) return;
      status.hidden = false;
      status.style.display = "flex";
      description.hidden = false;
      if (caption) caption.hidden = true;
      const indicator = document.createElement("span");
      indicator.setAttribute("data-reader-figure-indicator", "true");
      indicator.setAttribute("aria-hidden", "true");
      Object.assign(indicator.style, {
        width: "28px",
        height: "2px",
        borderRadius: "999px",
        background: "rgba(255,255,255,0.28)",
        display: "inline-block",
        overflow: "hidden",
      });
      const bar = document.createElement("span");
      Object.assign(bar.style, {
        display: "block",
        width: "100%",
        height: "100%",
        background: "rgba(255,255,255,0.84)",
        transform: "translateX(-100%) scaleX(.35)",
        transformOrigin: "left center",
      });
      indicator.append(bar);
      if (!prefersReducedMotion()) bar.animate(
        [
          { transform: "translateX(-100%) scaleX(.35)" },
          { transform: "translateX(220%) scaleX(.35)" },
        ],
        { duration: 900, iterations: Infinity, easing: "linear" },
      );
      status.append(indicator);
    }, 100);
  }

  async function settleFigureImage(
    token: number,
    image: HTMLImageElement,
    panel: HTMLElement,
    status: HTMLElement,
    description: HTMLElement,
    imageSurface: HTMLButtonElement,
    caption: HTMLElement | null,
  ): Promise<void> {
    if (figureViewState.kind !== "loading" || figureViewState.token !== token || figurePanel !== panel) return;
    try {
      if (typeof image.decode === "function") await image.decode();
    } catch {
      if (!(image.complete && image.naturalWidth > 0)) {
        failFigureImage(token, figureViewState.figureIndex, panel, status, description, imageSurface, caption);
        return;
      }
    }
    if (figureViewState.kind !== "loading" || figureViewState.token !== token || figurePanel !== panel) return;
    if (figureLoadRevealTimerId !== null) {
      globalThis.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    status.hidden = true;
    status.style.display = "none";
    description.hidden = true;
    if (caption) caption.hidden = false;
    figureViewState = { kind: "ready", token, figureIndex: figureViewState.figureIndex, brightness: "dimmed" };
    imageSurface.setAttribute("aria-pressed", "false");
    imageSurface.setAttribute("aria-label", "画像を明るく表示");
    imageSurface.title = "画像を明るく表示";
    imageSurface.hidden = false;
    imageSurface.disabled = false;
    imageSurface.removeAttribute("aria-hidden");
    const veil = Array.from(imageSurface.children).find((child) => child.getAttribute?.("data-reader-image-veil") === "true");
    if (veil) (veil as HTMLElement).style.opacity = "1";
    updatePlayPauseButton();
  }

  function failFigureImage(
    token: number,
    figureIndex: number,
    panel: HTMLElement,
    status: HTMLElement,
    description: HTMLElement,
    imageSurface: HTMLElement,
    caption: HTMLElement | null,
  ): void {
    if (figureViewState.kind !== "loading" || figureViewState.token !== token || figurePanel !== panel) return;
    if (figureLoadRevealTimerId !== null) {
      globalThis.clearTimeout(figureLoadRevealTimerId);
      figureLoadRevealTimerId = null;
    }
    status.hidden = false;
    status.style.display = "block";
    status.textContent = "画像を読み込めませんでした";
    description.hidden = false;
    if (caption) caption.hidden = true;
    imageSurface.remove();
    figureViewState = { kind: "failed", token, figureIndex };
    updatePlayPauseButton();
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

  function dismissFigurePanel() {
    invalidateFigureLoad();
    const outgoing = figurePanel;
    if (!outgoing) return;
    figurePanel = null;
    outgoing.style.pointerEvents = "none";
    const outgoingAnimation = animateOpacity(outgoing, 1, 0, 180);
    outgoing.remove();
    afterAnimation(outgoingAnimation, () => outgoing.remove());
    if (display) {
      animateOpacity(display, 0, 1, 180);
      display.style.pointerEvents = "auto";
    }
  }

  function play() {
    dispatchSession({ type: "play" });
  }

  function pause() {
    dispatchSession({ type: "pause" });
  }

  function togglePlayPause() {
    if (figurePanel) {
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

  function updatePlayPauseButton() {
    if (!playPauseButton) return;
    if (figurePanel) {
      playPauseButton.replaceChildren(globalThis.ReaderIcons.create(document, "play", 30));
      playPauseButton.setAttribute("aria-label", "続きを読む");
      playPauseButton.setAttribute("aria-pressed", "false");
      playPauseButton.title = "続きを読む";
      return;
    }
    const playing = sessionPlaybackState() === "playing";
    playPauseButton.replaceChildren(
      globalThis.ReaderIcons.create(document, playing ? "pause" : "play", playing ? 26 : 30),
    );
    playPauseButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
    playPauseButton.setAttribute("aria-pressed", playing ? "true" : "false");
    playPauseButton.title = playing ? "一時停止" : "再生";
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
    if (!display || isEditableTarget(event) || isButtonTarget(event)) return;
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

  function animateOpacity(element: HTMLElement, from: number, to: number, duration: number): Animation | null {
    element.style.opacity = String(to);
    if (prefersReducedMotion()) return null;
    return element.animate(
      [{ opacity: from }, { opacity: to }],
      {
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }

  function afterAnimation(animation: Animation | null, callback: () => void): void {
    if (!animation?.finished) {
      callback();
      return;
    }
    animation.finished.then(callback, callback);
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
    loadingIndicatorAnimation?.cancel?.();
    loadingIndicatorAnimation = null;
    loadingIndicator = null;
    stopTimer();
    detachKeydownListener();
    displayResizeObserver?.disconnect();
    displayResizeObserver = null;
    detachDialogCancelListener();
    const dialog = root;
    if (dialog && isOpenDialog(dialog)) {
      try {
        dialog.close();
      } catch {
      }
    }
    const host = rootHost;
    try {
      host?.remove();
    } finally {
      root = null;
      rootHost = null;
      readerShadow = null;
      rootStyle = null;
      loadingLayer = null;
      loadingStatus = null;
      loadingCancelButton = null;
      previousContext = null;
      display = null;
      nextContext = null;
      contextSentenceIndex = null;
      readerMain = null;
      playPauseButton = null;
      headingNodes = [];
      progressLabel = null;
      figurePanel = null;
      textScroller = null;
      textPositionMarkers = [];
      textPositionDirty = false;
      textRestoreScrollTop = null;
      textRestoring = false;
      lastReaderFocusedElement = null;
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
          baseUnits = [];
          currentPosition = { kind: "text", sourceOffset: 0 };
          segmentationLocale = "ja";
          currentGraphemeLimit = 12;
          launchFocus = null;
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
