import { useDeferredValue, useEffect, useMemo, useRef, type ReactElement } from "react";
import { ErrorView } from "./ErrorView";
import { Figure } from "./Figure";
import { LoadingView } from "./LoadingView";
import { ModeSelector } from "./ModeSelector";
import { ReaderIcon } from "./ReaderIcon";
import { orderedPageChildren } from "./PageContent";
import { PageScroller } from "./PageScroller";
import { RewindFeedback } from "./RewindFeedback";
import { SpotText } from "./SpotText";
import type { MobileReaderViewHandlers, ReaderScreen } from "./types";

function MobileContext({ position, text, reducedMotion }: { position: "previous" | "next"; text: string; reducedMotion: boolean }): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!text || reducedMotion) return;
    element.current?.animate?.(
      [{ opacity: 0.12 }, { opacity: 0.26 }],
      { duration: 120, easing: "ease-out" },
    );
  }, [text, reducedMotion]);
  return <div ref={element} className={`context-unit ${position}`} aria-hidden="true">{text}</div>;
}

export function MobileView({ screen, handlers }: { screen: ReaderScreen; handlers: MobileReaderViewHandlers }): ReactElement {
  const deferredScreen = useDeferredValue(screen);
  const cachedPageScreen = useRef<Extract<ReaderScreen, { kind: "page" }> | null>(null);
  if (deferredScreen.kind === "page") cachedPageScreen.current = deferredScreen;
  const pageScreen = cachedPageScreen.current;
  const pageChildren = useMemo(
    () => pageScreen ? orderedPageChildren(pageScreen, handlers) : [],
    [pageScreen?.blocks, pageScreen?.figures, pageScreen?.title],
  );
  if (screen.kind === "loading") return <LoadingView layout="mobile" screen={screen} handlers={handlers} />;
  if (screen.kind === "error") return <ErrorView layout="mobile" screen={screen} handlers={handlers} />;
  const spots = screen.kind !== "page";
  const pageVisible = !spots && deferredScreen.kind === "page";
  const spotScreen = screen.kind === "spot" ? screen : null;
  const figureScreen = screen.kind === "spot-figure" ? screen : null;
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true" onPointerUp={spots ? (event) => handlers.spotsPointerUp(event.nativeEvent) : undefined}>
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}><ReaderIcon name="close" size={24} /></button>
      </header>
      <footer className="controlbar">
        <ModeSelector
          spots={spots}
          switchToSpots={handlers.switchToSpots}
          switchToPage={handlers.switchToPage}
          layout="mobile"
        />
        <div className="progress" data-reader-progress={spots ? undefined : "true"}>{`${screen.progress}%`}</div>
        {spots ? (
          <div className="control-dock" hidden={!screen.controlsVisible}>
            <button className="dock-button previous" type="button" aria-label="1文戻る" aria-keyshortcuts="ArrowLeft" onClick={handlers.previousSentence}><ReaderIcon name="previous" size={34} /></button>
            <button className="dock-button play" type="button" aria-label={figureScreen ? "続きを読む" : spotScreen?.playback === "playing" ? "一時停止" : "再生"} aria-pressed={figureScreen ? undefined : spotScreen?.playback === "playing"} aria-keyshortcuts="Space" onClick={figureScreen ? handlers.resumeFigure : handlers.togglePlayback}>
              <ReaderIcon name={spotScreen?.playback === "playing" ? "pause" : "play"} size={spotScreen?.playback === "playing" ? 30 : 34} />
            </button>
          </div>
        ) : null}
      </footer>
      <main className="content">
        {spots ? (
          <>
            <div className="spots-view">
              <div className="focus-area">
                <MobileContext position="previous" text={spotScreen?.previous || ""} reducedMotion={screen.reducedMotion} />
                {figureScreen
                  ? <Figure figureView={figureScreen.figure} handlers={handlers} page={false} />
                  : <div className={`spot ${spotScreen!.spot.kind}`} data-reader-spot="true" data-reader-position-kind="text" data-source-start={String(spotScreen!.spot.start)} data-source-end={String(spotScreen!.spot.end)} aria-live="off" aria-atomic="false">
                    <SpotText spot={spotScreen!.spot} />
                  </div>}
                <MobileContext position="next" text={spotScreen?.next || ""} reducedMotion={screen.reducedMotion} />
              </div>
            </div>
            {screen.rewindFeedback ? <RewindFeedback key={`rewind-${screen.rewindFeedback.id}`} feedback={screen.rewindFeedback} reducedMotion={screen.reducedMotion} animate={handlers.rewindAnimation} onDone={handlers.rewindFeedbackDone} /> : null}
          </>
        ) : null}
        {!spots && !pageVisible ? <div className="page-view" data-reader-page-pending="true" /> : null}
        {pageScreen ? (
          <PageScroller tagName="div" className="page-view" handlers={handlers} hidden={!pageVisible}>
            <article className="article">
              {pageScreen.title ? <h1 className="article-title">{pageScreen.title}</h1> : null}
              {pageChildren}
            </article>
          </PageScroller>
        ) : null}
      </main>
    </section>
  );
}
