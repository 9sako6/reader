import type { CSSProperties, ReactElement } from "react";

export function IconButton({ label, onClick, extra = {}, pressed }: { label: string; onClick: () => void; extra?: CSSProperties; pressed?: boolean }): ReactElement {
  return (
    <button
      type="button"
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
        ...extra,
      }}
      onClick={onClick}
    >
      {label === "再生" || label === "一時停止" ? (label === "再生" ? "▶" : "Ⅱ") : label}
    </button>
  );
}
