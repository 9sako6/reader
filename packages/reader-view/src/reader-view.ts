import { createElement, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";

export type ReaderViewModel =
  | { kind: "closed" }
  | { kind: "loading"; slow: boolean; reducedMotion: boolean; revealed?: boolean; mobile?: boolean }
  | { kind: "error"; message: string; canRetry: boolean; mobile?: boolean }
  | {
    kind: "rsvp";
    previous: string;
    next: string;
    unit: ReaderUnit | null;
    figure: ReaderFigureView | null;
    playing: boolean;
    progress: number;
    loadingCover?: boolean;
    headings: ReaderHeading[];
    activeHeadingIndex: number;
    mobile?: boolean;
  }
  | {
    kind: "text";
    language: string;
    blocks: ReaderBlock[];
    figures: ReaderFigure[];
    position: ReaderPosition;
    progress: number;
    title: string;
    mobile?: boolean;
  };

export type ReaderFigureView = {
  figure: ReaderFigure;
  figureIndex: number;
  status: "loading" | "ready" | "failed";
  loadingVisible?: boolean;
  brightness?: "dimmed" | "revealed";
};

export interface ReaderViewHandlers {
  close(): void;
  cancel(): void;
  retry(): void;
  switchToText(): void;
  switchToRsvp(): void;
  previousSentence(): void;
  headingSelect?(headingIndex: number): void;
  togglePlayback(): void;
  resumeFigure(): void;
  figureLoad(figureIndex: number): void;
  figureError(figureIndex: number): void;
  toggleFigureBrightness?(figureIndex: number): void;
  textScroll(element: HTMLElement): void;
  textPosition(element: HTMLElement): void;
  rsvpPointerUp?(event: PointerEvent): void;
}

export interface ReaderViewMount {
  render(model: ReaderViewModel, handlers: ReaderViewHandlers): void;
  unmount(): void;
}

const buttonStyle = {
  minWidth: "44px",
  minHeight: "44px",
  padding: "0 14px",
  border: "0",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.08)",
  color: "#ffffff",
  font: "inherit",
  cursor: "pointer",
};

function button(label: string, onClick: () => void, extra: Record<string, unknown> = {}): ReactElement {
  return createElement("button", {
    type: "button",
    "aria-label": label === "続きを読む" ? label : label === "閉じる" ? "readerを閉じる" : undefined,
    style: { ...buttonStyle, ...extra },
    onClick,
    children: label === "閉じる"
      ? createElement("svg", { width: 22, height: 22, viewBox: "0 0 24 24", "aria-hidden": "true", children: createElement("path", { d: "M6 6l12 12M18 6L6 18", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }) })
      : label,
  });
}

function iconButton(label: string, onClick: () => void, extra: Record<string, unknown> = {}, pressed?: boolean): ReactElement {
  return createElement("button", {
    type: "button",
    "aria-label": label,
    title: label,
    "aria-pressed": pressed === undefined ? undefined : String(pressed),
    style: {
      width: "44px",
      height: "44px",
      padding: "0",
      border: "0",
      background: "transparent",
      color: "rgba(255,255,255,0.72)",
      font: "inherit",
      cursor: "pointer",
      ...extra,
    },
    onClick,
    children: label === "再生" || label === "一時停止" ? (label === "再生" ? "▶" : "Ⅱ") : label,
  });
}

function figureDescription(figure: ReaderFigure): string {
  const alt = figure.alt.trim();
  const caption = figure.caption.trim();
  if (alt && caption && alt !== caption) return `${alt}。${caption}`;
  return alt || caption || "本文画像";
}

