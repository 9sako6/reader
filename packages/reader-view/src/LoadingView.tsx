import type { ReactElement } from "react";
import { Button } from "./Button";
import { LoadingIndicator } from "./LoadingIndicator";
import { buttonStyle } from "./styles";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function LoadingView({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "loading" }>; handlers: ReaderViewHandlers }): ReactElement {
  return (
    <div
      className={model.mobile ? "launch-feedback" : undefined}
      data-reader-loading="true"
      style={{ position: "absolute", inset: "0", pointerEvents: model.slow ? "auto" : "none" }}
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
            style={{ position: "absolute", left: "50%", top: "calc(50% + 24px)", transform: "translateX(-50%)", color: "rgba(255,255,255,0.82)", fontSize: "14px", whiteSpace: "nowrap" }}
          >
            文章を準備しています
          </div>
          <button
            type="button"
            data-reader-loading-cancel="true"
            className={model.mobile ? "launch-cancel" : undefined}
            style={{ ...buttonStyle, position: "absolute", left: "50%", bottom: "32px", transform: "translateX(-50%)" }}
            onClick={handlers.cancel}
          >
            中止
          </button>
          <Button label="閉じる" onClick={handlers.close} extra={{ key: "close", position: "absolute", right: "24px", bottom: "24px" }} />
        </>
      ) : null}
    </div>
  );
}
