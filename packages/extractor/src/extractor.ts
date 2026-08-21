(function installExtractor(root: typeof globalThis, factory: () => ReaderExtractor) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Extractor = api;
})(globalThis, function createExtractor(): ReaderExtractor {
  function fromText(text: string, readingContext: Partial<ReadingContext> | null = {}): ReaderContent | null {
    const value = typeof text === "string" ? text.trim() : "";
    if (!value) return null;
    return { text: value, readingContext: normalizeReadingContext(readingContext) };
  }

  function fromPage(
    sourceDocument: Document = document,
    DefuddleClass: typeof import("defuddle").default = globalThis.Defuddle,
  ): ReaderContent | null {
    if (typeof DefuddleClass !== "function" || typeof sourceDocument.createRange !== "function") return null;

    const result = new DefuddleClass(sourceDocument, {
      markdown: false,
      useAsync: false,
      removeExactSelectors: true,
      removePartialSelectors: true,
      removeHiddenElements: true,
      removeLowScoring: true,
      removeImages: false,
      standardize: true,
      includeReplies: false,
    }).parse();
    if (typeof result?.content !== "string" || !result.content.trim()) return null;

    const contentRoot = sourceDocument.createElement("article");
    contentRoot.innerHTML = result.content;
    contentRoot.querySelector?.("#__reader-host")?.remove();
    contentRoot.querySelector?.("#__rsvp-reader-root")?.remove();

    const fullRange = sourceDocument.createRange();
    fullRange.selectNodeContents(contentRoot);
    const rawText = fullRange.toString();
    const leadingWhitespaceLength = rawText.length - rawText.trimStart().length;
    const text = rawText.trim();
    if (!text) return null;

    const headingEntries = [...contentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((element) => ({
        element,
        text: (element.textContent || "").trim(),
        level: Number(element.tagName?.slice(1)) || 1,
      }))
      .filter(({ text: headingText }) => headingText.length > 0);
    const title = typeof result.title === "string" ? result.title.trim() : "";
    const includeTitle = title.length > 0 && headingEntries[0]?.text !== title;
    const sectionOffsets = headingEntries.map(({ element }) => offsetBefore(
      sourceDocument,
      contentRoot,
      element,
      text.length,
      leadingWhitespaceLength,
    ));
    const headings = headingEntries.map(({ text: headingText, level }) => ({ text: headingText, level }));
    if (includeTitle) headings.unshift({ text: title, level: 1 });
    const sectionTransitions = sectionOffsets.map((offset, headingIndex) => ({
      offset,
      headingIndex: headingIndex + (includeTitle ? 1 : 0),
    }));

    return {
      text,
      readingContext: {
        title: title || headingEntries[0]?.text || "",
        blocks: extractBlocks(sourceDocument, contentRoot, text, leadingWhitespaceLength),
        headings,
        sectionOffsets,
        sectionTransitions,
        initialHeadingIndex: includeTitle ? 0 : -1,
        figures: extractFigures(sourceDocument, contentRoot, text, leadingWhitespaceLength),
      },
    };
  }

  function normalizeReadingContext(value: Partial<ReadingContext> | null): ReadingContext {
    return {
      title: typeof value?.title === "string" ? value.title : "",
      blocks: Array.isArray(value?.blocks) ? value.blocks : [],
      headings: Array.isArray(value?.headings) ? value.headings : [],
      sectionOffsets: Array.isArray(value?.sectionOffsets) ? value.sectionOffsets : [],
      sectionTransitions: Array.isArray(value?.sectionTransitions) ? value.sectionTransitions : [],
      initialHeadingIndex: typeof value?.initialHeadingIndex === "number" && Number.isInteger(value.initialHeadingIndex)
        ? value.initialHeadingIndex
        : -1,
      figures: Array.isArray(value?.figures) ? value.figures : [],
    };
  }

  function offsetBefore(
    sourceDocument: Document,
    contentRoot: HTMLElement,
    element: Node,
    textLength: number,
    leadingWhitespaceLength: number,
  ): number {
    const prefixRange = sourceDocument.createRange();
    prefixRange.selectNodeContents(contentRoot);
    prefixRange.setEndBefore(element);
    return Math.min(textLength, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
  }

  function extractBlocks(
    sourceDocument: Document,
    contentRoot: HTMLElement,
    text: string,
    leadingWhitespaceLength: number,
  ): ReaderBlock[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const blockSelector = "h1, h2, h3, h4, h5, h6, p, blockquote, pre, li";
    return [...contentRoot.querySelectorAll(blockSelector)]
      .map((element) => {
        const parentBlock = element.parentElement?.closest?.(blockSelector);
        if (parentBlock && parentBlock !== contentRoot) return null;
        const blockText = (element.textContent || "").trim();
        if (!blockText) return null;
        const start = offsetBefore(sourceDocument, contentRoot, element, text.length, leadingWhitespaceLength);
        const tagName = String(element.tagName || "p").toLowerCase();
        return {
          text: blockText,
          kind: /^h[1-6]$/u.test(tagName) ? "heading" : tagName === "blockquote" ? "quote" : tagName === "pre" ? "preformatted" : "paragraph",
          level: /^h[1-6]$/u.test(tagName) ? Number(tagName.slice(1)) : null,
          start,
          end: Math.min(text.length, start + blockText.length),
        };
      })
      .filter((block): block is ReaderBlock => block !== null);
  }

  function extractFigures(
    sourceDocument: Document,
    contentRoot: HTMLElement,
    text: string,
    leadingWhitespaceLength: number,
  ): ReaderFigure[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const figures: ReaderFigure[] = [];
    for (const image of contentRoot.querySelectorAll("img")) {
      const container = image.closest?.("figure") || image;
      const src = String(image.currentSrc || image.src || image.getAttribute?.("src") || "").trim();
      if (!src || /^javascript:/iu.test(src)) continue;
      const figureOffset = offsetBefore(sourceDocument, contentRoot, container, text.length, leadingWhitespaceLength);
      const caption = (container.querySelector?.("figcaption")?.textContent || "").trim();
      const containerTextLength = (container.textContent || caption).length;
      figures.push({
        src,
        alt: (image.getAttribute?.("alt") || "").trim(),
        caption,
        sourceOffset: figureOffset,
        sourceEnd: Math.min(text.length, figureOffset + containerTextLength),
      });
    }
    return figures.sort((left, right) => left.sourceOffset - right.sourceOffset);
  }

  return { fromPage, fromText };
});
