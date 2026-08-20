(function installRsvpPageExtractor(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RsvpPageExtractor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRsvpPageExtractor() {
  function extractPage(sourceDocument = document, DefuddleClass = globalThis.Defuddle) {
    if (typeof DefuddleClass !== "function" || typeof sourceDocument.createRange !== "function") return null;

    const result = new DefuddleClass(sourceDocument, {
      markdown: false,
      useAsync: false,
      removeExactSelectors: true,
      removePartialSelectors: true,
      removeHiddenElements: true,
      removeLowScoring: true,
      removeImages: true,
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
      }))
      .filter(({ text: headingText }) => headingText.length > 0);
    const title = typeof result.title === "string" ? result.title.trim() : "";
    const sectionOffsets = headingEntries.map(({ element }) => {
      const prefixRange = sourceDocument.createRange();
      prefixRange.selectNodeContents(contentRoot);
      prefixRange.setEndBefore(element);
      return Math.min(text.length, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
    });
    const blocks = extractBlocks(
      sourceDocument,
      contentRoot,
      text,
      leadingWhitespaceLength,
    );

    return {
      text,
      readingContext: {
        title: title || headingEntries[0]?.text || "",
        sectionOffsets,
        blocks,
      },
    };
  }

  function extractBlocks(sourceDocument, contentRoot, text, leadingWhitespaceLength) {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const blockSelector = "h1, h2, h3, h4, h5, h6, p, blockquote, pre, li";
    return [...contentRoot.querySelectorAll(blockSelector)]
      .map((element) => {
        const parentBlock = element.parentElement?.closest?.(blockSelector);
        if (parentBlock && parentBlock !== contentRoot) return null;
        const blockText = (element.textContent || "").trim();
        if (!blockText) return null;
        const prefixRange = sourceDocument.createRange();
        prefixRange.selectNodeContents(contentRoot);
        prefixRange.setEndBefore(element);
        const start = Math.min(text.length, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
        const tagName = String(element.tagName || "p").toLowerCase();
        return {
          text: blockText,
          kind: /^h[1-6]$/u.test(tagName) ? "heading" : tagName === "blockquote" ? "quote" : tagName === "pre" ? "preformatted" : "paragraph",
          level: /^h[1-6]$/u.test(tagName) ? Number(tagName.slice(1)) : null,
          start,
          end: Math.min(text.length, start + blockText.length),
        };
      })
      .filter(Boolean);
  }

  return { extractPage };
});
