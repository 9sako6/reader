(function installExtractor(root: typeof globalThis, factory: () => ReaderExtractor) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Extractor = api;
})(globalThis, function createExtractor(): ReaderExtractor {
  const TEXT_BOUNDARY_TAGS = new Set([
    "ADDRESS", "BLOCKQUOTE", "BR", "DD", "DT", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "LI", "P", "PRE", "TR",
  ]);
  const BCP_47_LIKE_LANGUAGE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u;

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

    const result = extractDominantArticle(sourceDocument) || new DefuddleClass(sourceDocument, {
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

    const stagingRoot = sourceDocument.createElement("template");
    const usesTemplate = "content" in stagingRoot;
    const contentRoot = usesTemplate
      ? (stagingRoot as HTMLTemplateElement).content
      : sourceDocument.createElement("article");
    if (usesTemplate) stagingRoot.innerHTML = result.content;
    else (contentRoot as HTMLElement).innerHTML = result.content;
    contentRoot.querySelector?.("#__reader-host")?.remove();
    contentRoot.querySelector?.("#__rsvp-reader-root")?.remove();

    const indexedSource = indexSourceOffsets(contentRoot);
    let rawText = indexedSource.rawText;
    if (!rawText) {
      const fullRange = sourceDocument.createRange();
      fullRange.selectNodeContents(contentRoot);
      rawText = fullRange.toString();
    }
    const leadingWhitespaceLength = rawText.length - rawText.trimStart().length;
    const text = rawText.trim();
    if (!text) return null;
    const sourceOffsets = indexedSource.offsets;

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
      sourceOffsets,
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
        language: sourceDocument.documentElement?.lang || "",
        title: title || headingEntries[0]?.text || "",
        blocks: extractBlocks(sourceDocument, contentRoot, text, leadingWhitespaceLength, sourceOffsets),
        headings,
        sectionOffsets,
        sectionTransitions,
        initialHeadingIndex: includeTitle ? 0 : -1,
        figures: extractFigures(sourceDocument, contentRoot, text, leadingWhitespaceLength, sourceOffsets),
      },
    };
  }

  function extractDominantArticle(sourceDocument: Document): { content: string; title: string } | null {
    if (typeof sourceDocument.querySelectorAll !== "function") return null;
    const articles = [...sourceDocument.querySelectorAll("article")]
      .filter((article) => !article.parentElement?.closest?.("article"));
    if (articles.length !== 1) return null;
    const article = articles[0];
    if (!article || typeof article.cloneNode !== "function") return null;
    const articleText = (article.textContent || "").trim();
    const bodyText = (sourceDocument.body?.textContent || "").trim();
    const blockCount = article.querySelectorAll?.("p, li, blockquote, pre").length || 0;
    if (articleText.length < 800 || blockCount < 3) return null;
    if (bodyText.length > 0 && articleText.length / bodyText.length < 0.6) return null;
    const clone = article.cloneNode(true) as Element;
    removeCssHiddenCloneElements(sourceDocument, article, clone);
    for (const element of clone.querySelectorAll(
      "script, style, noscript, template, nav, footer, form, button, [hidden], [aria-hidden='true']",
    )) element.remove();
    const content = clone.innerHTML.trim();
    if (!content) return null;
    const title = (clone.querySelector("h1")?.textContent || sourceDocument.title || "").trim();
    return { content, title };
  }

  function removeCssHiddenCloneElements(sourceDocument: Document, sourceRoot: Element, cloneRoot: Element): void {
    const view = sourceDocument.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return;
    const sourceElements = [...sourceRoot.querySelectorAll("*")];
    const cloneElements = [...cloneRoot.querySelectorAll("*")];
    const hiddenElements = new Set<Element>();
    for (const [index, sourceElement] of sourceElements.entries()) {
      const parentHidden = sourceElement.parentElement
        ? hiddenElements.has(sourceElement.parentElement)
        : false;
      if (parentHidden) {
        hiddenElements.add(sourceElement);
        continue;
      }
      if (view.getComputedStyle(sourceElement).display !== "none") continue;
      hiddenElements.add(sourceElement);
      cloneElements[index]?.remove();
    }
  }

  function normalizeReadingContext(value: Partial<ReadingContext> | null, fallbackLanguage = "ja"): ReadingContext {
    const suppliedLanguage = typeof value?.language === "string" ? value.language.trim() : "";
    const fallback = BCP_47_LIKE_LANGUAGE.test(fallbackLanguage) ? fallbackLanguage : "ja";
    return {
      language: BCP_47_LIKE_LANGUAGE.test(suppliedLanguage) ? suppliedLanguage : fallback,
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
    contentRoot: DocumentFragment | HTMLElement,
    element: Node,
    textLength: number,
    leadingWhitespaceLength: number,
    sourceOffsets: Map<Node, number>,
  ): number {
    const indexedOffset = sourceOffsets.get(element);
    if (indexedOffset !== undefined) {
      return Math.min(textLength, Math.max(0, indexedOffset - leadingWhitespaceLength));
    }
    const prefixRange = sourceDocument.createRange();
    prefixRange.selectNodeContents(contentRoot);
    prefixRange.setEndBefore(element);
    return Math.min(textLength, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
  }

  function indexSourceOffsets(
    contentRoot: DocumentFragment | HTMLElement,
  ): { rawText: string; offsets: Map<Node, number> } {
    const offsets = new Map<Node, number>();
    let rawText = "";
    const visit = (node: Node): void => {
      offsets.set(node, rawText.length);
      if (node.nodeType === 3) {
        rawText += node.nodeValue || "";
        return;
      }
      for (const child of node.childNodes || []) visit(child);
      const tagName = String((node as Element).tagName || "").toUpperCase();
      if (TEXT_BOUNDARY_TAGS.has(tagName) && !rawText.endsWith("\n")) rawText += "\n";
    };
    visit(contentRoot);
    return { rawText, offsets };
  }

  function extractBlocks(
    sourceDocument: Document,
    contentRoot: DocumentFragment | HTMLElement,
    text: string,
    leadingWhitespaceLength: number,
    sourceOffsets: Map<Node, number>,
  ): ReaderBlock[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const blockSelector = "h1, h2, h3, h4, h5, h6, p, blockquote, pre, li";
    return [...contentRoot.querySelectorAll(blockSelector)]
      .map((element) => {
        const parentBlock = element.parentElement?.closest?.(blockSelector);
        if (parentBlock && parentBlock !== contentRoot) return null;
        const blockText = (element.textContent || "").trim();
        if (!blockText) return null;
        const start = offsetBefore(sourceDocument, contentRoot, element, text.length, leadingWhitespaceLength, sourceOffsets);
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
    contentRoot: DocumentFragment | HTMLElement,
    text: string,
    leadingWhitespaceLength: number,
    sourceOffsets: Map<Node, number>,
  ): ReaderFigure[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const figures: ReaderFigure[] = [];
    for (const image of contentRoot.querySelectorAll("img")) {
      const container = image.closest?.("figure") || image;
      const src = String(image.currentSrc || image.src || image.getAttribute?.("src") || "").trim();
      if (!src || /^javascript:/iu.test(src)) continue;
      const figureOffset = offsetBefore(sourceDocument, contentRoot, container, text.length, leadingWhitespaceLength, sourceOffsets);
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
