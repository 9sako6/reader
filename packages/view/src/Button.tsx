import type { ReactElement } from "react";
import { buttonStyle, type ButtonExtras } from "./styles";

export function Button({ label, onClick, extra = {} }: { label: string; onClick: () => void; extra?: ButtonExtras }): ReactElement {
  const modeButton = extra["data-reader-mode-button"];
  const ariaLabel = extra["aria-label"] ?? (label === "続きを読む" ? label : label === "閉じる" ? "readerを閉じる" : undefined);
  const styleExtra = { ...extra };
  const key = styleExtra.key;
  delete styleExtra.key;
  delete styleExtra["data-reader-mode-button"];
  delete styleExtra["aria-label"];
  return (
    <button
      key={key}
      type="button"
      aria-label={ariaLabel === undefined ? undefined : String(ariaLabel)}
      data-reader-mode-button={modeButton === undefined ? undefined : String(modeButton)}
      style={{ ...buttonStyle, ...styleExtra }}
      onClick={onClick}
    >
      {label === "閉じる" ? (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : label}
    </button>
  );
}
