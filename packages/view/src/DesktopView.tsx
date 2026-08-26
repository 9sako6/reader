import type { ReactElement } from "react";
import { Button } from "./Button";
import { Figure } from "./Figure";
import { IconButton } from "./IconButton";
import { LoadingIndicator } from "./LoadingIndicator";
import { Minimap } from "./Minimap";
import { RsvpUnit } from "./RsvpUnit";
import { orderedTextChildren } from "./TextContent";
import { ReaderTextScroller } from "./ReaderTextScroller";
import type { DesktopReaderViewHandlers, ReaderScreen } from "./types";

type DesktopScreen = Extract<ReaderScreen, { kind: "rsvp-unit" | "rsvp-figure" | "text" }>;

export function DesktopView({ screen, handlers }: { screen: DesktopScreen; handlers: DesktopReaderViewHandlers }): ReactElement {
  const rsvp = screen.kind !== "text";
  const unitScreen = screen.kind === "rsvp-unit" ? screen : null;
  const figureScreen = screen.kind === "rsvp-figure" ? screen : null;
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
        <Minimap headings={screen.headings} activeHeadingIndex={screen.activeHeadingIndex} handlers={handlers} />
        <main data-reader-reading-pane="true">
          <div data-reader-topbar="true" className="reader-desktop-topbar">
            {closeButton}
          </div>
          {rsvp ? (
            <>
              <div data-reader-context-previous="true" aria-hidden="true">
                {unitScreen?.previous || ""}
              </div>
              <div
                data-reader-unit="true"
                data-reader-unit-kind={unitScreen?.unit.kind}
                data-reader-position-kind={figureScreen ? "figure" : "text"}
                data-source-start={String(figureScreen?.figure.figure.sourceOffset ?? unitScreen?.unit.start ?? 0)}
                data-source-end={String(figureScreen?.figure.figure.sourceEnd ?? unitScreen?.unit.end ?? 0)}
                data-figure-index={figureScreen ? String(figureScreen.figure.figureIndex) : undefined}
                aria-live="off"
                aria-atomic="false"
                className={`reader-unit${figureScreen ? " reader-unit-figure" : unitScreen?.unit.kind === "code" ? " reader-unit-code" : ""}`}
              >
                {figureScreen ? <Figure figureView={figureScreen.figure} handlers={handlers} text={false} /> : <RsvpUnit unit={unitScreen!.unit} />}
              </div>
              <div data-reader-context-next="true" aria-hidden="true">
                {unitScreen?.next || ""}
              </div>
              <footer data-reader-controlbar="true">
                <div data-reader-control-dock="true">
                  <IconButton label="1文戻る" onClick={handlers.previousSentence} iconSize={38} variant="previous" />
                  <IconButton label={figureScreen ? "続きを読む" : unitScreen?.playback === "playing" ? "一時停止" : "再生"} onClick={figureScreen ? handlers.resumeFigure : handlers.togglePlayback} iconSize={unitScreen?.playback === "playing" ? 34 : 38} variant="play" pressed={figureScreen ? undefined : unitScreen?.playback === "playing"} />
                  <span aria-hidden="true" />
                </div>
              </footer>
            </>
          ) : (
            <ReaderTextScroller tagName="div" className="text-view reader-text-scroller" handlers={handlers}>
              <article className="article reader-article">
                {screen.title ? <h1 className="article-title">{screen.title}</h1> : null}
                {orderedTextChildren(screen, handlers)}
              </article>
            </ReaderTextScroller>
          )}
          <div className={rsvp ? "reader-mode-position reader-mode-position-rsvp" : "reader-mode-position reader-mode-position-text"}>
            {modeButton}
          </div>
          <span data-reader-progress="true" className={rsvp ? "reader-progress reader-progress-rsvp" : "reader-progress reader-progress-text"}>
            {`${screen.progress}%`}
          </span>
        </main>
        {rsvp && screen.loadingCover ? <LoadingIndicator mobile={false} reducedMotion={screen.reducedMotion} revealed animate={handlers.loadingAnimation} /> : null}
      </div>
    </div>
  );
}
