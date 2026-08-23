import type { ReactElement } from "react";

type RsvpUnitProps = {
  unit: ReaderUnit | null;
};

export function RsvpUnit({ unit }: RsvpUnitProps): ReactElement {
  const kind = unit?.kind || "body";
  const text = unit?.text || "";
  const style = {
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

  return (
    <div
      className={`rsvp-unit ${kind}`}
      data-reader-unit="true"
      data-reader-unit-kind={kind}
      data-reader-position-kind="text"
      data-source-start={unit ? String(unit.start) : "0"}
      data-source-end={unit ? String(unit.end) : "0"}
      aria-live="off"
      aria-atomic="false"
      style={style}
    >
      {kind !== "body" ? (
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
      ) : null}
      <span data-reader-unit-text="true" style={{ position: "relative", zIndex: 1, display: "block" }}>
        {text}
      </span>
    </div>
  );
}
