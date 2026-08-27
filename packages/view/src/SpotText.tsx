import type { ReactNode } from "react";

type SpotTextProps = {
  spot: Spot | null;
};

export function SpotText({ spot }: SpotTextProps): ReactNode {
  const kind = spot?.kind || "body";
  const text = spot?.text || "";
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
          data-reader-spot-background="true"
          aria-hidden="true"
        />
      )}
      <span data-reader-spot-text="true">
        {text}
      </span>
    </>
  );
}
