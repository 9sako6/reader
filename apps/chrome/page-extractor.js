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
      removeImages: false,
      standardize: true,
      includeReplies: false,
    }).parse();
    if (typeof result?.content !== "string" || !result.content.trim()) return null;

    const contentRoot = sourceDocument.createElement("article");
    contentRoot.innerHTML = result.content;
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
    const sectionTransitions = headingEntries.map(({ element }, headingIndex) => {
      const prefixRange = sourceDocument.createRange();
      prefixRange.selectNodeContents(contentRoot);
      prefixRange.setEndBefore(element);
      const offset = Math.min(text.length, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
      return { offset, headingIndex: headingIndex + (includeTitle ? 1 : 0) };
    });
    const headings = headingEntries.map(({ text: headingText, level }) => ({ text: headingText, level }));
    if (includeTitle) headings.unshift({ text: title, level: 1 });
    const figures = extractReferencedFigures(
      sourceDocument,
      contentRoot,
      text,
      leadingWhitespaceLength,
    );

    return {
      text,
      readingContext: {
        headings,
        sectionTransitions,
        initialHeadingIndex: includeTitle ? 0 : -1,
        figures,
      },
    };
  }

  function extractReferencedFigures(sourceDocument, contentRoot, text, leadingWhitespaceLength) {
    const figures = [];
    const seenContainers = new Set();
    for (const image of contentRoot.querySelectorAll("img")) {
      const container = image.closest?.("figure") || image;
      if (seenContainers.has(container)) continue;
      seenContainers.add(container);

      const src = String(image.currentSrc || image.src || image.getAttribute?.("src") || "").trim();
      if (!src || /^javascript:/i.test(src)) continue;

      const prefixRange = sourceDocument.createRange();
      prefixRange.selectNodeContents(contentRoot);
      prefixRange.setEndBefore(container);
      const figureOffset = Math.min(
        text.length,
        Math.max(0, prefixRange.toString().length - leadingWhitespaceLength),
      );
      const caption = (container.querySelector?.("figcaption")?.textContent || "").trim();
      const reference = findFigureReference(text, figureOffset, caption);
      if (!reference) continue;

      figures.push({
        src,
        alt: (image.getAttribute?.("alt") || "").trim(),
        caption,
        referenceSentence: reference.sentence,
        referenceEnd: reference.end,
      });
    }
    return figures.sort((left, right) => left.referenceEnd - right.referenceEnd);
  }

  function findFigureReference(text, figureOffset, caption) {
    const prefix = text.slice(0, figureOffset);
    const captionLabel = caption.match(/(?:図|表)\s*[A-Za-zＡ-Ｚａ-ｚ]?\s*\d+/iu)?.[0] || "";
    const patterns = [
      /(?:図|表)\s*[A-Za-zＡ-Ｚａ-ｚ]?\s*\d+/giu,
      /(?:下|上|次|以下|この)(?:の)?(?:図|表|画像|グラフ)/gu,
      /(?:この|次の|以下の)(?:グラフ|チャート)/gu,
    ];
    if (captionLabel) {
      const escapedLabel = captionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patterns.unshift(new RegExp(escapedLabel, "giu"));
    }

    let latestMatch = null;
    for (const pattern of patterns) {
      for (const match of prefix.matchAll(pattern)) {
        if (!latestMatch || match.index > latestMatch.index) latestMatch = match;
      }
    }
    if (!latestMatch) return null;

    const beforeMatch = prefix.slice(0, latestMatch.index);
    const boundaryIndexes = ["。", "！", "？", "!", "?", "\n"].map((mark) => beforeMatch.lastIndexOf(mark));
    let sentenceStart = Math.max(...boundaryIndexes) + 1;
    while (/\s/u.test(prefix[sentenceStart] || "")) sentenceStart += 1;

    const afterMatch = prefix.slice(latestMatch.index + latestMatch[0].length);
    const ending = afterMatch.match(/[。！？.!?][」』）)\]]?/u);
    const sentenceEnd = ending
      ? latestMatch.index + latestMatch[0].length + ending.index + ending[0].length
      : prefix.trimEnd().length;
    const sentence = prefix.slice(sentenceStart, sentenceEnd).trim();
    return sentence ? { sentence, end: sentenceEnd } : null;
  }

  return { extractPage };
});
