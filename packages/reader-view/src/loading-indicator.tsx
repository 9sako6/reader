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
      className={mobile ? "launch-loader" : undefined}
      data-reader-loading-bar="true"
      aria-hidden="true"
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(180px, calc(100% - 48px))", height: "2px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.18)", pointerEvents: "none", display: revealed ? "block" : "none", opacity: revealed ? "1" : "0" }}
    >
      <div
        className={mobile ? "launch-progress-track" : undefined}
        data-reader-loading-indicator="true"
        style={{ width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.18)" }}
      >
        <div
          className={mobile ? "launch-progress-indicator" : undefined}
          style={{ width: "100%", height: "100%", borderRadius: "inherit", background: "rgba(255,255,255,0.82)", transform: reducedMotion ? "translateX(0) scaleX(.35)" : "translateX(-100%) scaleX(.35)", transformOrigin: "left center" }}
          ref={(element) => { indicatorRef.current = element; }}
        />
      </div>
    </div>
  );
}
