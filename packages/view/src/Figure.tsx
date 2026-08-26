import { useEffect, useState, type ReactElement } from "react";
import { figureDescription } from "./figure-description";
import { codeLanguageLabel, SyntaxHighlightedCode } from "./SyntaxHighlightedCode";
import type { ReaderFigureView, ReaderViewHandlers } from "./types";

export function Figure({ figureView, handlers, text }: { figureView: ReaderFigureView; handlers: ReaderViewHandlers; text: boolean }): ReactElement {
  const { figure, figureIndex, status } = figureView;
  const kind = figure.kind;
  const [textAssetFailed, setTextAssetFailed] = useState(false);
  const [textRevealed, setTextRevealed] = useState(true);
  useEffect(() => {
    setTextAssetFailed(false);
    setTextRevealed(true);
  }, [kind === "code" ? figure.code : figure.src]);
  const loading = status === "loading";
  const loadingVisible = status === "loading" && figureView.loadingVisible;
  const failed = status === "failed" || (text && textAssetFailed);
  const revealed = text ? textRevealed : status !== "failed" && figureView.brightness === "revealed";
  const loadToken = status === "loading" ? figureView.token : null;
  const codeFallback = kind === "code" || (kind === "mermaid" && (!figure.src || failed));
  const codeLanguage = kind === "code" ? figure.language.trim() : "";
  const label = kind === "code" ? "コードブロック" : kind === "mermaid" ? "Mermaid図" : "本文画像";
  const surfaceLabel = kind === "image" ? "画像" : label;
  const codeSurface = codeFallback ? (
    <div
      data-reader-code-surface="true"
      data-reader-highlighted-language={codeLanguage || undefined}
      className="reader-code-surface"
    >
      {codeLanguage ? (
        <span
          data-reader-code-language-label="true"
          className="reader-code-language"
        >
          {codeLanguageLabel(codeLanguage)}
        </span>
      ) : null}
      <pre
        data-reader-code-block="true"
        data-reader-mermaid-fallback={kind === "mermaid" ? "true" : undefined}
        tabIndex={0}
        className="reader-code-block"
      >
        {codeLanguage
          ? <SyntaxHighlightedCode code={figure.code} language={codeLanguage} />
          : <code>{figure.code || (kind === "mermaid" ? "Mermaid図を表示できませんでした" : "")}</code>}
      </pre>
    </div>
  ) : null;
  const imageSurface = !codeFallback && !failed ? (
    <button
      type="button"
      data-reader-image-surface="true"
      data-reader-ignore-gesture="true"
      aria-pressed={revealed}
      aria-label={revealed ? surfaceLabel + "を暗く表示" : surfaceLabel + "を明るく表示"}
      title={revealed ? surfaceLabel + "を暗く表示" : surfaceLabel + "を明るく表示"}
      hidden={loading || failed}
      disabled={loading || failed}
      aria-hidden={loading ? "true" : undefined}
      onClick={() => text ? setTextRevealed((value) => !value) : handlers.toggleFigureBrightness(figureIndex)}
      className="reader-image-surface"
      style={{ background: figure.backgroundColor || "#fff" }}
    >
      <img
        src={figure.src}
        srcSet={kind === "image" ? figure.srcset : undefined}
        sizes={kind === "image" ? figure.sizes : undefined}
        alt={figure.alt || figure.caption || label}
        width={kind === "image" ? figure.width : undefined}
        height={kind === "image" ? figure.height : undefined}
        decoding="async"
        loading={text ? "lazy" : undefined}
        data-reader-source={text ? figure.src : undefined}
        onLoad={text || loadToken === null ? undefined : () => handlers.figureLoad(figureIndex, loadToken)}
        onError={text ? () => setTextAssetFailed(true) : loadToken === null ? undefined : () => handlers.figureError(figureIndex, loadToken)}
        ref={(element) => {
          if (element && loadToken !== null) handlers.figureImage(element, figureIndex, loadToken);
        }}
      />
      <div
        data-reader-image-veil="true"
        className="reader-image-veil"
        style={{ opacity: revealed ? "0" : "1" }}
      />
    </button>
  ) : null;
  const showFailureStatus = failed && kind === "image";
  return (
    <figure
      aria-label={label}
      data-reader-position-kind="figure"
      data-reader-content-kind={kind}
      data-source-start={String(figure.sourceOffset)}
      data-source-end={String(figure.sourceEnd)}
      data-figure-index={String(figureIndex)}
      data-reader-text-figure={text ? "true" : undefined}
      className={text ? "article-figure" : "rsvp-figure"}
      onClick={(event) => {
        const target = event.target as HTMLButtonElement | null;
        if (target?.getAttribute?.("data-reader-image-surface") === "true" && target.disabled) handlers.toggleFigureBrightness(figureIndex);
      }}
    >
      {codeSurface || imageSurface}
      <div
        data-reader-figure-status="true"
        role="status"
        aria-live="polite"
        hidden={!loadingVisible && !showFailureStatus && !(failed && kind === "mermaid")}
        className="reader-figure-status"
        style={{ display: loadingVisible || showFailureStatus || (failed && kind === "mermaid") ? "flex" : "none" }}
      >
        {failed && kind === "mermaid" ? "Mermaid図を表示できなかったため、元のコードを表示しています" : showFailureStatus ? "画像を読み込めませんでした" : loading ? (
          <>
            {kind === "mermaid" ? "Mermaid図を準備しています" : "画像を準備しています"}
            <span
              data-reader-figure-indicator="true"
              aria-hidden="true"
              className="reader-figure-indicator"
            >
              <span />
            </span>
          </>
        ) : null}
      </div>
      {kind === "image" ? (
        <div
          data-reader-figure-description="true"
          hidden={!loadingVisible && !showFailureStatus}
          className="reader-figure-description"
        >
          {figureDescription(figure)}
        </div>
      ) : null}
      {figure.caption ? <figcaption hidden={loading || showFailureStatus}>{figure.caption}</figcaption> : null}
    </figure>
  );
}
