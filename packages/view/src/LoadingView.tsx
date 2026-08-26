import type { ReactElement } from "react";
import { Button } from "./Button";
import { LoadingIndicator } from "./LoadingIndicator";
import type { LoadingScreen, ReaderViewHandlers, ReaderViewLayout } from "./types";

export function LoadingView({ layout, screen, handlers }: { layout: ReaderViewLayout; screen: LoadingScreen; handlers: ReaderViewHandlers }): ReactElement {
  const mobile = layout === "mobile";
  return (
    <div
      className={mobile ? "launch-feedback" : undefined}
      data-reader-loading="true"
      style={{ pointerEvents: screen.slow ? "auto" : "none" }}
    >
      <LoadingIndicator
        mobile={mobile}
        reducedMotion={screen.reducedMotion}
        revealed={screen.revealed}
        animate={handlers.loadingAnimation}
      />
      {screen.slow ? (
        <>
          <div
            className={mobile ? "launch-status" : undefined}
            data-reader-loading-label="true"
            role="status"
          >
            文章を準備しています
          </div>
          <button
            type="button"
            data-reader-loading-cancel="true"
            className={`reader-button${mobile ? " launch-cancel" : ""}`}
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
