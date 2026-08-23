import type { ReactElement } from "react";

export type ReaderIconName = "previous" | "play" | "pause" | "close";

export function ReaderIcon({ name, size }: { name: ReaderIconName; size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {name === "previous" ? (
        <>
          <path d="M10.9 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
          <path d="M20.15 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" />
        </>
      ) : name === "play" ? (
        <path d="M6.2 4.7a1.5 1.5 0 0 1 2.3-1.3l11.4 7.3a1.5 1.5 0 0 1 0 2.6L8.5 20.6a1.5 1.5 0 0 1-2.3-1.3z" />
      ) : name === "pause" ? (
        <>
          <rect x="5" y="3" width="5" height="18" rx="1.5" />
          <rect x="14" y="3" width="5" height="18" rx="1.5" />
        </>
      ) : (
        <>
          <rect x="3.5" y="10.5" width="17" height="3" rx="1.5" transform="rotate(45 12 12)" />
          <rect x="3.5" y="10.5" width="17" height="3" rx="1.5" transform="rotate(-45 12 12)" />
        </>
      )}
    </svg>
  );
}
