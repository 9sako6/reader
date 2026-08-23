import type { ReactElement } from "react";
import { ErrorView } from "./error-view";
import { Figure } from "./figure";
import { LoadingView } from "./loading-view";
import { ReaderTextScroller } from "./reader-text-scroller";
import { RewindFeedback } from "./rewind-feedback";
import { orderedTextChildren } from "./text-content";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function MobileView({ model, handlers }: { model: ReaderViewModel; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.kind === "closed") return null;
  if (model.kind === "loading") return <LoadingView model={model} handlers={handlers} />;
  if (model.kind === "error") return <ErrorView model={model} handlers={handlers} />;
  const rsvp = model.kind === "rsvp";
  return (
    <section className="reader" role="dialog" aria-label="reader" aria-modal="true" onPointerUp={rsvp ? (event) => handlers.rsvpPointerUp?.(event.nativeEvent) : undefined}>
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="readerを閉じる" onClick={handlers.close}>×</button>
      </header>
      <footer className="controlbar">
        <button className="mode-button" type="button" data-reader-mode-button="true" onClick={rsvp ? handlers.switchToText : handlers.switchToRsvp}>{rsvp ? "文章で読む" : "RSVPで読む"}</button>
        <div className="progress" data-reader-progress={rsvp ? undefined : "true"}>{`${model.progress}%`}</div>
        {rsvp ? (
          <div className="control-dock">
            <button className="dock-button previous" type="button" aria-label="1文戻る" aria-keyshortcuts="ArrowLeft" onClick={handlers.previousSentence}>1文戻る</button>
            <button className="dock-button play" type="button" aria-label={model.figure ? "続きを読む" : model.playing ? "一時停止" : "再生"} aria-pressed={model.playing} aria-keyshortcuts="Space" onClick={model.figure ? handlers.resumeFigure : handlers.togglePlayback}>
              {model.figure ? "続きを読む" : model.playing ? "Ⅱ" : "▶"}
            </button>
          </div>
        ) : null}
      </footer>
      <main className="content">
        {rsvp ? (
          <>
            <div className="rsvp-view">
              <div className="context-unit previous" aria-hidden="true">{model.previous}</div>
              {model.figure
                ? <Figure figureView={model.figure} handlers={handlers} text={false} />
                : <div className={`rsvp-unit ${model.unit?.kind || "body"}`} data-reader-unit="true" data-reader-position-kind="text" data-source-start={model.unit ? String(model.unit.start) : "0"} data-source-end={model.unit ? String(model.unit.end) : "0"} aria-live="off" aria-atomic="false">{model.unit?.text || ""}</div>}
              <div className="context-unit next" aria-hidden="true">{model.next}</div>
            </div>
            {model.rewindFeedback ? <RewindFeedback key={`rewind-${model.rewindFeedback.id}`} feedback={model.rewindFeedback} reducedMotion={model.reducedMotion === true} animate={handlers.rewindAnimation} onDone={handlers.rewindFeedbackDone} /> : null}
          </>
        ) : (
          <ReaderTextScroller tagName="div" className="text-view" handlers={handlers} style={{}}>
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
