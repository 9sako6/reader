export function blockTag(block: ReaderBlock): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "pre" | "p" {
  if (block.kind === "heading") return `h${Math.min(6, Math.max(1, block.level || 2))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  if (block.kind === "quote") return "blockquote";
  if (block.kind === "preformatted") return "pre";
  return "p";
}
