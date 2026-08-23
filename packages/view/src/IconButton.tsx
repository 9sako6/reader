import type { CSSProperties, ReactElement } from "react";
import { ReaderIcon, type ReaderIconName } from "./ReaderIcon";

function iconName(label: string): ReaderIconName {
  if (label === "1文戻る") return "previous";
  if (label === "一時停止") return "pause";
  return "play";
}

export function IconButton({ label, onClick, extra = {}, pressed, iconSize = 34 }: { label: string; onClick: () => void; extra?: CSSProperties; pressed?: boolean; iconSize?: number }): ReactElement {
  return (
    <button
      type="button"
      data-reader-icon-button="true"
      data-reader-icon-name={iconName(label)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      style={{
        width: "44px",
        height: "44px",
        padding: "0",
        border: "0",
        background: "transparent",
        color: "rgba(255,255,255,0.72)",
        font: "inherit",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        borderRadius: "18px",
        transition: "background 160ms ease, color 160ms ease, transform 100ms ease",
        WebkitTapHighlightColor: "transparent",
        ...extra,
      }}
      onClick={onClick}
    >
      <ReaderIcon name={iconName(label)} size={iconSize} />
    </button>
  );
}
