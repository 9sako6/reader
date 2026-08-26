import type { ReactElement } from "react";
import { Button } from "./Button";
import { Figure } from "./Figure";
import { IconButton } from "./IconButton";
import { LoadingIndicator } from "./LoadingIndicator";
import { Minimap } from "./Minimap";
import { RsvpUnit } from "./RsvpUnit";
import { orderedTextChildren } from "./TextContent";
import { ReaderTextScroller } from "./ReaderTextScroller";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function DesktopView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" | "text" }>; handlers: ReaderViewHandlers }): ReactElement {
  const rsvp = model.kind === "rsvp";
  const headings = rsvp ? model.headings : model.headings || [];
  const activeHeadingIndex = rsvp ? model.activeHeadingIndex : model.activeHeadingIndex ?? -1;
  const closeButton = (
    <Button
      label="閉じる"
      onClick={handlers.close}
      variant="close"
    />
  );
  const modeButton = (
    <Button
      label={rsvp ? "文章で読む" : "RSVPで読む"}
      onClick={rsvp ? handlers.switchToText : handlers.switchToRsvp}
      variant="mode"
    />
  );
  return (
    <div
      data-reader-desktop-root="true"
      data-reader-text-shell={rsvp ? undefined : "true"}
      className={rsvp ? "rsvp-view" : "text-view"}
    >
      <div data-reader-stage="true">
        <Minimap headings={headings} activeHeadingIndex={activeHeadingIndex} handlers={handlers} />
        <main data-reader-reading-pane="true">
          <div data-reader-topbar="true" className="reader-desktop-topbar">
            {closeButton}
          </div>
          {rsvp ? (
            <>
              <div data-reader-context-previous="true" aria-hidden="true">
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
                className={`reader-unit${model.figure ? " reader-unit-figure" : model.unit?.kind === "code" ? " reader-unit-code" : ""}`}
              >
                {model.figure ? <Figure figureView={model.figure} handlers={handlers} text={false} /> : <RsvpUnit unit={model.unit} />}
              </div>
              <div data-reader-context-next="true" aria-hidden="true">
                {model.next}
              </div>
              <footer data-reader-controlbar="true">
                <div data-reader-control-dock="true">
                  <IconButton label="1文戻る" onClick={handlers.previousSentence} iconSize={38} variant="previous" />
                  <IconButton label={model.figure ? "続きを読む" : model.playing ? "一時停止" : "再生"} onClick={model.figure ? handlers.resumeFigure : handlers.togglePlayback} iconSize={model.playing && !model.figure ? 34 : 38} variant="play" pressed={model.figure ? undefined : model.playing} />
                  <span aria-hidden="true" />
                </div>
              </footer>
            </>
          ) : (
            <ReaderTextScroller tagName="div" className="text-view reader-text-scroller" handlers={handlers}>
              <article className="article reader-article">
                {model.title ? <h1 className="article-title">{model.title}</h1> : null}
                {orderedTextChildren(model, handlers)}
              </article>
            </ReaderTextScroller>
          )}
          <div className={rsvp ? "reader-mode-position reader-mode-position-rsvp" : "reader-mode-position reader-mode-position-text"}>
            {modeButton}
          </div>
          <span data-reader-progress="true" className={rsvp ? "reader-progress reader-progress-rsvp" : "reader-progress reader-progress-text"}>
            {`${model.progress}%`}
          </span>
        </main>
        {rsvp && model.loadingCover ? <LoadingIndicator mobile={false} reducedMotion={model.reducedMotion === true} revealed animate={handlers.loadingAnimation} /> : null}
      </div>
    </div>
  );
}
