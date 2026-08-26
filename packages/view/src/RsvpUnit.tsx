import type { ReactNode } from "react";

type RsvpUnitProps = {
  frame: RsvpFrame | null;
};

export function RsvpUnit({ frame }: RsvpUnitProps): ReactNode {
  const kind = frame?.kind || "body";
  const text = frame?.text || "";
  if (kind === "code") return (
    <code
      data-reader-inline-code="true"
      tabIndex={0}
    >
      {text}
    </code>
  );
  return (
    <>
      {kind === "body" ? null : (
        <span
          data-reader-unit-background="true"
          aria-hidden="true"
        />
      )}
      <span data-reader-unit-text="true">
        {text}
      </span>
    </>
  );
}
