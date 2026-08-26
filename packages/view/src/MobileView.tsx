import { useEffect, useRef, type ReactElement } from "react";
import { ErrorView } from "./ErrorView";
import { Figure } from "./Figure";
import { LoadingView } from "./LoadingView";
import { ReaderIcon } from "./ReaderIcon";
import { ReaderTextScroller } from "./ReaderTextScroller";
import { RewindFeedback } from "./RewindFeedback";
import { RsvpUnit } from "./RsvpUnit";
import { orderedTextChildren } from "./TextContent";
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
  if (screen.kind === "loading") return <LoadingView layout="mobile" screen={screen} handlers={handlers} />;
  if (screen.kind === "error") return <ErrorView layout="mobile" screen={screen} handlers={handlers} />;
  const rsvp = screen.kind !== "text";
  const unitScreen = screen.kind === "rsvp-unit" ? screen : null;
  const figureScreen = screen.kind === "rsvp-figure" ? screen : null;
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true" onPointerUp={rsvp ? (event) => handlers.rsvpPointerUp(event.nativeEvent) : undefined}>
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}><ReaderIcon name="close" size={24} /></button>
      </header>
      <footer className="controlbar">
        <button className="mode-button" type="button" data-reader-mode-button="true" onClick={rsvp ? handlers.switchToText : handlers.switchToRsvp}>{rsvp ? "文章で読む" : "RSVPで読む"}</button>
        <div className="progress" data-reader-progress={rsvp ? undefined : "true"}>{`${screen.progress}%`}</div>
        {rsvp ? (
          <div className="control-dock" hidden={!screen.controlsVisible}>
            <button className="dock-button previous" type="button" aria-label="1文戻る" aria-keyshortcuts="ArrowLeft" onClick={handlers.previousSentence}><ReaderIcon name="previous" size={34} /></button>
            <button className="dock-button play" type="button" aria-label={figureScreen ? "続きを読む" : unitScreen?.playback === "playing" ? "一時停止" : "再生"} aria-pressed={figureScreen ? undefined : unitScreen?.playback === "playing"} aria-keyshortcuts="Space" onClick={figureScreen ? handlers.resumeFigure : handlers.togglePlayback}>
              <ReaderIcon name={unitScreen?.playback === "playing" ? "pause" : "play"} size={unitScreen?.playback === "playing" ? 30 : 34} />
            </button>
          </div>
        ) : null}
      </footer>
      <main className="content">
        {rsvp ? (
          <>
            <div className="rsvp-view">
              <div className="focus-area">
                <MobileContext position="previous" text={unitScreen?.previous || ""} reducedMotion={screen.reducedMotion} />
                {figureScreen
                  ? <Figure figureView={figureScreen.figure} handlers={handlers} text={false} />
                  : <div className={`rsvp-unit ${unitScreen!.frame.kind}`} data-reader-unit="true" data-reader-position-kind="text" data-source-start={String(unitScreen!.frame.start)} data-source-end={String(unitScreen!.frame.end)} aria-live="off" aria-atomic="false">
                    <RsvpUnit frame={unitScreen!.frame} />
                  </div>}
                <MobileContext position="next" text={unitScreen?.next || ""} reducedMotion={screen.reducedMotion} />
              </div>
            </div>
            {screen.rewindFeedback ? <RewindFeedback key={`rewind-${screen.rewindFeedback.id}`} feedback={screen.rewindFeedback} reducedMotion={screen.reducedMotion} animate={handlers.rewindAnimation} onDone={handlers.rewindFeedbackDone} /> : null}
          </>
        ) : (
          <ReaderTextScroller tagName="div" className="text-view" handlers={handlers}>
            <article className="article">
              {screen.title ? <h1 className="article-title">{screen.title}</h1> : null}
              {orderedTextChildren(screen, handlers)}
            </article>
          </ReaderTextScroller>
        )}
      </main>
    </section>
  );
}
