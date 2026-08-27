import type { ReactElement } from "react";

export function ModeSelector({
  spots,
  switchToSpots,
  switchToPage,
  layout,
}: {
  spots: boolean;
  switchToSpots: () => void;
  switchToPage: () => void;
  layout: "desktop" | "mobile";
}): ReactElement {
  return (
    <div
      className={`reader-mode-selector reader-mode-selector-${layout}`}
      data-reader-mode-selector="true"
      role="group"
      aria-label="表示モード"
    >
      <button
        type="button"
        className="reader-mode-option"
        data-reader-mode-button="true"
        data-reader-mode="spots"
        aria-label="Spots、フレーズをひとつずつ観る"
        aria-pressed={spots}
        onClick={spots ? undefined : switchToSpots}
      >
        Spots
      </button>
      <button
        type="button"
        className="reader-mode-option"
        data-reader-mode-button="true"
        data-reader-mode="page"
        aria-label="Page、文章全体で読む"
        aria-pressed={!spots}
        onClick={spots ? switchToPage : undefined}
      >
        Page
      </button>
    </div>
  );
}
