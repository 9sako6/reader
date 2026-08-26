import type { ReactElement } from "react";
import type { ReaderHeading } from "../../extractor/src/types";
import type { ReaderViewHandlers } from "./types";

export function Minimap({ headings, activeHeadingIndex, handlers }: { headings: ReaderHeading[]; activeHeadingIndex: number; handlers: ReaderViewHandlers }): ReactElement | null {
  if (headings.length === 0) return null;
  return (
    <aside
      data-reader-minimap="true"
      aria-label="読書位置"
    >
      <div className="reader-minimap-title">記事の構成</div>
      <nav
        aria-label="記事の構成"
        className="reader-minimap-list"
      >
        {headings.map((heading, index) => (
          <button
            key={`${index}-${heading.text}`}
            type="button"
            aria-current={index === activeHeadingIndex ? "location" : "false"}
            onClick={() => handlers.headingSelect?.(index)}
            className="reader-button reader-minimap-item"
            style={{ paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px` }}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
