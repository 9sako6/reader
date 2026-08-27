import type { ReactElement } from "react";
import { Button } from "./Button";
import { Figure } from "./Figure";
import { IconButton } from "./IconButton";
import { LoadingIndicator } from "./LoadingIndicator";
import { Minimap } from "./Minimap";
import { ModeSelector } from "./ModeSelector";
import { orderedPageChildren } from "./PageContent";
import { PageScroller } from "./PageScroller";
import { SpotText } from "./SpotText";
import type { DesktopReaderViewHandlers, ReaderScreen } from "./types";

type DesktopScreen = Extract<ReaderScreen, { kind: "spot" | "spot-figure" | "page" }>;

export function DesktopView({ screen, handlers }: { screen: DesktopScreen; handlers: DesktopReaderViewHandlers }): ReactElement {
  const spots = screen.kind !== "page";
  const spotScreen = screen.kind === "spot" ? screen : null;
  const figureScreen = screen.kind === "spot-figure" ? screen : null;
  const closeButton = (
    <Button
      label="閉じる"
      onClick={handlers.close}
      variant="close"
    />
  );
  return (
    <div
      data-reader-desktop-root="true"
      data-reader-page-shell={spots ? undefined : "true"}
      className={spots ? "spots-view" : "page-view"}
    >
      <div data-reader-stage="true">
        <Minimap headings={screen.headings} activeHeadingIndex={screen.activeHeadingIndex} handlers={handlers} />
        <main data-reader-reading-pane="true">
          <div data-reader-topbar="true" className="reader-desktop-topbar">
            {closeButton}
          </div>
          {spots ? (
            <>
              <div data-reader-context-previous="true" aria-hidden="true">
                {spotScreen?.previous || ""}
              </div>
              <div
                data-reader-spot="true"
                data-reader-spot-kind={spotScreen?.spot.kind}
                data-reader-position-kind={figureScreen ? "figure" : "text"}
                data-source-start={String(figureScreen?.figure.figure.sourceOffset ?? spotScreen?.spot.start ?? 0)}
                data-source-end={String(figureScreen?.figure.figure.sourceEnd ?? spotScreen?.spot.end ?? 0)}
                data-figure-index={figureScreen ? String(figureScreen.figure.figureIndex) : undefined}
                aria-live="off"
                aria-atomic="false"
                className={`reader-spot${figureScreen ? " reader-spot-figure" : spotScreen?.spot.kind === "code" ? " reader-spot-code" : ""}`}
              >
                {figureScreen ? <Figure figureView={figureScreen.figure} handlers={handlers} page={false} /> : <SpotText spot={spotScreen!.spot} />}
              </div>
              <div data-reader-context-next="true" aria-hidden="true">
                {spotScreen?.next || ""}
              </div>
              <footer data-reader-controlbar="true">
                <div data-reader-control-dock="true">
                  <IconButton label="1文戻る" onClick={handlers.previousSentence} iconSize={38} variant="previous" />
                  <IconButton label={figureScreen ? "続きを読む" : spotScreen?.playback === "playing" ? "一時停止" : "再生"} onClick={figureScreen ? handlers.resumeFigure : handlers.togglePlayback} iconSize={spotScreen?.playback === "playing" ? 34 : 38} variant="play" pressed={figureScreen ? undefined : spotScreen?.playback === "playing"} />
                  <span aria-hidden="true" />
                </div>
              </footer>
            </>
          ) : (
            <PageScroller tagName="div" className="page-view reader-page-scroller" handlers={handlers}>
              <article className="article reader-article">
                {screen.title ? <h1 className="article-title">{screen.title}</h1> : null}
                {orderedPageChildren(screen, handlers)}
              </article>
            </PageScroller>
          )}
          <div className={spots ? "reader-mode-position reader-mode-position-spots" : "reader-mode-position reader-mode-position-page"}>
            <ModeSelector
              spots={spots}
              switchToSpots={handlers.switchToSpots}
              switchToPage={handlers.switchToPage}
              layout="desktop"
            />
          </div>
          <span data-reader-progress="true" className={spots ? "reader-progress reader-progress-spots" : "reader-progress reader-progress-page"}>
            {`${screen.progress}%`}
          </span>
        </main>
        {spots && screen.loadingCover ? <LoadingIndicator mobile={false} reducedMotion={screen.reducedMotion} revealed animate={handlers.loadingAnimation} /> : null}
      </div>
    </div>
  );
}
