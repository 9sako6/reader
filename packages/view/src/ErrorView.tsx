import type { ReactElement } from "react";
import { Button } from "./Button";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function ErrorView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "error" }>; handlers: ReaderViewHandlers }): ReactElement {
  const actions = (
    <>
      {model.canRetry ? <Button label="やり直す" onClick={handlers.retry} /> : null}
      <Button label="元に戻る" onClick={handlers.close} ariaLabel="readerを閉じる" />
    </>
  );
  if (model.mobile) {
    return (
      <section className="reader reader-error-mobile" role="dialog" aria-label="reader" aria-modal="true">
        <main className="content">
          <div className="error" data-reader-error="true">
            <div>{model.message}</div>
            <div className="error-actions">{actions}</div>
          </div>
        </main>
      </section>
    );
  }
  return (
    <div data-reader-error="true" className="reader-error">
      <div className="reader-error-message">
        {model.message}
      </div>
      <div className="reader-error-actions">
        {actions}
      </div>
    </div>
  );
}
