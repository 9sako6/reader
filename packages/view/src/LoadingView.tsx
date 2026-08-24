import type { ReactElement } from "react";
import { Button } from "./Button";
import { LoadingIndicator } from "./LoadingIndicator";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function LoadingView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "loading" }>; handlers: ReaderViewHandlers }): ReactElement {
  return (
    <div
      className={model.mobile ? "launch-feedback" : undefined}
      data-reader-loading="true"
      style={{ pointerEvents: model.slow ? "auto" : "none" }}
    >
      <LoadingIndicator
        mobile={model.mobile === true}
        reducedMotion={model.reducedMotion}
        revealed={model.revealed !== false}
        animate={handlers.loadingAnimation}
      />
      {model.slow ? (
        <>
          <div
            className={model.mobile ? "launch-status" : undefined}
            data-reader-loading-label="true"
            role="status"
          >
            文章を準備しています
          </div>
          <button
            type="button"
            data-reader-loading-cancel="true"
            className={`reader-button${model.mobile ? " launch-cancel" : ""}`}
            onClick={handlers.cancel}
          >
            中止
          </button>
          <Button label="閉じる" onClick={handlers.close} className="reader-loading-close" />
        </>
      ) : null}
    </div>
  );
}
