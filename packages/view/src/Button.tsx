import type { ReactElement } from "react";
import { ReaderIcon } from "./ReaderIcon";
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
        <ReaderIcon name="close" size={22} />
      ) : label}
    </button>
  );
}
