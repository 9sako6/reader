import { useLayoutEffect, useRef, type ReactNode } from "react";

type RsvpUnitProps = {
  unit: ReaderUnit | null;
};

function fitTextToContainer(textElement: HTMLSpanElement): void {
  const container = textElement.parentElement;
  const view = textElement.ownerDocument.defaultView;
  if (!container || !view || typeof view.getComputedStyle !== "function") return;

  container.style.fontSize = "";
  const availableWidth = container.clientWidth;
  const naturalWidth = textElement.getBoundingClientRect().width;
  const baseFontSize = Number.parseFloat(view.getComputedStyle(container).fontSize);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || naturalWidth <= availableWidth || !Number.isFinite(baseFontSize)) return;

  container.style.fontSize = `${baseFontSize * availableWidth / naturalWidth}px`;
}

export function RsvpUnit({ unit }: RsvpUnitProps): ReactNode {
  const kind = unit?.kind || "body";
  const text = unit?.text || "";
  const textElement = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (textElement.current) fitTextToContainer(textElement.current);
  });
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
      <span ref={textElement} data-reader-unit-text="true">
        {text}
      </span>
    </>
  );
}
