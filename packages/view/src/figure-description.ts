export function figureDescription(figure: ReaderFigure): string {
  if (figure.kind === "code") return figure.alt || "コードブロック";
  const alt = figure.alt.trim();
  const caption = figure.caption.trim();
  if (alt && caption && alt !== caption) return `${alt}。${caption}`;
  return alt || caption || "本文画像";
}
