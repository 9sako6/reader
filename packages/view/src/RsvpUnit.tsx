import type { ReactNode } from "react";

type RsvpUnitProps = {
  unit: ReaderUnit | null;
};

export const rsvpUnitStyle = {
  position: "absolute" as const,
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(100%, 640px)",
  maxWidth: "calc(100% - 32px)",
  height: "1.35em",
  boxSizing: "border-box" as const,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0",
  borderRadius: "12px",
  fontSize: "clamp(36px, 4.5vw, 64px)",
  fontWeight: "600",
  lineHeight: "1.35",
  textAlign: "center" as const,
  whiteSpace: "nowrap" as const,
  overflow: "hidden" as const,
  overflowWrap: "normal" as const,
  wordBreak: "keep-all" as const,
};

export function RsvpUnit({ unit }: RsvpUnitProps): ReactNode {
  const kind = unit?.kind || "body";
  const text = unit?.text || "";
  if (kind === "code") return (
    <code
      data-reader-inline-code="true"
      tabIndex={0}
      style={{
        display: "block",
        maxWidth: "100%",
        padding: "0.35em 0.5em",
        overflowX: "auto",
        borderRadius: "10px",
        background: "rgba(255,255,255,0.08)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "clamp(18px, 3vw, 36px)",
        fontWeight: "500",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </code>
  );
  if (kind === "body") return text;
  return (
    <>
      <span
        data-reader-unit-background="true"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0",
          zIndex: 0,
          borderRadius: "inherit",
          background: kind === "quote" ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.035)",
          pointerEvents: "none",
        }}
      />
      <span data-reader-unit-text="true" style={{ position: "relative", zIndex: 1, display: "block" }}>
        {text}
      </span>
    </>
  );
}
