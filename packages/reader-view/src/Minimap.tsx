import type { ReactElement } from "react";
import { buttonStyle } from "./styles";
import type { ReaderViewHandlers, ReaderViewModel } from "./types";

export function Minimap({ model, handlers }: { model: Extract<ReaderViewModel, { kind: "rsvp" }>; handlers: ReaderViewHandlers }): ReactElement | null {
  if (model.headings.length === 0) return null;
  return (
    <aside
      data-reader-minimap="true"
      aria-label="読書位置"
      style={{ position: "relative", width: "100%", maxHeight: "min(72vh, 640px)", boxSizing: "border-box", zIndex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column", gap: "16px", alignSelf: "center", padding: "14px 10px 10px", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "18px", background: "rgba(36,36,36,0.72)", boxShadow: "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)", backdropFilter: "blur(28px) saturate(150%)", WebkitBackdropFilter: "blur(28px) saturate(150%)", color: "rgba(255,255,255,0.62)" }}
    >
      <div style={{ fontSize: "13px" }}>記事の構成</div>
      <nav
        aria-label="記事の構成"
        style={{ minHeight: "0", overflow: "auto", display: "flex", flexDirection: "column", gap: "4px", padding: "2px 0", scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {model.headings.map((heading, index) => (
          <button
            key={`${index}-${heading.text}`}
            type="button"
            aria-current={index === model.activeHeadingIndex ? "location" : "false"}
            onClick={() => handlers.headingSelect?.(index)}
            style={{ ...buttonStyle, minHeight: "36px", padding: "4px 8px", paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px`, borderRadius: "8px", border: "0", boxShadow: "none", background: index === model.activeHeadingIndex ? "rgba(255,255,255,0.12)" : "transparent", textAlign: "left", fontSize: "13px", color: "inherit" }}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
