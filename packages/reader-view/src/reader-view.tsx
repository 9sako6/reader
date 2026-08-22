import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";

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
    rewindFeedback?: ReaderRewindFeedback;
    headings: ReaderHeading[];
    activeHeadingIndex: number;
    reducedMotion?: boolean;
    mobile?: boolean;
  }
  | {
    kind: "text";
    language: string;
    blocks: ReaderViewBlock[];
    figures: ReaderFigure[];
    position: ReaderPosition;
    progress: number;
    title: string;
    mobile?: boolean;
  };

export type ReaderViewBlock = ReaderBlock & { sentenceSpans: SentenceSpan[] };

export type ReaderFigureView = {
  figure: ReaderFigure;
  figureIndex: number;
  status: "loading" | "ready" | "failed";
  token?: number;
  loadingVisible?: boolean;
  brightness?: "dimmed" | "revealed";
};

export type ReaderRewindFeedback = {
  left: number;
  top: number;
  id: number;
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
  figureLoad(figureIndex: number, token?: number): void;
  figureError(figureIndex: number, token?: number): void;
  figureImage?(element: HTMLImageElement, figureIndex: number, token?: number): void;
  toggleFigureBrightness?(figureIndex: number): void;
  rewindFeedbackDone?(id: number): void;
  loadingAnimation?(element: HTMLElement, reducedMotion: boolean): (() => void) | undefined;
  rewindAnimation?(
    elements: { firstRing: HTMLElement; secondRing: HTMLElement; icon: SVGElement },
    reducedMotion: boolean,
    onDone: () => void,
  ): (() => void) | undefined;
  textScroll(element: HTMLElement | null): void;
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
  padding: "0 12px",
  border: "0",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.08)",
  color: "#ffffff",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
};

type ButtonExtras = Record<string, string | number | undefined>;

function Button({ label, onClick, extra = {} }: { label: string; onClick: () => void; extra?: ButtonExtras }): ReactElement {
  const modeButton = extra["data-reader-mode-button"];
  const ariaLabel = extra["aria-label"] ?? (label === "続きを読む" ? label : label === "閉じる" ? "readerを閉じる" : undefined);
  const styleExtra = { ...extra };
  const key = styleExtra.key;
  delete styleExtra.key;
  delete styleExtra["data-reader-mode-button"];
  delete styleExtra["aria-label"];
  return (
    <button
      key={key}
      type="button"
      aria-label={ariaLabel === undefined ? undefined : String(ariaLabel)}
      data-reader-mode-button={modeButton === undefined ? undefined : String(modeButton)}
      style={{ ...buttonStyle, ...styleExtra }}
      onClick={onClick}
    >
      {label === "閉じる" ? (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : label}
    </button>
  );
}

function IconButton({ label, onClick, extra = {}, pressed }: { label: string; onClick: () => void; extra?: CSSProperties; pressed?: boolean }): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      style={{
        width: "44px",
        height: "44px",
        padding: "0",
        border: "0",
        background: "transparent",
        color: "rgba(255,255,255,0.72)",
        font: "inherit",
        cursor: "pointer",
        ...extra,
      }}
      onClick={onClick}
    >
      {label === "再生" || label === "一時停止" ? (label === "再生" ? "▶" : "Ⅱ") : label}
    </button>
  );
}

function figureDescription(figure: ReaderFigure): string {
  const alt = figure.alt.trim();
  const caption = figure.caption.trim();
  if (alt && caption && alt !== caption) return `${alt}。${caption}`;
  return alt || caption || "本文画像";
}

