export function figureDescription(figure: ReaderFigure): string {
  const alt = figure.alt.trim();
  const caption = figure.caption.trim();
  if (alt && caption && alt !== caption) return `${alt}。${caption}`;
  return alt || caption || "本文画像";
}
