(() => {
  type PlaybackState = "idle" | "paused" | "playing";
  type ReaderMessage =
    | { type: "SHOW_RSVP_LOADING"; requestId: string }
    | { type: "START_RSVP"; requestId: string; text: string; readingContext?: Partial<ReadingContext> | null }
    | { type: "RSVP_ERROR"; requestId: string };

  if (globalThis.__rsvpReaderInstalled) return;
  globalThis.__rsvpReaderInstalled = true;

  const ROOT_ID = "__rsvp-reader-root";
  const DISPLAY_FONT_SIZE = "clamp(36px, 4.5vw, 64px)";

  let units: ReaderUnit[] = [];
  let currentUnitIndex = 0;
  let playbackState: PlaybackState = "idle";
  let timerId: number | null = null;
  let root: HTMLDivElement | null = null;
  let rootHost: HTMLDivElement | null = null;
  let rootStyle: HTMLStyleElement | null = null;
  let loadingLayer: HTMLDivElement | null = null;
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
  let progressBar: HTMLDivElement | null = null;
  let displayResizeObserver: ResizeObserver | null = null;
  let figures: ReaderFigure[] = [];
  let nextFigureIndex = 0;
  let figurePanel: HTMLElement | null = null;
  let readerMain: HTMLDivElement | null = null;
  let sourceText = "";
  let blocks: ReaderBlock[] = [];
  let currentOffset = 0;
  let launchFocus: HTMLElement | null = null;

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
      showError(message.requestId);
    }
  });

  function showLoading(requestId: string): void {
    const activeElement = document.activeElement;
    close();
    launchFocus = activeElement && typeof (activeElement as HTMLElement).focus === "function"
      ? activeElement as HTMLElement
      : null;
    activeRequestId = requestId;
    createLoadingOverlay();
  }

  function start(
    text: string,
    requestId: string,
    suppliedReadingContext: Partial<ReadingContext> | null | undefined,
  ): void {
    if (requestId !== activeRequestId) return;

    stopTimer();

    const content = globalThis.Extractor.fromText(
      text,
      suppliedReadingContext || collectReadingContext(text),
    );
    if (!content) {
      close();
      return;
    }
    const readingContext = content.readingContext;
    sourceText = content.text;
    blocks = Array.isArray(readingContext.blocks) ? readingContext.blocks : [];
    headings = readingContext.headings;
    sectionTransitions = readingContext.sectionTransitions;
    initialHeadingIndex = readingContext.initialHeadingIndex;
    figures = Array.isArray(readingContext.figures) ? readingContext.figures : [];
    nextFigureIndex = 0;
    playbackState = "paused";

    const figureBoundaries = figures.flatMap((figure) => [figure.sourceOffset, figure.sourceEnd]);
    units = globalThis.Engine.segmentText(content.text, "ja", figureBoundaries)
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
    if (units.length === 0) {
      close();
      return;
    }

    currentUnitIndex = 0;
    createOverlay();
    renderCurrentUnit();
    play();
  }

  function createLoadingOverlay() {
    root = createRoot();
    loadingLayer = document.createElement("div");
    Object.assign(loadingLayer.style, {
      position: "absolute",
      inset: "0",
    });

    const status = document.createElement("div");
    Object.assign(status.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center",
    });

    const indicator = document.createElement("div");
    indicator.textContent = "文章を準備しています…";
    Object.assign(indicator.style, {
      fontSize: "clamp(24px, 3vw, 36px)",
      fontWeight: "600",
    });
    if (!prefersReducedMotion()) {
      indicator.animate(
        [{ opacity: 0.45 }, { opacity: 1 }, { opacity: 0.45 }],
        { duration: 1400, iterations: Infinity },
      );
    }

    const note = document.createElement("div");
    note.textContent = "このページ内だけで処理しています";
    Object.assign(note.style, {
      marginTop: "14px",
      color: "rgba(255,255,255,0.58)",
      fontSize: "14px",
    });

    const closeButton = createButton("閉じる", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });

    status.append(indicator, note);
    loadingLayer.append(status, closeButton);
    root.append(loadingLayer);
    if (rootHost) document.documentElement.append(rootHost);
    globalThis.requestAnimationFrame?.(() => closeButton.focus());
  }

  function showError(requestId: string): void {
    if (requestId !== activeRequestId || !root) return;
    root.replaceChildren(...(rootStyle ? [rootStyle] : []));

    const status = document.createElement("div");
    status.textContent = "文章を読み込めませんでした";
    Object.assign(status.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "clamp(22px, 3vw, 34px)",
      fontWeight: "600",
    });

    const closeButton = createButton("閉じる", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });
    root.append(status, closeButton);
    globalThis.requestAnimationFrame?.(() => closeButton.focus());
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
      headings: ReaderHeading[];
      sectionTransitions: ReaderSectionTransition[];
      initialHeadingIndex: number;
      figures: ReaderFigure[];
    } = {
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
      if (rootHost) document.documentElement.append(rootHost);
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
    main.append(topbar, previousContext, display, nextContext, controls);
    stage.append(main);
    revealReader(stage);
    document.addEventListener("keydown", handleKeyDown);
    globalThis.requestAnimationFrame?.(() => {
      root?.querySelector?.<HTMLButtonElement>('[aria-label="readerを閉じる"]')?.focus();
    });

    if (typeof globalThis.ResizeObserver === "function") {
      displayResizeObserver = new globalThis.ResizeObserver(fitDisplayText);
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

  function createRoot() {
    const host = document.createElement("div");
    host.id = ROOT_ID;
    rootHost = host;
    const element = document.createElement("div");
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", "reader");
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      background: "radial-gradient(circle at 68% 44%, rgba(44,44,44,0.32), transparent 38%), #090909",
      color: "#ffffff",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
      WebkitFontSmoothing: "antialiased",
    });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; }
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
    `;
    rootStyle = style;
    element.append(style);
    if (typeof host.attachShadow === "function") host.attachShadow({ mode: "open" }).append(element);
    else host.append(element);
    return element;
  }

  function revealReader(stage: HTMLDivElement): void {
    if (!root || !rootStyle) return;
    if (!loadingLayer) {
      root.append(stage);
      return;
    }

    const outgoing = loadingLayer;
    loadingLayer = null;
    outgoing.style.pointerEvents = "none";
    root.replaceChildren(rootStyle, stage, outgoing);
    const outgoingAnimation = animateOpacity(outgoing, 1, 0, 220);
    animateOpacity(stage, 0, 1, 220);
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
    progressLabel = document.createElement("span");
    progressLabel.textContent = "0%";
    locationMeta.append(locationLabel, progressLabel);

    const progressTrack = document.createElement("div");
    Object.assign(progressTrack.style, {
      position: "relative",
      height: "4px",
      margin: "10px 0 0",
      borderRadius: "999px",
      background: "rgba(120,120,120,0.24)",
    });
    progressBar = document.createElement("div");
    Object.assign(progressBar.style, {
      width: "0%",
      height: "100%",
      borderRadius: "inherit",
      background: "rgba(255,255,255,0.68)",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "width 220ms ease-out",
    });
    progressTrack.append(progressBar);

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

    location.append(locationMeta, progressTrack);
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
    pause();
    currentOffset = units[currentUnitIndex]?.start ?? currentOffset;
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
    appendTextContent(article, readableBlocks, blockElements, figures);
    scroller.append(article);

    const topbar = createTopbar("RSVPで読む", showRsvpView);
    Object.assign(topbar.style, { left: "16px", right: "16px" });
    shell.append(scroller, topbar);
    root.append(shell);

    const updatePosition = () => {
      const viewportCenter = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      const measurements = blockElements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          start: Number(element.dataset.sourceStart),
          end: Number(element.dataset.sourceEnd),
        };
      });
      currentOffset = globalThis.Engine.sourceOffsetAtViewportCenter(measurements, viewportCenter);
      currentUnitIndex = globalThis.Engine.findUnitIndex(units, currentOffset);
    };
    scroller.addEventListener("scroll", updatePosition, { passive: true });
    globalThis.requestAnimationFrame?.(() => restoreTextPosition(scroller, blockElements, readableBlocks));
  }

  function showRsvpView() {
    if (!root || units.length === 0) return;
    currentUnitIndex = globalThis.Engine.findUnitIndex(units, currentOffset);
    syncNextFigureIndex();
    clearRenderedView();
    createOverlay();
    renderCurrentUnit();
    play();
  }

  function clearRenderedView() {
    if (!root || !rootStyle) return;
    document.removeEventListener("keydown", handleKeyDown);
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
    progressBar = null;
    readerMain = null;
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
    element.textContent = block.text;
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
    return element;
  }

  function appendTextContent(
    article: HTMLElement,
    readableBlocks: ReaderBlock[],
    blockElements: HTMLElement[],
    articleFigures: ReaderFigure[],
  ): void {
    const orderedFigures = [...articleFigures].sort((left, right) => left.sourceOffset - right.sourceOffset);
    let figureIndex = 0;
    readableBlocks.forEach((block, blockIndex) => {
      let currentFigure = orderedFigures[figureIndex];
      while (currentFigure && currentFigure.sourceOffset <= block.start) {
        article.append(createTextFigure(currentFigure));
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
      const blockElement = blockElements[blockIndex];
      if (blockElement) article.append(blockElement);
      currentFigure = orderedFigures[figureIndex];
      while (currentFigure && currentFigure.sourceOffset <= block.end) {
        article.append(createTextFigure(currentFigure));
        figureIndex += 1;
        currentFigure = orderedFigures[figureIndex];
      }
    });
    let currentFigure = orderedFigures[figureIndex];
    while (currentFigure) {
      article.append(createTextFigure(currentFigure));
      figureIndex += 1;
      currentFigure = orderedFigures[figureIndex];
    }
  }

  function createTextFigure(figure: ReaderFigure): HTMLElement {
    const container = document.createElement("figure");
    container.setAttribute("data-reader-text-figure", "true");
    container.dataset.sourceStart = String(figure.sourceOffset);
    container.dataset.sourceEnd = String(figure.sourceOffset);
    Object.assign(container.style, {
      margin: "2em 0",
    });
    const image = document.createElement("img");
    image.src = figure.src;
    image.alt = figure.alt || figure.caption || "本文画像";
    image.loading = "lazy";
    image.decoding = "async";
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

  function createVeiledImageSurface(image: HTMLImageElement, maxHeight: string, borderRadius: string): HTMLElement {
    const surface = document.createElement("div");
    surface.setAttribute("data-reader-image-surface", "true");
    Object.assign(surface.style, {
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
    const reveal = () => { veil.style.opacity = "0"; };
    const dim = () => { veil.style.opacity = "1"; };
    surface.addEventListener("pointerdown", reveal);
    surface.addEventListener("pointerup", dim);
    surface.addEventListener("pointercancel", dim);
    surface.addEventListener("pointerleave", dim);
    surface.append(image, veil);
    return surface;
  }

  function restoreTextPosition(scroller: HTMLElement, blockElements: HTMLElement[], readableBlocks: ReaderBlock[]): void {
    const blockIndex = globalThis.Engine.findBlockIndexForOffset(readableBlocks, currentOffset);
    const target = blockElements[blockIndex];
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const block = readableBlocks[blockIndex];
    if (!block) return;
    const ratio = block.end > block.start ? (currentOffset - block.start) / (block.end - block.start) : 0;
    const targetY = targetRect.top - scrollerRect.top + scroller.scrollTop + targetRect.height * Math.min(1, Math.max(0, ratio));
    scroller.scrollTop = Math.max(0, targetY - scroller.clientHeight / 2);
  }

  function renderCurrentUnit() {
    if (!display || units.length === 0) return;

    const unit = units[currentUnitIndex];
    if (!unit) return;
    currentOffset = unit.start;
    if (unit.sentenceIndex !== contextSentenceIndex) {
      const context = globalThis.Engine.surroundingSentences(units, currentUnitIndex);
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
    fitDisplayText();
    applyUnitStyle(unit.kind);
    updateMinimap(unit.start, unit.end);
  }

  function fadeContext(element: HTMLElement): void {
    if (!element.textContent || prefersReducedMotion()) return;
    element.animate(
      [{ opacity: 0.12 }, { opacity: 0.26 }],
      { duration: 120, easing: "ease-out" },
    );
  }

  function fitDisplayText() {
    if (!display) return;

    display.style.fontSize = DISPLAY_FONT_SIZE;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const computedStyle = globalThis.getComputedStyle?.(display);
      const fontSize = Number.parseFloat(computedStyle?.fontSize);
      const leftPadding = Number.parseFloat(computedStyle?.paddingLeft) || 0;
      const rightPadding = Number.parseFloat(computedStyle?.paddingRight) || 0;
      const horizontalPadding = leftPadding + rightPadding;
      const availableWidth = Math.max(0, display.clientWidth - horizontalPadding);
      const requiredWidth = measureDisplayTextWidth(horizontalPadding);
      if (availableWidth <= 0 || requiredWidth <= availableWidth) return;
      if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(requiredWidth)) return;
      display.style.fontSize = `${fontSize * (availableWidth / requiredWidth) * 0.96}px`;
    }
  }

  function measureDisplayTextWidth(horizontalPadding: number): number {
    const displayNode = display;
    if (!displayNode) return 0;
    let range: Range | null = null;
    const alignment = displayNode.style.justifyContent;
    try {
      displayNode.style.justifyContent = "flex-start";
      range = document.createRange?.();
      range?.selectNodeContents(displayNode);
      const rangeWidth = range?.getBoundingClientRect().width;
      const overflowWidth = Math.max(0, displayNode.scrollWidth - horizontalPadding);
      if (Number.isFinite(rangeWidth)) return Math.max(overflowWidth, rangeWidth);
      return overflowWidth;
    } catch {
      return Math.max(0, displayNode.scrollWidth - horizontalPadding);
    } finally {
      displayNode.style.justifyContent = alignment;
      range?.detach?.();
    }
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

  function updateMinimap(currentOffset: number, currentEnd: number): void {
    if (headingNodes.length === 0) return;

    const activeHeadingIndex = globalThis.Engine.findActiveHeadingIndex(
      sectionTransitions,
      currentOffset,
      initialHeadingIndex,
    );

    const progress = globalThis.Engine.calculateReadingProgress(
      currentEnd,
      units[units.length - 1]?.end || 0,
    );
    if (progressLabel) progressLabel.textContent = `${progress}%`;
    if (progressBar) progressBar.style.width = `${progress}%`;
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

  function scheduleNext() {
    stopTimer();
    if (playbackState !== "playing") return;

    const currentUnit = units[currentUnitIndex];
    if (!currentUnit) {
      pause();
      return;
    }
    const followingUnit = units[currentUnitIndex + 1];

    timerId = globalThis.setTimeout(() => {
      if (playbackState !== "playing") return;

      const nextFigure = figures[nextFigureIndex];
      const displayedUnit = units[currentUnitIndex];
      if (!displayedUnit) {
        pause();
        return;
      }
      const unitAfterDisplayed = units[currentUnitIndex + 1];
      const reachesFigure = nextFigure && (
        nextFigure.sourceOffset <= displayedUnit.end
        || (unitAfterDisplayed
          ? nextFigure.sourceOffset <= unitAfterDisplayed.start
          : nextFigure.sourceOffset <= sourceText.length)
      );
      if (nextFigure && reachesFigure) {
        nextFigureIndex += 1;
        showFigure(nextFigure);
        return;
      }

      if (currentUnitIndex >= units.length - 1) {
        pause();
        return;
      }

      currentUnitIndex += 1;
      renderCurrentUnit();
      scheduleNext();
    }, globalThis.Engine.displayDuration(
      currentUnit,
      followingUnit,
      Boolean(followingUnit)
        && activeHeadingAt(currentUnit.start) !== activeHeadingAt(followingUnit?.start ?? currentUnit.start),
    ));
  }

  function activeHeadingAt(offset: number): number {
    return globalThis.Engine.findActiveHeadingIndex(
      sectionTransitions,
      offset,
      initialHeadingIndex,
    );
  }

  function showFigure(figure: ReaderFigure): void {
    if (!readerMain || !display) return;
    pause();

    animateOpacity(display, 1, 0, 180);
    display.style.pointerEvents = "none";

    figurePanel = document.createElement("figure");
    figurePanel.setAttribute("aria-label", "本文画像");
    figurePanel.dataset.sourceStart = String(figure.sourceOffset);
    Object.assign(figurePanel.style, {
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
    image.src = figure.src;
    image.alt = figure.alt || figure.caption || "本文画像";
    const imageSurface = createVeiledImageSurface(image, "min(54vh, 560px)", "12px");
    Object.assign(image.style, {
      display: "block",
      maxWidth: "100%",
      objectFit: "contain",
    });

    figurePanel.append(imageSurface);
    if (figure.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = figure.caption;
      Object.assign(caption.style, {
        width: "min(720px, 100%)",
        color: "rgba(255,255,255,0.58)",
        fontSize: "13px",
        lineHeight: "1.4",
        textAlign: "center",
      });
      figurePanel.append(caption);
    }
    readerMain.append(figurePanel);
    animateOpacity(figurePanel, 0, 1, 180);
  }

  function resumeAfterFigure() {
    if (!figurePanel) return;
    const shownOffset = Number(figurePanel.dataset.sourceStart);
    dismissFigurePanel();
    const displayedUnit = units[currentUnitIndex];
    const nextFigure = figures[nextFigureIndex];
    const resumesBeforeCurrentUnit = Boolean(displayedUnit) && shownOffset <= (displayedUnit?.start ?? 0);
    const nextFigureThreshold = resumesBeforeCurrentUnit ? displayedUnit?.start : displayedUnit?.end;
    if (nextFigure && nextFigureThreshold !== undefined && nextFigure.sourceOffset <= nextFigureThreshold) {
      nextFigureIndex += 1;
      showFigure(nextFigure);
      return;
    }
    if (resumesBeforeCurrentUnit) {
      play();
      return;
    }
    if (currentUnitIndex >= units.length - 1) {
      pause();
      return;
    }
    currentUnitIndex += 1;
    renderCurrentUnit();
    play();
  }

  function dismissFigurePanel() {
    const outgoing = figurePanel;
    if (!outgoing) return;
    figurePanel = null;
    outgoing.style.pointerEvents = "none";
    const outgoingAnimation = animateOpacity(outgoing, 1, 0, 180);
    afterAnimation(outgoingAnimation, () => outgoing.remove());
    if (display) {
      animateOpacity(display, 0, 1, 180);
      display.style.pointerEvents = "auto";
    }
  }

  function syncNextFigureIndex() {
    const currentOffset = units[currentUnitIndex]?.start ?? 0;
    nextFigureIndex = figures.findIndex((figure) => figure.sourceOffset >= currentOffset);
    if (nextFigureIndex < 0) nextFigureIndex = figures.length;
  }

  function play() {
    if (units.length === 0) return;
    const currentUnit = units[currentUnitIndex];
    const nextFigure = figures[nextFigureIndex];
    if (!figurePanel && currentUnit && nextFigure && nextFigure.sourceOffset <= currentUnit.start) {
      nextFigureIndex += 1;
      showFigure(nextFigure);
      return;
    }
    playbackState = "playing";
    updatePlayPauseButton();
    scheduleNext();
  }

  function pause() {
    if (playbackState !== "idle") playbackState = "paused";
    stopTimer();
    updatePlayPauseButton();
  }

  function togglePlayPause() {
    if (figurePanel) {
      resumeAfterFigure();
      return;
    }
    if (playbackState === "playing") {
      pause();
    } else {
      play();
    }
  }

  function goBackOneSentence() {
    if (units.length === 0) return;
    if (figurePanel) {
      const figureOffset = Number(figurePanel.dataset.sourceStart);
      dismissFigurePanel();
      const unitBeforeFigure = globalThis.Engine.findUnitIndex(units, Math.max(0, figureOffset - 1));
      currentUnitIndex = globalThis.Engine.findSentenceStart(units, unitBeforeFigure);
      syncNextFigureIndex();
      renderCurrentUnit();
      play();
      return;
    }
    dismissFigurePanel();
    currentUnitIndex = globalThis.Engine.findPreviousSentenceStart(units, currentUnitIndex);
    syncNextFigureIndex();
    renderCurrentUnit();
    if (playbackState === "playing") scheduleNext();
  }

  function jumpToHeading(headingIndex: number): void {
    if (units.length === 0) return;
    dismissFigurePanel();
    const transition = sectionTransitions.find((entry) => entry.headingIndex === headingIndex);
    const targetOffset = transition?.offset ?? 0;
    const targetIndex = units.findIndex((unit) => unit.end > targetOffset);
    stopTimer();
    currentUnitIndex = targetIndex < 0 ? units.length - 1 : targetIndex;
    syncNextFigureIndex();
    renderCurrentUnit();
    if (playbackState === "playing") scheduleNext();
  }

  function updatePlayPauseButton() {
    if (!playPauseButton) return;
    const playing = playbackState === "playing";
    playPauseButton.replaceChildren(
      globalThis.ReaderIcons.create(document, playing ? "pause" : "play", playing ? 26 : 30),
    );
    playPauseButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
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
    if (!display || isEditableTarget(event.target)) return;
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
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'button:not([hidden]):not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const active = root.getRootNode() instanceof ShadowRoot
      ? (root.getRootNode() as ShadowRoot).activeElement
      : document.activeElement;
    const currentIndex = focusable.indexOf(active as HTMLElement);
    let nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0) nextIndex = event.shiftKey ? focusable.length - 1 : 0;
    if (nextIndex < 0) nextIndex = focusable.length - 1;
    if (nextIndex >= focusable.length) nextIndex = 0;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (typeof target !== "object" || target === null) return false;
    const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
    const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
    return candidate.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select";
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
    document.removeEventListener("keydown", handleKeyDown);
    displayResizeObserver?.disconnect();
    displayResizeObserver = null;
    document.getElementById(ROOT_ID)?.remove();
    root = null;
    rootHost = null;
    rootStyle = null;
    loadingLayer = null;
    previousContext = null;
    display = null;
    nextContext = null;
    contextSentenceIndex = null;
    readerMain = null;
    playPauseButton = null;
    headingNodes = [];
    progressLabel = null;
    progressBar = null;
    figurePanel = null;
  }

  function close() {
    const restoreFocus = launchFocus;
    pause();
    removeOverlay();
    activeRequestId = null;
    units = [];
    currentUnitIndex = 0;
    headings = [];
    sectionTransitions = [];
    initialHeadingIndex = -1;
    figures = [];
    nextFigureIndex = 0;
    playbackState = "idle";
    sourceText = "";
    blocks = [];
    currentOffset = 0;
    launchFocus = null;
    if (restoreFocus && typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => restoreFocus.focus?.());
    } else restoreFocus?.focus?.();
  }
})();
