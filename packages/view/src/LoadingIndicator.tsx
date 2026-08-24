import { useLayoutEffect, useRef, type ReactElement } from "react";
import type { ReaderViewHandlers } from "./types";

export function LoadingIndicator({ mobile, reducedMotion, revealed, animate }: { mobile: boolean; reducedMotion: boolean; revealed: boolean; animate?: ReaderViewHandlers["loadingAnimation"] }): ReactElement {
  const indicatorRef = useRef<HTMLElement | null>(null);
  const animationStartedRef = useRef(false);
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator || !revealed || reducedMotion || animationStartedRef.current || !animate) return undefined;
    animationStartedRef.current = true;
    return animate(indicator, reducedMotion);
  }, [animate, reducedMotion, revealed]);
  return (
    <div
      className={`reader-loading-bar${mobile ? " launch-loader" : ""}`}
      data-reader-loading-bar="true"
      aria-hidden="true"
      style={{ display: revealed ? "block" : "none", opacity: revealed ? "1" : "0" }}
    >
      <div
        className={`reader-loading-track${mobile ? " launch-progress-track" : ""}`}
        data-reader-loading-indicator="true"
      >
        <div
          className={`reader-loading-indicator${mobile ? " launch-progress-indicator" : ""}`}
          style={{ transform: reducedMotion ? "translateX(0) scaleX(.35)" : "translateX(-100%) scaleX(.35)" }}
          ref={(element) => { indicatorRef.current = element; }}
        />
      </div>
    </div>
  );
}
