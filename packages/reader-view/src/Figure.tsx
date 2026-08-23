import { useEffect, useState, type ReactElement } from "react";
import { figureDescription } from "./figure-description";
import type { ReaderFigureView, ReaderViewHandlers } from "./types";

export function Figure({ figureView, handlers, text }: { figureView: ReaderFigureView; handlers: ReaderViewHandlers; text: boolean }): ReactElement {
  const { figure, figureIndex, status, token } = figureView;
  const kind = figure.kind || "image";
  const [textAssetFailed, setTextAssetFailed] = useState(false);
  useEffect(() => setTextAssetFailed(false), [figure.src]);
  const loading = status === "loading";
  const loadingVisible = figureView.loadingVisible === true;
  const failed = status === "failed" || (text && textAssetFailed);
  const revealed = figureView.brightness === "revealed";
  const codeFallback = kind === "code" || (kind === "mermaid" && (!figure.src || failed));
  const label = kind === "code" ? "コードブロック" : kind === "mermaid" ? "Mermaid図" : "本文画像";
  const surfaceLabel = kind === "image" ? "画像" : label;
  const codeSurface = codeFallback ? (
    <pre
      data-reader-code-block="true"
      data-reader-mermaid-fallback={kind === "mermaid" ? "true" : undefined}
      tabIndex={0}
      style={{
        width: "min(100%, 760px)",
        maxHeight: text ? "72vh" : "min(58vh, 600px)",
        margin: "0 auto",
        padding: text ? "18px" : "20px",
        overflow: "auto",
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: text ? "10px" : "12px",
        background: "rgba(255,255,255,0.055)",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: text ? "0.84em" : "clamp(13px, 1.8vw, 18px)",
        lineHeight: "1.55",
        textAlign: "left",
        whiteSpace: "pre",
      }}
    >
      <code>{figure.code || (kind === "mermaid" ? "Mermaid図を表示できませんでした" : "")}</code>
    </pre>
  ) : null;
  const imageSurface = !codeFallback && !failed ? (
    <button
      type="button"
      data-reader-image-surface="true"
      data-reader-ignore-gesture="true"
      aria-pressed={revealed}
      aria-label={revealed ? surfaceLabel + "を暗く表示" : surfaceLabel + "を明るく表示"}
      title={revealed ? surfaceLabel + "を暗く表示" : surfaceLabel + "を明るく表示"}
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
        alt={figure.alt || figure.caption || label}
        width={figure.width}
        height={figure.height}
        decoding="async"
        loading={text ? "lazy" : undefined}
        data-reader-source={text ? figure.src : undefined}
        onLoad={text ? undefined : () => handlers.figureLoad(figureIndex, token)}
        onError={text ? () => setTextAssetFailed(true) : () => handlers.figureError(figureIndex, token)}
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
  ) : null;
  const showFailureStatus = failed && kind === "image";
  return (
    <figure
      aria-label={label}
      data-reader-position-kind="figure"
      data-reader-content-kind={kind}
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
        : { position: "absolute", inset: "52px 0 64px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", margin: "0", padding: "20px 8px 8px", boxSizing: "border-box" }}
    >
      {codeSurface || imageSurface}
      <div
        data-reader-figure-status="true"
        role="status"
        aria-live="polite"
        hidden={!loadingVisible && !showFailureStatus && !(failed && kind === "mermaid")}
        style={{ display: loadingVisible || showFailureStatus || (failed && kind === "mermaid") ? "flex" : "none", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.4" }}
      >
        {failed && kind === "mermaid" ? "Mermaid図を表示できなかったため、元のコードを表示しています" : showFailureStatus ? "画像を読み込めませんでした" : loading ? (
          <>
            {kind === "mermaid" ? "Mermaid図を準備しています" : "画像を準備しています"}
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
      {kind === "image" ? (
        <div
          data-reader-figure-description="true"
          hidden={!loadingVisible && !showFailureStatus}
          style={{ color: "rgba(255,255,255,0.72)", fontSize: "14px", lineHeight: "1.45", textAlign: "center" }}
        >
          {figureDescription(figure)}
        </div>
      ) : null}
      {figure.caption ? <figcaption hidden={loading || showFailureStatus}>{figure.caption}</figcaption> : null}
    </figure>
  );
}
