import type { ReactElement } from "react";
import { ReaderIcon, type ReaderIconName } from "./ReaderIcon";

function iconName(label: string): ReaderIconName {
  if (label === "1文戻る") return "previous";
  if (label === "一時停止") return "pause";
  return "play";
}

export function IconButton({ label, onClick, variant, pressed, iconSize = 34 }: { label: string; onClick: () => void; variant?: "previous" | "play"; pressed?: boolean; iconSize?: number }): ReactElement {
  return (
    <button
      type="button"
      data-reader-icon-button="true"
      data-reader-icon-name={iconName(label)}
      aria-label={label}
      aria-keyshortcuts={label === "1文戻る" ? "ArrowLeft" : "Space"}
      title={label}
      aria-pressed={pressed}
      className={`reader-icon-button${variant ? ` reader-icon-button-${variant}` : ""}`}
      onClick={onClick}
    >
      <ReaderIcon name={iconName(label)} size={iconSize} />
    </button>
  );
}
