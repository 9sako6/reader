import type { ReactElement } from "react";
import { Button } from "./Button";
import type { ErrorScreen, ReaderViewHandlers, ReaderViewLayout } from "./types";

export function ErrorView({ layout, screen, handlers }: { layout: ReaderViewLayout; screen: ErrorScreen; handlers: ReaderViewHandlers }): ReactElement {
  const actions = (
    <>
      <Button label="やり直す" onClick={handlers.retry} />
      <Button label="元に戻る" onClick={handlers.close} ariaLabel="readerを閉じる" />
    </>
  );
  if (layout === "mobile") {
    return (
      <section className="reader reader-error-mobile" role="dialog" aria-label="reader" aria-modal="true">
        <main className="content">
          <div className="error" data-reader-error="true">
            <div>{screen.message}</div>
            <div className="error-actions">{actions}</div>
          </div>
        </main>
      </section>
    );
  }
  return (
    <div data-reader-error="true" className="reader-error">
      <div className="reader-error-message">
        {screen.message}
      </div>
      <div className="reader-error-actions">
        {actions}
      </div>
    </div>
  );
}
