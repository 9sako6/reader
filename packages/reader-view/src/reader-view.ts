import { createElement, type ReactElement, type ReactNode } from "react";

export type ReaderViewModel =
  | { kind: "closed" }
  | { kind: "loading"; slow: boolean; reducedMotion: boolean; mobile?: boolean }
  | { kind: "error"; message: string; canRetry: boolean; mobile?: boolean }
  | {
    kind: "rsvp";
    previous: string;
    next: string;
    unit: ReaderUnit | null;
    figure: ReaderFigureView | null;
    playing: boolean;
    progress: number;
    headings: ReaderHeading[];
    activeHeadingIndex: number;
    mobile?: boolean;
  }
  | {
    kind: "text";
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
};

export interface ReaderViewHandlers {
  close(): void;
  cancel(): void;
  retry(): void;
  switchToText(): void;
  switchToRsvp(): void;
  previousSentence(): void;
  togglePlayback(): void;
  resumeFigure(): void;
  figureLoad(figureIndex: number): void;
  figureError(figureIndex: number): void;
  textScroll(element: HTMLElement): void;
  textPosition(element: HTMLElement): void;
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
    style: { ...buttonStyle, ...extra },
    onClick,
    children: label,
  });
}

function iconButton(label: string, onClick: () => void, extra: Record<string, unknown> = {}): ReactElement {
  return createElement("button", {
    type: "button",
    "aria-label": label,
    title: label,
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

function renderLoading(model: Extract<ReaderViewModel, { kind: "loading" }>, handlers: ReaderViewHandlers): ReactElement {
  const children: ReactNode[] = [
    createElement("div", {
      key: "bar",
      className: model.mobile ? "launch-loader" : undefined,
      "data-reader-loading-bar": "true",
      "aria-hidden": "true",
      style: {
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
      },
      children: createElement("div", {
        className: "launch-progress-track",
        "data-reader-loading-indicator": "true",
        style: {
          width: "100%",
          height: "100%",
          borderRadius: "inherit",
          background: "rgba(255,255,255,0.82)",
          transform: model.reducedMotion ? "translateX(0) scaleX(.35)" : "translateX(-100%) scaleX(.35)",
          transformOrigin: "left center",
        },
      }),
    }),
  ];
  if (model.slow) {
    children.push(createElement("div", {
      key: "status",
      className: model.mobile ? "launch-status" : undefined,
      "data-reader-loading-label": "true",
      role: "status",
      style: {
        position: "absolute",
        left: "50%",
        top: "calc(50% + 24px)",
        transform: "translateX(-50%)",
        color: "rgba(255,255,255,0.82)",
        fontSize: "14px",
        whiteSpace: "nowrap",
      },
      children: "文章を準備しています",
    }));
    children.push(button("中止", handlers.cancel, {
      key: "cancel",
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    }));
    children.push(button("閉じる", handlers.close, {
      key: "close",
      position: "absolute",
      right: "24px",
      bottom: "24px",
    }));
  }
  return createElement("div", { className: model.mobile ? "launch-feedback" : undefined, "data-reader-loading": "true", style: { position: "absolute", inset: "0", pointerEvents: model.slow ? "auto" : "none" }, children });
}

function renderError(model: Extract<ReaderViewModel, { kind: "error" }>, handlers: ReaderViewHandlers): ReactElement {
  return createElement("div", {
    "data-reader-error": "true",
    style: { position: "absolute", inset: "0" },
    children: [
      createElement("div", {
        key: "message",
        style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "clamp(22px, 3vw, 34px)", fontWeight: "600", whiteSpace: "nowrap" },
        children: model.message,
      }),
      createElement("div", {
        key: "actions",
        style: { position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)", display: "flex", gap: "10px" },
        children: [
          model.canRetry ? button("やり直す", handlers.retry) : null,
          button("元に戻る", handlers.close),
        ],
      }),
    ],
  });
}

function renderMinimap(model: Extract<ReaderViewModel, { kind: "rsvp" }>): ReactElement | null {
  if (model.headings.length === 0) return null;
  return createElement("aside", {
    "data-reader-minimap": "true",
    style: { minWidth: "0", height: "100%", display: "flex", flexDirection: "column", gap: "16px", padding: "16px 0", color: "rgba(255,255,255,0.62)" },
    children: [
      createElement("div", { key: "title", style: { fontSize: "13px" }, children: "記事の構成" }),
      createElement("nav", {
        key: "nav",
        style: { minHeight: "0", overflow: "auto", display: "flex", flexDirection: "column", gap: "4px" },
        children: model.headings.map((heading, index) => createElement("button", {
          key: `${index}-${heading.text}`,
          type: "button",
          style: { ...buttonStyle, minHeight: "36px", padding: "4px 8px", borderRadius: "8px", background: index === model.activeHeadingIndex ? "rgba(255,255,255,0.12)" : "transparent", textAlign: "left", fontSize: "13px", color: "inherit" },
          children: heading.text,
        })),
      }),
    ],
  });
}

function renderFigure(figureView: ReaderFigureView, handlers: ReaderViewHandlers, text = false): ReactElement {
  const { figure, figureIndex, status } = figureView;
  const image = createElement("img", {
    src: figure.src,
    srcSet: figure.srcset,
    sizes: figure.sizes,
    alt: figure.alt,
    width: figure.width,
    height: figure.height,
    onLoad: () => handlers.figureLoad(figureIndex),
    onError: () => handlers.figureError(figureIndex),
    style: { display: "block", maxWidth: "100%", maxHeight: text ? "none" : "min(55vh, 520px)", objectFit: "contain", filter: "none" },
  });
  const imageSurface = createElement("div", {
    "data-reader-figure-surface": "true",
    style: { position: "relative", display: "inline-flex", maxWidth: "100%", overflow: "hidden", borderRadius: "12px", background: "rgba(255,255,255,0.04)" },
    children: image,
  });
  const children: ReactNode[] = [imageSurface];
  if (status === "loading") children.push(createElement("div", { key: "status", "data-reader-figure-status": "true", role: "status", children: "画像を準備しています" }));
  if (status === "failed") children.push(createElement("div", { key: "failed", "data-reader-figure-status": "true", role: "status", children: ["画像を読み込めませんでした", button("再試行", () => handlers.figureLoad(figureIndex))] }));
  if (figure.caption) children.push(createElement("figcaption", { key: "caption", children: figure.caption }));
  return createElement("figure", { "data-reader-figure-index": String(figureIndex), children });
}

function renderRsvp(model: Extract<ReaderViewModel, { kind: "rsvp" }>, handlers: ReaderViewHandlers): ReactElement {
  const current = model.figure
    ? renderFigure(model.figure, handlers)
    : createElement("div", {
      "data-reader-unit": "true",
      "aria-live": "off",
      "aria-atomic": "false",
      style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", height: "1.35em", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: "12px", fontSize: "clamp(36px, 4.5vw, 64px)", fontWeight: "600", lineHeight: "1.35", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", overflowWrap: "normal", wordBreak: "keep-all" },
      children: model.unit?.text || "",
    });
  return createElement("div", {
    "data-reader-stage": "true",
    style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(980px, calc(100% - 48px))", height: "calc(100% - 48px)", display: "grid", gridTemplateColumns: model.headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: model.headings.length > 0 ? "32px" : "0", alignItems: "stretch" },
    children: [
      renderMinimap(model),
      createElement("main", {
        key: "main",
        style: { position: "relative", minWidth: "0", height: "100%" },
        children: [
          createElement("div", { key: "topbar", "data-reader-topbar": "true", style: { position: "absolute", top: "8px", left: "0", right: "0", height: "44px", zIndex: "2", pointerEvents: "none", display: "flex", justifyContent: "space-between" }, children: [button("文章で読む", handlers.switchToText, { pointerEvents: "auto" }), button("閉じる", handlers.close, { pointerEvents: "auto" })] }),
          createElement("div", { key: "previous", "data-reader-context-previous": "true", style: { position: "absolute", left: "50%", bottom: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: ".26", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, children: model.previous }),
          current,
          createElement("div", { key: "next", "data-reader-context-next": "true", style: { position: "absolute", left: "50%", top: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: ".26", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, children: model.next }),
          createElement("div", { key: "controls", style: { position: "absolute", left: "50%", bottom: "8px", transform: "translateX(-50%)", width: "min(100%, 264px)", minHeight: "56px", display: "grid", gridTemplateColumns: "1fr 56px 1fr", alignItems: "center" }, children: [iconButton("1文戻る", handlers.previousSentence), iconButton(model.playing ? "一時停止" : "再生", handlers.togglePlayback, { fontSize: "20px" }), createElement("span", { key: "spacer" })] }),
          createElement("span", { key: "progress", "data-reader-progress": "true", style: { position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }, children: `${model.progress}%` }),
        ],
      }),
    ],
  });
}

function renderText(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactElement {
  const articleChildren: ReactNode[] = [];
  for (const [index, block] of model.blocks.entries()) {
    const tag = block.kind === "heading" ? `h${Math.min(6, Math.max(1, block.level || 2))}` : block.kind === "quote" ? "blockquote" : block.kind === "preformatted" ? "pre" : "p";
    articleChildren.push(createElement(tag, { key: `${block.start}-${index}`, "data-reader-position-start": String(block.start), "data-reader-position-end": String(block.end), children: block.text }));
  }
  for (const [index, figure] of model.figures.entries()) {
    articleChildren.push(renderFigure({ figure, figureIndex: index, status: "ready" }, handlers, true));
  }
  return createElement("div", { "data-reader-text-shell": "true", style: { position: "absolute", inset: "0", display: "grid", gridTemplateRows: "auto minmax(0,1fr)" }, children: [
    createElement("div", { key: "topbar", "data-reader-topbar": "true", style: { minHeight: "44px", padding: "8px 16px", display: "flex", justifyContent: "space-between" }, children: [button("RSVPで読む", handlers.switchToRsvp), button("閉じる", handlers.close)] }),
    createElement("main", { key: "scroller", "data-reader-text-scroller": "true", onScroll: (event: { currentTarget: HTMLElement }) => handlers.textScroll(event.currentTarget), style: { minHeight: "0", overflowY: "auto", padding: "56px 20px 96px", overscrollBehavior: "contain" }, children: createElement("article", { className: "article", children: [model.title ? createElement("h1", { key: "title", className: "article-title", children: model.title }) : null, ...articleChildren] }) }),
    createElement("span", { key: "progress", "data-reader-progress": "true", style: { position: "absolute", right: "16px", bottom: "16px", color: "rgba(235,235,235,0.58)", fontSize: "13px" }, children: `${model.progress}%` }),
  ] });
}

function renderMobileRsvp(model: Extract<ReaderViewModel, { kind: "rsvp" }>, handlers: ReaderViewHandlers): ReactElement {
  const figure = model.figure
    ? renderFigure(model.figure, handlers)
    : createElement("div", { className: `rsvp-unit ${model.unit?.kind || "body"}`, "data-reader-unit": "true", "aria-live": "off", "aria-atomic": "false", children: model.unit?.text || "" });
  return createElement("section", {
    className: "reader",
    role: "dialog",
    "aria-label": "reader",
    "aria-modal": "true",
    children: [
      createElement("header", { key: "topbar", className: "topbar", children: createElement("button", { className: "icon-button", type: "button", "aria-label": "readerを閉じる", onClick: handlers.close, children: "×" }) }),
      createElement("footer", { key: "controlbar", className: "controlbar", children: [
        createElement("button", { key: "mode", className: "mode-button", type: "button", onClick: handlers.switchToText, children: "文章で読む" }),
        createElement("div", { key: "progress", className: "progress", children: `${model.progress}%` }),
        createElement("div", { key: "transport", className: "control-dock", children: [
          createElement("button", { key: "previous", className: "dock-button previous", type: "button", "aria-label": "1文戻る", "aria-keyshortcuts": "ArrowLeft", onClick: handlers.previousSentence, children: "1文戻る" }),
          createElement("button", { key: "play", className: "dock-button play", type: "button", "aria-label": model.playing ? "一時停止" : "再生", "aria-pressed": String(model.playing), "aria-keyshortcuts": "Space", onClick: handlers.togglePlayback, children: model.playing ? "Ⅱ" : "▶" }),
        ] }),
      ] }),
      createElement("main", { key: "content", className: "content", children: createElement("div", { className: "rsvp-view", children: createElement("div", { className: "focus-area", children: [
        createElement("div", { key: "previous", className: "context-unit previous", "aria-hidden": "true", children: model.previous }),
        figure,
        createElement("div", { key: "next", className: "context-unit next", "aria-hidden": "true", children: model.next }),
      ] }) }) }),
    ],
  });
}

function renderMobileText(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactElement {
  const blocks = model.blocks.map((block, index) => {
    const tag = block.kind === "heading" ? `h${Math.min(6, Math.max(1, block.level || 2))}` : block.kind === "quote" ? "blockquote" : block.kind === "preformatted" ? "pre" : "p";
    return createElement(tag, { key: `${block.start}-${index}`, className: tag === "p" ? "paragraph" : tag === "h1" ? "article-title" : undefined, "data-source-start": String(block.start), "data-source-end": String(block.end), children: block.text });
  });
  return createElement("section", {
    className: "reader",
    role: "dialog",
    "aria-label": "reader",
    "aria-modal": "true",
    children: [
      createElement("header", { key: "topbar", className: "topbar", children: createElement("button", { className: "icon-button", type: "button", "aria-label": "readerを閉じる", onClick: handlers.close, children: "×" }) }),
      createElement("footer", { key: "controlbar", className: "controlbar", children: [createElement("button", { className: "mode-button", type: "button", onClick: handlers.switchToRsvp, children: "RSVPで読む" })] }),
      createElement("main", { key: "content", className: "content", children: createElement("div", { className: "text-view", "data-reader-text-scroller": "true", onScroll: (event: { currentTarget: HTMLElement }) => handlers.textScroll(event.currentTarget), children: createElement("article", { className: "article", children: [model.title ? createElement("h1", { key: "title", className: "article-title", children: model.title }) : null, ...blocks] }) }) }),
    ],
  });
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
  if (model.kind === "rsvp") return renderRsvp(model, handlers);
  return renderText(model, handlers);
}
