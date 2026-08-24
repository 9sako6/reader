import { useEffect, useRef, type ReactElement } from "react";
import { ErrorView } from "./ErrorView";
import { Figure } from "./Figure";
import { LoadingView } from "./LoadingView";
import { ReaderIcon } from "./ReaderIcon";
import { ReaderTextScroller } from "./ReaderTextScroller";
import { RewindFeedback } from "./RewindFeedback";
import { orderedTextChildren } from "./TextContent";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

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

export function MobileView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if (model.kind === "loading") return <LoadingView model={model} handlers={handlers} />;
  if (model.kind === "error") return <ErrorView model={model} handlers={handlers} />;
  const rsvp = model.kind === "rsvp";
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true" onPointerUp={rsvp ? (event) => handlers.rsvpPointerUp?.(event.nativeEvent) : undefined}>
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}><ReaderIcon name="close" size={24} /></button>
      </header>
      <footer className="controlbar">
        <button className="mode-button" type="button" data-reader-mode-button="true" onClick={rsvp ? handlers.switchToText : handlers.switchToRsvp}>{rsvp ? "文章で読む" : "RSVPで読む"}</button>
        <div className="progress" data-reader-progress={rsvp ? undefined : "true"}>{`${model.progress}%`}</div>
        {rsvp ? (
          <div className="control-dock" hidden={model.controlsVisible === false}>
            <button className="dock-button previous" type="button" aria-label="1文戻る" aria-keyshortcuts="ArrowLeft" onClick={handlers.previousSentence}><ReaderIcon name="previous" size={34} /></button>
            <button className="dock-button play" type="button" aria-label={model.playing ? "一時停止" : "再生"} aria-pressed={model.playing} aria-keyshortcuts="Space" onClick={model.figure ? handlers.resumeFigure : handlers.togglePlayback}>
              <ReaderIcon name={model.playing ? "pause" : "play"} size={model.playing ? 30 : 34} />
            </button>
          </div>
        ) : null}
      </footer>
      <main className="content">
        {rsvp ? (
          <>
            <div className="rsvp-view">
              <div className="focus-area">
                <MobileContext position="previous" text={model.previous} reducedMotion={model.reducedMotion === true} />
                {model.figure
                  ? <Figure figureView={model.figure} handlers={handlers} text={false} />
                  : <div className={`rsvp-unit ${model.unit?.kind || "body"}`} data-reader-unit="true" data-reader-position-kind="text" data-source-start={model.unit ? String(model.unit.start) : "0"} data-source-end={model.unit ? String(model.unit.end) : "0"} aria-live="off" aria-atomic="false">
                    {model.unit?.kind === "code"
                      ? <code data-reader-inline-code="true" tabIndex={0}>{model.unit.text}</code>
                      : model.unit?.text || ""}
                  </div>}
                <MobileContext position="next" text={model.next} reducedMotion={model.reducedMotion === true} />
              </div>
            </div>
            {model.rewindFeedback ? <RewindFeedback key={`rewind-${model.rewindFeedback.id}`} feedback={model.rewindFeedback} reducedMotion={model.reducedMotion === true} animate={handlers.rewindAnimation} onDone={handlers.rewindFeedbackDone} /> : null}
          </>
        ) : (
          <ReaderTextScroller tagName="div" className="text-view" handlers={handlers}>
            <article className="article">
              {model.title ? <h1 className="article-title">{model.title}</h1> : null}
              {orderedTextChildren(model, handlers)}
            </article>
          </ReaderTextScroller>
        )}
      </main>
    </section>
  );
}