function Figure({ figureView, handlers, text }: { figureView: ReaderFigureView; handlers: ReaderViewHandlers; text: boolean }): ReactElement {
  const { figure, figureIndex, status, token } = figureView;
  const loading = status === "loading";
  const loadingVisible = figureView.loadingVisible === true;
  const failed = status === "failed";
  const revealed = figureView.brightness === "revealed";
  const surface = failed ? null : (
    <button
      type="button"
      data-reader-image-surface="true"
      data-reader-ignore-gesture="true"
      aria-pressed={revealed}
      aria-label={revealed ? "画像を暗く表示" : "画像を明るく表示"}
      title={revealed ? "画像を暗く表示" : "画像を明るく表示"}
      hidden={loading || failed}
      disabled={loading || failed}
      aria-hidden={loading ? "true" : undefined}
      onClick={() => handlers.toggleFigureBrightness?.(figureIndex)}
      style={{
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
      }}
    >
      <img
        src={figure.src}
        srcSet={figure.srcset}
        sizes={figure.sizes}
        alt={figure.alt || figure.caption || "本文画像"}
        width={figure.width}
        height={figure.height}
        decoding="async"
        loading={text ? "lazy" : undefined}
        data-reader-source={text ? figure.src : undefined}
        onLoad={text ? undefined : () => handlers.figureLoad(figureIndex, token)}
        onError={text ? undefined : () => handlers.figureError(figureIndex, token)}
        ref={(element) => {
          if (element) handlers.figureImage?.(element, figureIndex, token);
        }}
        style={{
          display: "block",
          width: text ? "auto" : "100%",
          height: "auto",
          maxWidth: "100%",
          maxHeight: text ? "72vh" : "min(54vh, 560px)",
          objectFit: "contain",
        }}
      />
      <div
        data-reader-image-veil="true"
        style={{
          position: "absolute",
          inset: "0",
          background: "rgba(0,0,0,0.46)",
          opacity: revealed ? "0" : "1",
          pointerEvents: "none",
        }}
      />
    </button>
  );
  return (
    <figure
      aria-label="本文画像"
      data-reader-position-kind="figure"
      data-source-start={String(figure.sourceOffset)}
      data-source-end={String(figure.sourceEnd)}
      data-figure-index={String(figureIndex)}
      data-reader-text-figure={text ? "true" : undefined}
      className={text ? "article-figure" : "rsvp-figure"}
      onClick={(event) => {
        const target = event.target as HTMLButtonElement | null;
        if (target?.getAttribute?.("data-reader-image-surface") === "true" && target.disabled) handlers.toggleFigureBrightness?.(figureIndex);
      }}
      style={text
        ? { margin: "2em 0" }
        : { position: "absolute", inset: "52px 0 64px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "20px 16px 8px", boxSizing: "border-box" }}
    >
      {surface}
      <div
        data-reader-figure-status="true"
        role="status"
        aria-live="polite"
        hidden={!loadingVisible && !failed}
        style={{ display: loadingVisible || failed ? "flex" : "none", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.4" }}
      >
        {failed ? "画像を読み込めませんでした" : loading ? (
          <>
            画像を準備しています
            <span
              data-reader-figure-indicator="true"
              aria-hidden="true"
              style={{ width: "28px", height: "2px", borderRadius: "999px", background: "rgba(255,255,255,0.28)", display: "inline-block", overflow: "hidden" }}
            >
              <span style={{ display: "block", width: "100%", height: "100%", background: "rgba(255,255,255,0.84)" }} />
            </span>
          </>
        ) : null}
      </div>
      <div
        data-reader-figure-description="true"
        hidden={!loadingVisible && !failed}
        style={{ color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.45", textAlign: "center" }}
      >
        {figureDescription(figure)}
      </div>
      {figure.caption ? <figcaption hidden={loading || failed}>{figure.caption}</figcaption> : null}
    </figure>
  );
}

function LoadingView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "loading" }>; handlers: ReaderViewHandlers }): ReactElement {
  return (
    <div
      className={model.mobile ? "launch-feedback" : undefined}
      data-reader-loading="true"
      style={{ position: "absolute", inset: "0", pointerEvents: model.slow ? "auto" : "none" }}
    >
      <LoadingIndicator
        mobile={model.mobile === true}
        reducedMotion={model.reducedMotion}
        revealed={model.revealed !== false}
        animate={handlers.loadingAnimation}
      />
      {model.slow ? (
        <>
          <div
            className={model.mobile ? "launch-status" : undefined}
            data-reader-loading-label="true"
            role="status"
            style={{ position: "absolute", left: "50%", top: "calc(50% + 24px)", transform: "translateX(-50%)", color: "rgba(255,255,255,0.82)", fontSize: "14px", whiteSpace: "nowrap" }}
          >
            文章を準備しています
          </div>
          <button
            type="button"
            data-reader-loading-cancel="true"
            className={model.mobile ? "launch-cancel" : undefined}
            style={{ ...buttonStyle, position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)" }}
            onClick={handlers.cancel}
          >
            中止
          </button>
          <Button label="閉じる" onClick={handlers.close} extra={{ key: "close", position: "absolute", right: "24px", bottom: "24px" }} />
        </>
      ) : null}
    </div>
  );
}

function LoadingIndicator({ mobile, reducedMotion, revealed, animate }: { mobile: boolean; reducedMotion: boolean; revealed: boolean; animate?: ReaderViewHandlers["loadingAnimation"] }): ReactElement {
  const indicatorRef = useRef<HTMLElement | null>(null);
  const animationStartedRef = useRef(false);
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator || !revealed || reducedMotion || animationStartedRef.current || !animate) return undefined;
    animationStartedRef.current = true;
    return animate(indicator, reducedMotion);
  }, [animate, reducedMotion, revealed]);
  return (
    <div
      className={mobile ? "launch-loader" : undefined}
      data-reader-loading-bar="true"
      aria-hidden="true"
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(180px, calc(100% - 48px))", height: "2px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.18)", pointerEvents: "none", display: revealed ? "block" : "none", opacity: revealed ? "1" : "0" }}
    >
      <div
        className={mobile ? "launch-progress-track" : undefined}
        data-reader-loading-indicator="true"
        style={{ width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.18)" }}
      >
        <div
          className={mobile ? "launch-progress-indicator" : undefined}
          style={{ width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.82)", transform: reducedMotion ? "translateX(0) scaleX(.35)" : "translateX(-100%) scaleX(.35)", transformOrigin: "left center" }}
          ref={(element) => { indicatorRef.current = element; }}
        />
      </div>
    </div>
  );
}

function RewindFeedback({ feedback, reducedMotion, animate, onDone }: { feedback: ReaderRewindFeedback; reducedMotion: boolean; animate?: ReaderViewHandlers["rewindAnimation"]; onDone?(id: number): void }): ReactElement {
  const firstRingRef = useRef<HTMLElement | null>(null);
  const secondRingRef = useRef<HTMLElement | null>(null);
  const iconRef = useRef<SVGElement | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useLayoutEffect(() => {
    const firstRing = firstRingRef.current;
    const secondRing = secondRingRef.current;
    const icon = iconRef.current;
    if (!firstRing || !secondRing || !icon || !animate) return undefined;
    return animate({ firstRing, secondRing, icon }, reducedMotion, () => onDoneRef.current?.(feedback.id));
  }, [animate, feedback.id, reducedMotion]);
  return (
    <div className="rewind-feedback" aria-hidden="true" style={{ left: `${feedback.left}px`, top: `${feedback.top}px` }}>
      <span className="rewind-ring" ref={(element) => { firstRingRef.current = element; }} />
      <span className="rewind-ring" ref={(element) => { secondRingRef.current = element; }} />
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        ref={(element) => { iconRef.current = element; }}
      >
        <path d="M10.9 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
        <path d="M20.15 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
      </svg>
    </div>
  );
}

function ErrorView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "error" }>; handlers: ReaderViewHandlers }): ReactElement {
  const actions = (
    <>
      {model.canRetry ? <Button label="やり直す" onClick={handlers.retry} /> : null}
      <Button label="元に戻る" onClick={handlers.close} extra={{ "aria-label": "readerを閉じる" }} />
    </>
  );
  if (model.mobile) {
    return (
      <section className="reader" role="dialog" aria-label="reader" aria-modal="true" style={{ gridTemplateRows: "minmax(0, 1fr)" }}>
        <main className="content">
          <div className="error" data-reader-error="true">
            <div>{model.message}</div>
            <div className="error-actions">{actions}</div>
          </div>
        </main>
      </section>
    );
  }
  return (
    <div data-reader-error="true" style={{ position: "absolute", inset: "0" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "clamp(22px, 3vw, 34px)", fontWeight: "600", whiteSpace: "nowrap" }}>
        {model.message}
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)", display: "flex", gap: "10px" }}>
        {actions}
      </div>
    </div>
  );
}