function renderFigure(
  figureView: ReaderFigureView,
  handlers: ReaderViewHandlers,
  text: boolean,
): ReactElement {
  const { figure, figureIndex, status } = figureView;
  const loading = status === "loading";
  const loadingVisible = figureView.loadingVisible === true;
  const failed = status === "failed";
  const revealed = figureView.brightness === "revealed";
  const image = createElement("img", {
    src: figure.src,
    srcSet: figure.srcset,
    sizes: figure.sizes,
    alt: figure.alt || figure.caption || "本文画像",
    width: figure.width,
    height: figure.height,
    decoding: "async",
    loading: text ? "lazy" : undefined,
    "data-reader-source": text ? figure.src : undefined,
    onLoad: () => handlers.figureLoad(figureIndex),
    onError: () => handlers.figureError(figureIndex),
    style: {
      display: "block",
      width: text ? "auto" : "100%",
      height: "auto",
      maxWidth: "100%",
      maxHeight: text ? "72vh" : "min(54vh, 560px)",
      objectFit: "contain",
    },
  });
  const surface = createElement("button", {
    type: "button",
    "data-reader-image-surface": "true",
    "data-reader-ignore-gesture": "true",
    "aria-pressed": String(revealed),
    "aria-label": revealed ? "画像を暗く表示" : "画像を明るく表示",
    title: revealed ? "画像を暗く表示" : "画像を明るく表示",
    hidden: loading || failed,
    disabled: loading || failed,
    "aria-hidden": loading ? "true" : undefined,
    onClick: () => handlers.toggleFigureBrightness?.(figureIndex),
    style: {
      appearance: "none",
      border: "0",
      padding: "0",
      background: "transparent",
      color: "inherit",
      position: "relative",
      display: "block",
      width: "min(100%, 720px)",
      margin: "0 auto",
      overflow: "hidden",
      borderRadius: text ? "10px" : "12px",
      touchAction: "manipulation",
    },
    children: [
      image,
      createElement("div", {
        key: "veil",
        "data-reader-image-veil": "true",
        style: {
          position: "absolute",
          inset: "0",
          background: "rgba(0,0,0,0.46)",
          opacity: revealed ? "0" : "1",
          pointerEvents: "none",
        },
      }),
    ],
  });
  const statusElement = createElement("div", {
    key: "status",
    "data-reader-figure-status": "true",
    role: "status",
    "aria-live": "polite",
    hidden: !loadingVisible && !failed,
    style: { display: loadingVisible || failed ? "flex" : "none", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.4" },
    children: failed ? "画像を読み込めませんでした" : [
      "画像を準備しています",
      createElement("span", {
        key: "indicator",
        "data-reader-figure-indicator": "true",
        "aria-hidden": "true",
        style: { width: "28px", height: "2px", borderRadius: "999px", background: "rgba(255,255,255,0.28)", display: "inline-block", overflow: "hidden" },
        children: createElement("span", { style: { display: "block", width: "100%", height: "100%", background: "rgba(255,255,255,0.84)" } }),
      }),
    ],
  });
  const description = createElement("div", {
    key: "description",
    "data-reader-figure-description": "true",
    hidden: !loadingVisible && !failed,
    style: { color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.45", textAlign: "center" },
    children: figureDescription(figure),
  });
  const caption = figure.caption
    ? createElement("figcaption", { key: "caption", hidden: loading || failed, children: figure.caption })
    : null;
  return createElement("figure", {
    "aria-label": "本文画像",
    "data-reader-position-kind": "figure",
    "data-source-start": String(figure.sourceOffset),
    "data-source-end": String(figure.sourceEnd),
    "data-figure-index": String(figureIndex),
    "data-reader-text-figure": text ? "true" : undefined,
    className: text ? "article-figure" : "rsvp-figure",
    onClick: (event: { target: EventTarget | null }) => {
      const target = event.target as HTMLButtonElement | null;
      if (target?.getAttribute?.("data-reader-image-surface") === "true" && target.disabled) handlers.toggleFigureBrightness?.(figureIndex);
    },
    style: text ? { margin: "2em 0" } : { position: "absolute", inset: "52px 0 64px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "20px 16px 8px", boxSizing: "border-box" },
    children: [surface, statusElement, description, caption],
  });
}

function renderLoading(model: Extract<ReaderViewModel, { kind: "loading" }>, handlers: ReaderViewHandlers): ReactElement {
  const children: ReactNode[] = model.revealed === false ? [] : [createElement(LoadingIndicator, { key: "bar", mobile: model.mobile === true, reducedMotion: model.reducedMotion })];
  if (model.slow) {
    children.push(createElement("div", { key: "status", className: model.mobile ? "launch-status" : undefined, "data-reader-loading-label": "true", role: "status", style: { position: "absolute", left: "50%", top: "calc(50% + 24px)", transform: "translateX(-50%)", color: "rgba(255,255,255,0.82)", fontSize: "14px", whiteSpace: "nowrap" }, children: "文章を準備しています" }));
    children.push(createElement("button", { key: "cancel", type: "button", "data-reader-loading-cancel": "true", className: model.mobile ? "launch-cancel" : undefined, style: { ...buttonStyle, position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)" }, onClick: handlers.cancel, children: "中止" }));
    children.push(button("閉じる", handlers.close, { key: "close", position: "absolute", right: "24px", bottom: "24px" }));
  }
  return createElement("div", { className: model.mobile ? "launch-feedback" : undefined, "data-reader-loading": "true", style: { position: "absolute", inset: "0", pointerEvents: model.slow ? "auto" : "none" }, children });
}

function LoadingIndicator({ mobile, reducedMotion }: { mobile: boolean; reducedMotion: boolean }): ReactElement {
  const indicatorRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator || reducedMotion || typeof indicator.animate !== "function") return undefined;
    const animation = indicator.animate(
      [
        { transform: "translateX(-100%) scaleX(.35)" },
        { transform: "translateX(220%) scaleX(.35)" },
      ],
      { duration: 1100, iterations: Infinity, easing: "linear" },
    );
    return () => animation.cancel?.();
  }, [reducedMotion]);
  return createElement("div", {
    className: mobile ? "launch-loader" : undefined,
    "data-reader-loading-bar": "true",
    "aria-hidden": "true",
    style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(180px, calc(100% - 48px))", height: "2px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.18)", pointerEvents: "none", display: "block", opacity: "1" },
    children: createElement("div", {
      className: mobile ? "launch-progress-track" : undefined,
      "data-reader-loading-indicator": "true",
      style: { width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.18)" },
      children: createElement("div", {
        className: mobile ? "launch-progress-indicator" : undefined,
        style: { width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.82)", transform: reducedMotion ? "translateX(0) scaleX(.35)" : "translateX(-100%) scaleX(.35)", transformOrigin: "left center" },
        ref: (element: HTMLElement | null) => { indicatorRef.current = element; },
      }),
    }),
  });
}

function renderError(model: Extract<ReaderViewModel, { kind: "error" }>, handlers: ReaderViewHandlers): ReactElement {
  const actions = [model.canRetry ? button("やり直す", handlers.retry) : null, button("元に戻る", handlers.close)];
  if (model.mobile) {
    return createElement("section", { className: "reader", role: "dialog", "aria-label": "reader", "aria-modal": "true", children: createElement("main", { className: "content", children: createElement("div", { className: "error", "data-reader-error": "true", children: [createElement("div", { key: "message", children: model.message }), createElement("div", { key: "actions", className: "error-actions", children: actions })] }) }) });
  }
  return createElement("div", { "data-reader-error": "true", style: { position: "absolute", inset: "0" }, children: [createElement("div", { key: "message", style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "clamp(22px, 3vw, 34px)", fontWeight: "600", whiteSpace: "nowrap" }, children: model.message }), createElement("div", { key: "actions", style: { position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)", display: "flex", gap: "10px" }, children: actions })] });
}

function renderMinimap(model: Extract<ReaderViewModel, { kind: "rsvp" }>, handlers: ReaderViewHandlers): ReactElement | null {
  if (model.headings.length === 0) return null;
  return createElement("aside", { "data-reader-minimap": "true", "aria-label": "読書位置", style: { position: "relative", width: "100%", maxHeight: "min(72vh, 640px)", boxSizing: "border-box", zIndex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column", gap: "16px", alignSelf: "center", padding: "14px 10px 10px", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "18px", background: "rgba(36,36,36,0.72)", boxShadow: "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)", backdropFilter: "blur(28px) saturate(150%)", WebkitBackdropFilter: "blur(28px) saturate(150%)", color: "rgba(255,255,255,0.62)" }, children: [
    createElement("div", { key: "title", style: { fontSize: "13px" }, children: "記事の構成" }),
    createElement("nav", { key: "nav", "aria-label": "記事の構成", style: { minHeight: "0", overflow: "auto", display: "flex", flexDirection: "column", gap: "4px", padding: "2px 0", scrollbarWidth: "none", msOverflowStyle: "none" }, children: model.headings.map((heading, index) => createElement("button", { key: `${index}-${heading.text}`, type: "button", "aria-current": index === model.activeHeadingIndex ? "location" : "false", onClick: () => handlers.headingSelect?.(index), style: { ...buttonStyle, minHeight: "36px", padding: "4px 8px", paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px`, borderRadius: "8px", border: "0", boxShadow: "none", background: index === model.activeHeadingIndex ? "rgba(255,255,255,0.12)" : "transparent", textAlign: "left", fontSize: "13px", color: "inherit" }, children: heading.text })) }),
  ] });
}

function blockTag(block: ReaderBlock): string {
  if (block.kind === "heading") return `h${Math.min(6, Math.max(1, block.level || 2))}`;
  if (block.kind === "quote") return "blockquote";
  if (block.kind === "preformatted") return "pre";
  return "p";
}

function renderBlock(block: ReaderBlock, index: number, language: string): ReactElement {
  const tag = blockTag(block);
  const sentenceSpans = globalThis.Engine.splitSentenceSpans(block.text, language);
  const children = sentenceSpans.length > 0
    ? sentenceSpans.map((sentence, sentenceIndex) => createElement("span", { key: `${sentence.start}-${sentenceIndex}`, className: "text-sentence", "data-reader-text-anchor": "true", "data-reader-position-kind": "text", "data-source-start": String(block.start + sentence.start), "data-source-end": String(block.start + sentence.end), children: block.text.slice(sentence.start, sentence.end) }))
    : block.text;
  return createElement(tag, { key: `${block.start}-${index}`, className: tag === "p" ? "paragraph" : tag === "h1" ? "article-title" : undefined, "data-source-start": String(block.start), "data-source-end": String(block.end), children });
}

function orderedTextChildren(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactNode[] {
  const blocks = model.blocks.map((block, index) => ({ kind: "block" as const, offset: block.start, value: renderBlock(block, index, model.language) }));
  const figures = model.figures.map((figure, figureIndex) => ({ kind: "figure" as const, offset: figure.sourceOffset, value: renderFigure({ figure, figureIndex, status: "ready", brightness: "dimmed" }, handlers, true) }));
  return [...blocks, ...figures].sort((left, right) => left.offset - right.offset || (left.kind === "figure" ? -1 : 1)).map((entry) => entry.value);
}

function renderDesktopRsvp(model: Extract<ReaderViewModel, { kind: "rsvp" }>, handlers: ReaderViewHandlers): ReactElement {
  const current = createElement("div", { "data-reader-unit": "true", "data-reader-position-kind": model.figure ? "figure" : "text", "data-source-start": String(model.figure?.figure.sourceOffset ?? model.unit?.start ?? 0), "data-source-end": String(model.figure?.figure.sourceEnd ?? model.unit?.end ?? 0), "data-figure-index": model.figure ? String(model.figure.figureIndex) : undefined, "aria-live": "off", "aria-atomic": "false", style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", height: "1.35em", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: "12px", fontSize: "clamp(36px, 4.5vw, 64px)", fontWeight: "600", lineHeight: "1.35", textAlign: "center", whiteSpace: "nowrap", overflow: model.figure ? "visible" : "hidden", overflowWrap: "normal", wordBreak: "keep-all" }, children: model.figure ? renderFigure(model.figure, handlers, false) : model.unit?.text || "" });
  const transport = model.figure
    ? button("続きを読む", handlers.resumeFigure, { key: "resume", minWidth: "88px" })
    : iconButton(model.playing ? "一時停止" : "再生", handlers.togglePlayback, { fontSize: "20px", width: "56px", height: "56px", color: "rgba(245,245,247,0.66)" }, model.playing);
  return createElement("div", { "data-reader-stage": "true", className: "rsvp-view", style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(980px, calc(100% - 48px))", height: "calc(100% - 48px)", display: "grid", gridTemplateColumns: model.headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: model.headings.length > 0 ? "32px" : "0", alignItems: "stretch" }, children: [renderMinimap(model, handlers), createElement("main", { key: "main", style: { position: "relative", minWidth: "0", height: "100%" }, children: [
    createElement("div", { key: "topbar", "data-reader-topbar": "true", style: { position: "absolute", top: "8px", left: "0", right: "0", height: "44px", zIndex: "2", pointerEvents: "none", display: "flex", justifyContent: "space-between" }, children: [button("文章で読む", handlers.switchToText, { pointerEvents: "auto", minWidth: "112px" }), button("閉じる", handlers.close, { pointerEvents: "auto", width: "44px", height: "44px", padding: "0", background: "transparent" })] }),
    createElement("div", { key: "previous", "data-reader-context-previous": "true", "aria-hidden": "true", style: { position: "absolute", left: "50%", bottom: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }, children: model.previous }),
    current,
    createElement("div", { key: "next", "data-reader-context-next": "true", "aria-hidden": "true", style: { position: "absolute", left: "50%", top: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }, children: model.next }),
    createElement("div", { key: "controls", style: { position: "absolute", left: "50%", bottom: "8px", transform: "translateX(-50%)", width: "min(100%, 264px)", minHeight: "56px", display: "grid", gridTemplateColumns: "1fr 56px 1fr", alignItems: "center" }, children: [iconButton("1文戻る", handlers.previousSentence, { width: "52px", height: "52px", color: "rgba(245,245,247,0.66)" }), transport, createElement("span", { key: "spacer" })] }),
    createElement("span", { key: "progress", "data-reader-progress": "true", style: { position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }, children: `${model.progress}%` }),
  ] }), model.loadingCover ? createElement(LoadingIndicator, { key: "loading-cover", mobile: false, reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true }) : null] });
}

function renderDesktopText(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactElement {
  return createElement("div", { "data-reader-text-shell": "true", className: "text-view", style: { width: "min(900px, calc(100% - 32px))", height: "calc(100% - 32px)", margin: "16px auto", position: "relative", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "24px", background: "rgba(24,24,24,0.92)", overflow: "hidden" }, children: [
    createElement("main", { key: "scroller", "data-reader-text-scroller": "true", className: "text-view", ref: (element: HTMLElement | null) => { if (element) handlers.textScroll(element); }, onScroll: (event: { currentTarget: EventTarget | null }) => { if (event.currentTarget) handlers.textPosition(event.currentTarget as HTMLElement); }, style: { width: "100%", height: "100%", overflowY: "auto", boxSizing: "border-box", padding: "72px clamp(24px, 7vw, 96px) 112px", scrollbarGutter: "stable" }, children: createElement("article", { className: "article", style: { maxWidth: "42rem", margin: "0 auto", color: "rgba(255,255,255,0.92)", fontSize: "clamp(17px, 1.7vw, 20px)", lineHeight: "1.9", letterSpacing: "0.01em" }, children: [model.title ? createElement("h1", { key: "title", className: "article-title", children: model.title }) : null, ...orderedTextChildren(model, handlers)] }) }),
    createElement("div", { key: "topbar", "data-reader-topbar": "true", style: { position: "absolute", top: "8px", left: "16px", right: "16px", height: "44px", zIndex: "2", display: "flex", justifyContent: "space-between", pointerEvents: "none" }, children: [button("RSVPで読む", handlers.switchToRsvp, { pointerEvents: "auto" }), button("閉じる", handlers.close, { pointerEvents: "auto" })] }),
    createElement("span", { key: "progress", "data-reader-progress": "true", style: { position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }, children: `${model.progress}%` }),
  ] });
}

function renderMobileRsvp(model: Extract<ReaderViewModel, { kind: "rsvp" }>, handlers: ReaderViewHandlers): ReactElement {
  const current = model.figure ? renderFigure(model.figure, handlers, false) : createElement("div", { className: `rsvp-unit ${model.unit?.kind || "body"}`, "data-reader-unit": "true", "data-reader-position-kind": "text", "data-source-start": model.unit ? String(model.unit.start) : "0", "data-source-end": model.unit ? String(model.unit.end) : "0", "aria-live": "off", "aria-atomic": "false", children: model.unit?.text || "" });
  const playLabel = model.figure ? "続きを読む" : model.playing ? "一時停止" : "再生";
  return createElement("section", { className: "reader", role: "dialog", "aria-label": "reader", "aria-modal": "true", onPointerUp: (event: PointerEvent) => handlers.rsvpPointerUp?.(event), children: [
    createElement("header", { key: "topbar", className: "topbar", children: createElement("button", { className: "icon-button", type: "button", "aria-label": "readerを閉じる", onClick: handlers.close, children: "×" }) }),
    createElement("footer", { key: "controlbar", className: "controlbar", children: [createElement("button", { key: "mode", className: "mode-button", type: "button", "data-reader-mode-button": "true", onClick: handlers.switchToText, children: "文章で読む" }), createElement("div", { key: "progress", className: "progress", children: `${model.progress}%` }), createElement("div", { key: "transport", className: "control-dock", children: [createElement("button", { key: "previous", className: "dock-button previous", type: "button", "aria-label": "1文戻る", "aria-keyshortcuts": "ArrowLeft", onClick: handlers.previousSentence, children: "1文戻る" }), createElement("button", { key: "play", className: "dock-button play", type: "button", "aria-label": playLabel, "aria-pressed": String(model.playing), "aria-keyshortcuts": "Space", onClick: model.figure ? handlers.resumeFigure : handlers.togglePlayback, children: model.figure ? "続きを読む" : model.playing ? "Ⅱ" : "▶" })] })] }),
    createElement("main", { key: "content", className: "content", children: createElement("div", { className: "rsvp-view", children: [createElement("div", { key: "previous", className: "context-unit previous", "aria-hidden": "true", children: model.previous }), current, createElement("div", { key: "next", className: "context-unit next", "aria-hidden": "true", children: model.next })] }) }),
  ] });
}

function renderMobileText(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactElement {
  return createElement("section", { className: "reader", role: "dialog", "aria-label": "reader", "aria-modal": "true", children: [
    createElement("header", { key: "topbar", className: "topbar", children: createElement("button", { className: "icon-button", type: "button", "aria-label": "readerを閉じる", onClick: handlers.close, children: "×" }) }),
    createElement("footer", { key: "controlbar", className: "controlbar", children: [createElement("button", { key: "mode", className: "mode-button", type: "button", "data-reader-mode-button": "true", onClick: handlers.switchToRsvp, children: "RSVPで読む" }), createElement("div", { key: "progress", className: "progress", "data-reader-progress": "true", children: `${model.progress}%` })] }),
    createElement("main", { key: "content", className: "content", children: createElement("div", { className: "text-view", "data-reader-text-scroller": "true", ref: (element: HTMLElement | null) => { if (element) handlers.textScroll(element); }, onScroll: (event: { currentTarget: EventTarget | null }) => { if (event.currentTarget) handlers.textPosition(event.currentTarget as HTMLElement); }, children: createElement("article", { className: "article", children: [model.title ? createElement("h1", { key: "title", className: "article-title" , children: model.title }) : null, ...orderedTextChildren(model, handlers)] }) }) }),
  ] });
}

function renderMobile(model: ReaderViewModel, handlers: ReaderViewHandlers): ReactElement | null {
  if (model.kind === "closed") return null;
  if (model.kind === "loading") return renderLoading(model, handlers);
  if (model.kind === "error") return renderError(model, handlers);
  if (model.kind === "rsvp") return renderMobileRsvp(model, handlers);
  return renderMobileText(model, handlers);
}

export function ReaderView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if ("mobile" in model && model.mobile) return renderMobile(model, handlers);
  if (model.kind === "loading") return renderLoading(model, handlers);
  if (model.kind === "error") return renderError(model, handlers);
  if (model.kind === "rsvp") return renderDesktopRsvp(model, handlers);
  return renderDesktopText(model, handlers);
}
