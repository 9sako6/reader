import { useLayoutEffect, useRef, type ReactElement } from "react";
import type { ReaderRewindFeedback, ReaderViewHandlers } from "./types";

export function RewindFeedback({ feedback, reducedMotion, animate, onDone }: { feedback: ReaderRewindFeedback; reducedMotion: boolean; animate?: ReaderViewHandlers["rewindAnimation"]; onDone?(id: number): void }): ReactElement {
  const firstRingRef = useRef<HTMLElement | null>(null);
  const secondRingRef = useRef<HTMLElement | null>(null);
  const iconRef = useRef<SVGElement | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useLayoutEffect(() => {
    const firstRing = firstRingRef.current;
    const secondRing = secondRingRef.current;
    const icon = iconRef.current;
    if (!firstRing || !secondRing || !icon || !animate) return undefined;
    return animate({ firstRing, secondRing, icon }, reducedMotion, () => onDoneRef.current?.(feedback.id));
  }, [animate, feedback.id, reducedMotion]);
  return (
    <div className="rewind-feedback" aria-hidden="true" style={{ left: `${feedback.left}px`, top: `${feedback.top}px` }}>
      <span className="rewind-ring" ref={(element) => { firstRingRef.current = element; }} />
      <span className="rewind-ring" ref={(element) => { secondRingRef.current = element; }} />
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        ref={(element) => { iconRef.current = element; }}
      >
        <path d="M10.9 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
        <path d="M20.15 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
      </svg>
    </div>
  );
}
