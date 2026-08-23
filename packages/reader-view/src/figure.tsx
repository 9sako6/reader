import type { ReactElement } from "react";
import { figureDescription } from "./figure-description";
import type { ReaderFigureView, ReaderViewHandlers } from "./types";

export function Figure({ figureView, handlers, text }: { figureView: ReaderFigureView; handlers: ReaderViewHandlers; text: boolean }): ReactElement {
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
