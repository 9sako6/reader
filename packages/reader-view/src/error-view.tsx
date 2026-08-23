import type { ReactElement } from "react";
import { Button } from "./button";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function ErrorView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "error" }>; handlers: ReaderViewHandlers }): ReactElement {
  const actions = (
    <>
      {model.canRetry ? <Button label="やり直す" onClick={handlers.retry} /> : null}
      <Button label="元に戻る" onClick={handlers.close} extra={{ "aria-label": "readerを閉じる" }} />
    </>
  );
  if (model.mobile) {
    return (
      <section className="reader" role="dialog" aria-label="reader" aria-modal="true" style={{ gridTemplateRows: "minmax(0, 1fr)" }}>
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
    <div data-reader-error="true" style={{ position: "absolute", inset: "0" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "clamp(22px, 3vw, 34px)", fontWeight: "600", whiteSpace: "nowrap" }}>
        {model.message}
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)", display: "flex", gap: "10px" }}>
        {actions}
      </div>
    </div>
  );
}