function Minimap({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" }>; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.headings.length === 0) return null;
  return (
    <aside
      data-reader-minimap="true"
      aria-label="読書位置"
      style={{ position: "relative", width: "100%", maxHeight: "min(72vh, 640px)", boxSizing: "border-box", zIndex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column", gap: "16px", alignSelf: "center", padding: "14px 10px 10px", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "18px", background: "rgba(36,36,36,0.72)", boxShadow: "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)", backdropFilter: "blur(28px) saturate(150%)", WebkitBackdropFilter: "blur(28px) saturate(150%)", color: "rgba(255,255,255,0.62)" }}
    >
      <div style={{ fontSize: "13px" }}>記事の構成</div>
      <nav
        aria-label="記事の構成"
        style={{ minHeight: "0", overflow: "auto", display: "flex", flexDirection: "column", gap: "4px", padding: "2px 0", scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {model.headings.map((heading, index) => (
          <button
            key={`${index}-${heading.text}`}
            type="button"
            aria-current={index === model.activeHeadingIndex ? "location" : "false"}
            onClick={() => handlers.headingSelect?.(index)}
            style={{ ...buttonStyle, minHeight: "36px", padding: "4px 8px", paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px`, borderRadius: "8px", border: "0", boxShadow: "none", background: index === model.activeHeadingIndex ? "rgba(255,255,255,0.12)" : "transparent", textAlign: "left", fontSize: "13px", color: "inherit" }}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function blockTag(block: ReaderBlock): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "pre" | "p" {
  if (block.kind === "heading") return `h${Math.min(6, Math.max(1, block.level || 2))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  if (block.kind === "quote") return "blockquote";
  if (block.kind === "preformatted") return "pre";
  return "p";
}

function BlockView({ block, index }: { block: ReaderViewBlock; index: number }): ReactElement {
  const tag = blockTag(block);
  const Tag = tag;
  const children = block.sentenceSpans.length > 0
    ? block.sentenceSpans.map((sentence, sentenceIndex) => (
      <span
        key={`${sentence.start}-${sentenceIndex}`}
        className="text-sentence"
        data-reader-text-anchor="true"
        data-reader-position-kind="text"
        data-source-start={String(block.start + sentence.start)}
        data-source-end={String(block.start + sentence.end)}
      >
        {block.text.slice(sentence.start, sentence.end)}
      </span>
    ))
    : block.text;
  return (
    <Tag
      key={`${block.start}-${index}`}
      className={tag === "p" ? "paragraph" : tag === "h1" ? "article-title" : undefined}
      data-source-start={String(block.start)}
      data-source-end={String(block.end)}
    >
      {children}
    </Tag>
  );
}

function orderedTextChildren(model: Extract<ReaderViewModel, { kind: "text" }>, handlers: ReaderViewHandlers): ReactNode[] {
  const blocks = model.blocks.map((block, index) => ({ kind: "block" as const, offset: block.start, value: <BlockView key={`block-${block.start}-${index}`} block={block} index={index} /> }));
  const figures = model.figures.map((figure, figureIndex) => ({ kind: "figure" as const, offset: figure.sourceOffset, value: <Figure key={`figure-${figure.sourceOffset}-${figureIndex}`} figureView={{ figure, figureIndex, status: "ready", brightness: "dimmed" }} handlers={handlers} text /> }));
  return [...blocks, ...figures].sort((left, right) => left.offset - right.offset || (left.kind === "figure" ? -1 : 1)).map((entry) => entry.value);
}

function ReaderTextScroller({
  tagName,
  className,
  style,
  handlers,
  children,
}: {
  tagName: "main" | "div";
  className: string;
  style: CSSProperties;
  handlers: ReaderViewHandlers;
  children: ReactNode;
}): ReactElement {
  const textScrollHandler = useRef(handlers.textScroll);
  const textPositionHandler = useRef(handlers.textPosition);
  const elementRef = useRef<HTMLElement | null>(null);
  textScrollHandler.current = handlers.textScroll;
  textPositionHandler.current = handlers.textPosition;
  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    textScrollHandler.current(element);
    return () => textScrollHandler.current(null);
  }, []);
  const onScroll = useCallback((event: { currentTarget: EventTarget | null }) => {
    if (event.currentTarget) textPositionHandler.current(event.currentTarget as HTMLElement);
  }, []);
  const Tag = tagName;
  return (
    <Tag className={className} data-reader-text-scroller="true" ref={ref} onScroll={onScroll} style={style}>
      {children}
    </Tag>
  );
}

function DesktopRsvpView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" }>; handlers: ReaderViewHandlers }): ReactElement {
  const current = (
    <div
      data-reader-unit="true"
      data-reader-position-kind={model.figure ? "figure" : "text"}
      data-source-start={String(model.figure?.figure.sourceOffset ?? model.unit?.start ?? 0)}
      data-source-end={String(model.figure?.figure.sourceEnd ?? model.unit?.end ?? 0)}
      data-figure-index={model.figure ? String(model.figure.figureIndex) : undefined}
      aria-live="off"
      aria-atomic="false"
      style={model.figure
        ? { position: "absolute", inset: "0", width: "100%", height: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "visible" }
        : { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", height: "1.35em", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: "12px", fontSize: "clamp(36px, 4.5vw, 64px)", fontWeight: "600", lineHeight: "1.35", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", overflowWrap: "normal", wordBreak: "keep-all" }}
    >
      {model.figure ? <Figure figureView={model.figure} handlers={handlers} text={false} /> : model.unit?.text || ""}
    </div>
  );
  const transport = model.figure
    ? <Button label="続きを読む" onClick={handlers.resumeFigure} extra={{ key: "resume", minWidth: "88px" }} />
    : <IconButton label={model.playing ? "一時停止" : "再生"} onClick={handlers.togglePlayback} extra={{ fontSize: "20px", width: "56px", height: "56px", color: "rgba(245,245,247,0.66)" }} pressed={model.playing} />;
  return (
    <div
      data-reader-stage="true"
      className="rsvp-view"
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(980px, calc(100% - 48px))", height: "calc(100% - 48px)", display: "grid", gridTemplateColumns: model.headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: model.headings.length > 0 ? "32px" : "0", alignItems: "stretch" }}
    >
      <Minimap model={model} handlers={handlers} />
      <main style={{ position: "relative", minWidth: "0", height: "100%" }}>
        <div data-reader-topbar="true" style={{ position: "absolute", top: "8px", left: "0", right: "0", height: "44px", zIndex: "2", pointerEvents: "none", display: "flex", justifyContent: "space-between" }}>
          <Button label="文章で読む" onClick={handlers.switchToText} extra={{ pointerEvents: "auto", minWidth: "112px", "data-reader-mode-button": "true" }} />
          <Button label="閉じる" onClick={handlers.close} extra={{ pointerEvents: "auto", width: "44px", height: "44px", padding: "0", background: "transparent" }} />
        </div>
        <div data-reader-context-previous="true" aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {model.previous}
        </div>
        {current}
        <div data-reader-context-next="true" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {model.next}
        </div>
        <div style={{ position: "absolute", left: "50%", bottom: "8px", transform: "translateX(-50%)", width: "min(100%, 264px)", minHeight: "56px", display: "grid", gridTemplateColumns: "1fr 56px 1fr", alignItems: "center" }}>
          <IconButton label="1文戻る" onClick={handlers.previousSentence} extra={{ width: "52px", height: "52px", color: "rgba(245,245,247,0.66)" }} />
          {transport}
          <span />
        </div>
        <span data-reader-progress="true" style={{ position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
          {`${model.progress}%`}
        </span>
      </main>
      {model.loadingCover ? <LoadingIndicator mobile={false} reducedMotion={model.reducedMotion === true} revealed animate={handlers.loadingAnimation} /> : null}
    </div>
  );
}

function DesktopTextView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "text" }>; handlers: ReaderViewHandlers }): ReactElement {
  return (
    <div data-reader-text-shell="true" className="text-view" style={{ width: "min(900px, calc(100% - 32px))", height: "calc(100% - 32px)", margin: "16px auto", position: "relative", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "24px", background: "rgba(24,24,24,0.92)", overflow: "hidden" }}>
      <ReaderTextScroller tagName="main" className="text-view" handlers={handlers} style={{ width: "100%", height: "100%", overflowY: "auto", boxSizing: "border-box", padding: "72px clamp(24px, 7vw, 96px) 112px", scrollbarGutter: "stable" }}>
        <article className="article" style={{ maxWidth: "42rem", margin: "0 auto", color: "rgba(255,255,255,0.92)", fontSize: "clamp(17px, 1.7vw, 20px)", lineHeight: "1.9", letterSpacing: "0.01em" }}>
          {model.title ? <h1 className="article-title">{model.title}</h1> : null}
          {orderedTextChildren(model, handlers)}
        </article>
      </ReaderTextScroller>
      <div data-reader-topbar="true" style={{ position: "absolute", top: "8px", left: "16px", right: "16px", height: "44px", zIndex: "2", display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
        <Button label="RSVPで読む" onClick={handlers.switchToRsvp} extra={{ pointerEvents: "auto", "data-reader-mode-button": "true" }} />
        <Button label="閉じる" onClick={handlers.close} extra={{ pointerEvents: "auto" }} />
      </div>
      <span data-reader-progress="true" style={{ position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
        {`${model.progress}%`}
      </span>
    </div>
  );
}

function MobileRsvpView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" }>; handlers: ReaderViewHandlers }): ReactElement {
  const current = model.figure
    ? <Figure figureView={model.figure} handlers={handlers} text={false} />
    : <div className={`rsvp-unit ${model.unit?.kind || "body"}`} data-reader-unit="true" data-reader-position-kind="text" data-source-start={model.unit ? String(model.unit.start) : "0"} data-source-end={model.unit ? String(model.unit.end) : "0"} aria-live="off" aria-atomic="false">{model.unit?.text || ""}</div>;
  const playLabel = model.figure ? "続きを読む" : model.playing ? "一時停止" : "再生";
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true" onPointerUp={(event) => handlers.rsvpPointerUp?.(event.nativeEvent)}>
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}>×</button>
      </header>
      <footer className="controlbar">
        <button className="mode-button" type="button" data-reader-mode-button="true" onClick={handlers.switchToText}>文章で読む</button>
        <div className="progress">{`${model.progress}%`}</div>
        <div className="control-dock">
          <button className="dock-button previous" type="button" aria-label="1文戻る" aria-keyshortcuts="ArrowLeft" onClick={handlers.previousSentence}>1文戻る</button>
          <button className="dock-button play" type="button" aria-label={playLabel} aria-pressed={model.playing} aria-keyshortcuts="Space" onClick={model.figure ? handlers.resumeFigure : handlers.togglePlayback}>
            {model.figure ? "続きを読む" : model.playing ? "Ⅱ" : "▶"}
          </button>
        </div>
      </footer>
      <main className="content">
        <div className="rsvp-view">
          <div className="context-unit previous" aria-hidden="true">{model.previous}</div>
          {current}
          <div className="context-unit next" aria-hidden="true">{model.next}</div>
        </div>
        {model.rewindFeedback ? <RewindFeedback feedback={model.rewindFeedback} reducedMotion={model.reducedMotion === true} animate={handlers.rewindAnimation} onDone={handlers.rewindFeedbackDone} /> : null}
      </main>
    </section>
  );
}

function MobileTextView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "text" }>; handlers: ReaderViewHandlers }): ReactElement {
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true">
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}>×</button>
      </header>
      <footer className="controlbar">
        <button className="mode-button" type="button" data-reader-mode-button="true" onClick={handlers.switchToRsvp}>RSVPで読む</button>
        <div className="progress" data-reader-progress="true">{`${model.progress}%`}</div>
      </footer>
      <main className="content">
        <ReaderTextScroller tagName="div" className="text-view" handlers={handlers} style={{}}>
          <article className="article">
            {model.title ? <h1 className="article-title">{model.title}</h1> : null}
            {orderedTextChildren(model, handlers)}
          </article>
        </ReaderTextScroller>
      </main>
    </section>
  );
}

function MobileView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if (model.kind === "loading") return <LoadingView model={model} handlers={handlers} />;
  if (model.kind === "error") return <ErrorView model={model} handlers={handlers} />;
  if (model.kind === "rsvp") return <MobileRsvpView model={model} handlers={handlers} />;
  return <MobileTextView model={model} handlers={handlers} />;
}

export function ReaderView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if ("mobile" in model && model.mobile) return <MobileView model={model} handlers={handlers} />;
  switch (model.kind) {
    case "loading":
      return <LoadingView model={model} handlers={handlers} />;
    case "error":
      return <ErrorView model={model} handlers={handlers} />;
    case "rsvp":
      return <DesktopRsvpView model={model} handlers={handlers} />;
    case "text":
      return <DesktopTextView model={model} handlers={handlers} />;
  }
}
