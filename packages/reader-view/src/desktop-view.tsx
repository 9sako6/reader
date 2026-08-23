import type { ReactElement } from "react";
import { Button } from "./button";
import { Figure } from "./figure";
import { IconButton } from "./icon-button";
import { LoadingIndicator } from "./loading-indicator";
import { Minimap } from "./minimap";
import { orderedTextChildren } from "./text-content";
import { ReaderTextScroller } from "./reader-text-scroller";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function DesktopView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" | "text" }>; handlers: ReaderViewHandlers }): ReactElement {
  const rsvp = model.kind === "rsvp";
  return (
    <div
      data-reader-stage={rsvp ? "true" : undefined}
      data-reader-text-shell={rsvp ? undefined : "true"}
      className={rsvp ? "rsvp-view" : "text-view"}
      style={rsvp
        ? { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(980px, calc(100% - 48px))", height: "calc(100% - 48px)", display: "grid", gridTemplateColumns: model.headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: model.headings.length > 0 ? "32px" : "0", alignItems: "stretch" }
        : { width: "min(900px, calc(100% - 32px))", height: "calc(100% - 32px)", margin: "16px auto", position: "relative", boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "24px", background: "rgba(24,24,24,0.92)", overflow: "hidden" }}
    >
      {rsvp ? (
        <>
          <Minimap model={model} handlers={handlers} />
          <main style={{ position: "relative", minWidth: "0", height: "100%" }}>
            <div data-reader-topbar="true" style={{ position: "absolute", top: "8px", left: "0", right: "0", height: "44px", zIndex: "2", pointerEvents: "none", display: "flex", justifyContent: "space-between" }}>
              <Button label="文章で読む" onClick={handlers.switchToText} extra={{ pointerEvents: "auto", minWidth: "112px", "data-reader-mode-button": "true" }} />
              <Button label="閉じる" onClick={handlers.close} extra={{ pointerEvents: "auto", width: "44px", height: "44px", padding: "0", background: "transparent" }} />
            </div>
            <div data-reader-context-previous="true" aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {model.previous}
            </div>
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
            <div data-reader-context-next="true" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {model.next}
            </div>
            <div style={{ position: "absolute", left: "50%", bottom: "8px", transform: "translateX(-50%)", width: "min(100%, 264px)", minHeight: "56px", display: "grid", gridTemplateColumns: "1fr 56px 1fr", alignItems: "center" }}>
              <IconButton label="1文戻る" onClick={handlers.previousSentence} extra={{ width: "52px", height: "52px", color: "rgba(245,245,247,0.66)" }} />
              {model.figure
                ? <Button label="続きを読む" onClick={handlers.resumeFigure} extra={{ key: "resume", minWidth: "88px" }} />
                : <IconButton label={model.playing ? "一時停止" : "再生"} onClick={handlers.togglePlayback} extra={{ fontSize: "20px", width: "56px", height: "56px", color: "rgba(245,245,247,0.66)" }} pressed={model.playing} />}
              <span />
            </div>
            <span data-reader-progress="true" style={{ position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
              {`${model.progress}%`}
            </span>
          </main>
          {model.loadingCover ? <LoadingIndicator mobile={false} reducedMotion={model.reducedMotion === true} revealed animate={handlers.loadingAnimation} /> : null}
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
