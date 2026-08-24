import type { ReactElement } from "react";
import { ReaderIcon } from "./ReaderIcon";

type ButtonVariant = "default" | "close" | "mode";

export function Button({ label, onClick, variant = "default", className, ariaLabel }: { label: string; onClick: () => void; variant?: ButtonVariant; className?: string; ariaLabel?: string }): ReactElement {
  const accessibleLabel = ariaLabel ?? (label === "続きを読む" ? label : label === "閉じる" ? "readerを閉じる" : undefined);
  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      data-reader-mode-button={variant === "mode" ? "true" : undefined}
      className={["reader-button", variant === "default" ? "" : `reader-button-${variant}`, className || ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      {label === "閉じる" ? (
        <ReaderIcon name="close" size={22} />
      ) : label}
    </button>
  );
}
