import type { ReactElement } from "react";
import { Button } from "./Button";
import { Figure } from "./Figure";
import { IconButton } from "./IconButton";
import { LoadingIndicator } from "./LoadingIndicator";
import { Minimap } from "./Minimap";
import { RsvpUnit, rsvpUnitStyle } from "./RsvpUnit";
import { orderedTextChildren } from "./TextContent";
import { ReaderTextScroller } from "./ReaderTextScroller";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function DesktopView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" | "text" }>; handlers: ReaderViewHandlers }): ReactElement {
  const rsvp = model.kind === "rsvp";
  const closeButton = (
    <Button
      label="閉じる"
      onClick={handlers.close}
      extra={{ pointerEvents: "auto", width: "52px", height: "52px", padding: "0", borderRadius: "18px", border: "0", background: "rgba(9,9,9,0.72)", color: "rgba(245,245,247,0.76)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", boxShadow: "none" }}
    />
  );
  const modeButton = (
    <Button
      label={rsvp ? "文章で読む" : "RSVPで読む"}
      onClick={rsvp ? handlers.switchToText : handlers.switchToRsvp}
      extra={{ pointerEvents: "auto", minWidth: "132px", minHeight: "46px", borderRadius: "15px", border: "0", background: "rgba(9,9,9,0.72)", color: "rgba(245,245,247,0.72)", fontWeight: "600", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", boxShadow: "none", "data-reader-mode-button": "true" }}
    />
  );
  return (
    <div
      data-reader-stage={rsvp ? "true" : undefined}
      data-reader-text-shell={rsvp ? undefined : "true"}
      className={rsvp ? "rsvp-view" : "text-view"}
      style={rsvp
        ? { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(980px, calc(100% - 48px))", height: "calc(100% - 48px)", display: "grid", gridTemplateColumns: model.headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", columnGap: model.headings.length > 0 ? "32px" : "0", alignItems: "stretch" }
        : { width: "100%", height: "100%", margin: "0", position: "relative", boxSizing: "border-box", border: "0", borderRadius: "0", background: "transparent", overflow: "hidden" }}
    >
      {rsvp ? (
        <>
          <Minimap model={model} handlers={handlers} />
          <main data-reader-reading-pane="true" style={{ position: "relative", minWidth: "0", height: "100%" }}>
            <div data-reader-topbar="true" style={{ position: "absolute", top: "8px", right: "0", zIndex: "4", pointerEvents: "none" }}>
              {closeButton}
            </div>
            <div data-reader-context-previous="true" aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {model.previous}
            </div>
            <div
                data-reader-unit="true"
                data-reader-unit-kind={model.figure ? undefined : model.unit?.kind || "body"}
                data-reader-position-kind={model.figure ? "figure" : "text"}
                data-source-start={String(model.figure?.figure.sourceOffset ?? model.unit?.start ?? 0)}
                data-source-end={String(model.figure?.figure.sourceEnd ?? model.unit?.end ?? 0)}
                data-figure-index={model.figure ? String(model.figure.figureIndex) : undefined}
                aria-live="off"
                aria-atomic="false"
                style={model.figure
                  ? { position: "absolute", inset: "0", width: "100%", height: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "visible" }
                  : model.unit?.kind === "code"
                    ? { ...rsvpUnitStyle, height: "auto", overflow: "visible", fontSize: "inherit" }
                    : rsvpUnitStyle}
              >
                {model.figure ? <Figure figureView={model.figure} handlers={handlers} text={false} /> : <RsvpUnit unit={model.unit} />}
            </div>
            <div data-reader-context-next="true" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "calc(50% + 82px)", transform: "translateX(-50%)", width: "min(100%, 640px)", maxWidth: "calc(100% - 32px)", color: "rgba(255,255,255,0.26)", fontSize: "clamp(16px, 1.5vw, 20px)", lineHeight: "1.4", textAlign: "center", opacity: "0.26", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "2", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {model.next}
            </div>
            <footer data-reader-controlbar="true" style={{ position: "absolute", zIndex: "4", left: "0", right: "0", bottom: "0", height: "146px", pointerEvents: "none" }}>
              <div data-reader-control-dock="true" style={{ position: "absolute", left: "50%", bottom: "54px", transform: "translateX(-50%)", width: "min(100% - 32px, 260px)", minHeight: "72px", display: "grid", gridTemplateColumns: "1fr 64px 1fr", alignItems: "center", padding: "4px 10px", border: "0", borderRadius: "24px", background: "transparent", boxShadow: "none", pointerEvents: "auto" }}>
                <IconButton label="1文戻る" onClick={handlers.previousSentence} iconSize={38} extra={{ width: "60px", height: "60px", color: "rgba(245,245,247,0.68)", background: "rgba(9,9,9,0.72)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", justifySelf: "center" }} />
                <IconButton label={model.figure ? "続きを読む" : model.playing ? "一時停止" : "再生"} onClick={model.figure ? handlers.resumeFigure : handlers.togglePlayback} iconSize={model.playing && !model.figure ? 34 : 38} extra={{ width: "64px", height: "64px", color: "rgba(245,245,247,0.82)", background: "rgba(9,9,9,0.72)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", justifySelf: "center" }} pressed={model.figure ? undefined : model.playing} />
                <span aria-hidden="true" />
              </div>
              <div style={{ position: "absolute", left: "50%", bottom: "2px", transform: "translateX(-50%)", pointerEvents: "auto" }}>{modeButton}</div>
              <span data-reader-progress="true" style={{ position: "absolute", right: "16px", bottom: "17px", color: "rgba(235,235,235,0.50)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
                {`${model.progress}%`}
              </span>
            </footer>
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
          <div data-reader-topbar="true" style={{ position: "absolute", top: "12px", right: "16px", zIndex: "4", pointerEvents: "none" }}>
            {closeButton}
          </div>
          <div style={{ position: "absolute", zIndex: "4", left: "50%", bottom: "10px", transform: "translateX(-50%)", pointerEvents: "auto" }}>
            {modeButton}
          </div>
          <span data-reader-progress="true" style={{ position: "absolute", right: "16px", bottom: "16px", zIndex: "3", color: "rgba(235,235,235,0.58)", fontSize: "13px", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
            {`${model.progress}%`}
          </span>
        </>
      )}
    </div>
  );
}
