import type { ReactNode } from "react";

type RsvpUnitProps = {
  unit: ReaderUnit | null;
};

export function RsvpUnit({ unit }: RsvpUnitProps): ReactNode {
  const kind = unit?.kind || "body";
  const text = unit?.text || "";
  if (kind === "code") return (
    <code
      data-reader-inline-code="true"
      tabIndex={0}
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
      />
      <span data-reader-unit-text="true">
        {text}
      </span>
    </>
  );
}
