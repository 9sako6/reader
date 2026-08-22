(function installExtractor(root: typeof globalThis, factory: () => ReaderExtractor) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Extractor = api;
})(globalThis, function createExtractor(): ReaderExtractor {
  const TEXT_BOUNDARY_TAGS = new Set([
    "ADDRESS", "BLOCKQUOTE", "BR", "DD", "DT", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "LI", "P", "PRE", "TR",
  ]);
  const BCP_47_LIKE_LANGUAGE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u;

  interface IndexedNodeRange {
    start: number;
    contentEnd: number;
    end: number;
  }

  interface IndexedSource {
    rawText: string;
    ranges: Map<Node, IndexedNodeRange>;
  }

  interface ParsedPageResult {
    content: string;
    title?: string;
  }

  interface CanonicalPageData {
    contentRoot: DocumentFragment | HTMLElement;
    indexedSource: IndexedSource;
    text: string;
    leadingTrim: number;
  }

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
    const result = extractPageResult(sourceDocument, DefuddleClass);
    if (!result) return null;
    const canonical = createCanonicalPageData(sourceDocument, result);
    return canonical ? buildReaderContent(sourceDocument, result, canonical) : null;
  }

  async function fromPageAsync(
    sourceDocument: Document = document,
    DefuddleClass: typeof import("defuddle").default = globalThis.Defuddle,
    options: ReaderExtractionOptions = {},
  ): Promise<ReaderContent | null> {
    if (typeof DefuddleClass !== "function" || typeof sourceDocument.createRange !== "function") return null;

    const dominantArticle = await runExtractionPhase(
      "dominant_article",
      options,
      () => extractDominantArticle(sourceDocument),
    );
    const result = dominantArticle || await runExtractionPhase(
      "defuddle_parse",
      options,
      () => parseWithDefuddle(sourceDocument, DefuddleClass),
    );
    if (dominantArticle) {
      await runExtractionPhase("defuddle_parse", options, () => dominantArticle);
    }
    if (!result || typeof result.content !== "string" || !result.content.trim()) return null;

    const canonical = await runExtractionPhase(
      "canonical_text",
      options,
      () => createCanonicalPageData(sourceDocument, result),
    );
    if (!canonical) return null;
    return runExtractionPhase(
      "blocks_figures",
      options,
      () => buildReaderContent(sourceDocument, result, canonical),
    );
  }

  function extractPageResult(
    sourceDocument: Document,
    DefuddleClass: typeof import("defuddle").default,
  ): ParsedPageResult | null {
    const dominantArticle = extractDominantArticle(sourceDocument);
    return dominantArticle || parseWithDefuddle(sourceDocument, DefuddleClass);
  }

  function parseWithDefuddle(
    sourceDocument: Document,
    DefuddleClass: typeof import("defuddle").default,
  ): ParsedPageResult | null {
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
    return result && typeof result === "object" ? result as ParsedPageResult : null;
  }

  function createCanonicalPageData(
    sourceDocument: Document,
    result: ParsedPageResult,
  ): CanonicalPageData | null {
    if (typeof result.content !== "string" || !result.content.trim()) return null;
    const stagingRoot = sourceDocument.createElement("template");
    const usesTemplate = "content" in stagingRoot;
    const contentRoot = usesTemplate
      ? (stagingRoot as HTMLTemplateElement).content
      : sourceDocument.createElement("article");
    if (usesTemplate) stagingRoot.innerHTML = result.content;
    else (contentRoot as HTMLElement).innerHTML = result.content;
    const ownedReader = contentRoot.querySelector?.('[data-reader-owned="true"]');
    if (ownedReader) {
      ownedReader.remove();
    } else {
      contentRoot.querySelector?.("#__reader-host")?.remove();
      contentRoot.querySelector?.("#__rsvp-reader-root")?.remove();
    }

    const indexedSource = indexSourceOffsets(contentRoot);
    let rawText = indexedSource.rawText;
    if (!rawText) {
      const fullRange = sourceDocument.createRange();
      fullRange.selectNodeContents(contentRoot);
      rawText = fullRange.toString();
    }
    const leadingTrim = rawText.length - rawText.trimStart().length;
    const trailingTrim = rawText.length - rawText.trimEnd().length;
    const text = rawText.slice(leadingTrim, rawText.length - trailingTrim);
    if (!text) return null;
    return { contentRoot, indexedSource, text, leadingTrim };
  }

  function buildReaderContent(
    sourceDocument: Document,
    result: ParsedPageResult,
    canonical: CanonicalPageData,
  ): ReaderContent {
    const { contentRoot, indexedSource, text, leadingTrim } = canonical;
    const headingEntries = [...contentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((element) => {
        const indexedRange = indexedSource.ranges.get(element);
        const headingRange = indexedRange
          ? trimIndexedNodeRange(text, indexedRange, leadingTrim)
          : null;
        return {
          element,
          range: headingRange,
          text: headingRange?.value ?? String(element.textContent || "").trim(),
          level: Number(element.tagName?.slice(1)) || 1,
        };
      })
      .filter(({ text: headingText }) => headingText.length > 0);
    const title = typeof result.title === "string" ? result.title.trim() : "";
    const includeTitle = title.length > 0 && headingEntries[0]?.text !== title;
    const sectionOffsets = headingEntries.map(({ element, range }) => range?.start ?? offsetBefore(
      sourceDocument,
      contentRoot,
      element,
      text.length,
      leadingTrim,
      indexedSource,
    ));
    const headings = headingEntries.map(({ text: headingText, level }) => ({ text: headingText, level }));
    if (includeTitle) headings.unshift({ text: title, level: 1 });
    const sectionTransitions = sectionOffsets.map((offset, headingIndex) => ({
      offset,
      headingIndex: headingIndex + (includeTitle ? 1 : 0),
    }));

    return {
      text,
      readingContext: normalizeReadingContext({
        language: sourceDocument.documentElement?.lang || "",
        title: title || headingEntries[0]?.text || "",
        blocks: extractBlocks(sourceDocument, contentRoot, text, leadingTrim, indexedSource),
        headings,
        sectionOffsets,
        sectionTransitions,
        initialHeadingIndex: includeTitle ? 0 : -1,
        figures: extractFigures(sourceDocument, contentRoot, text, leadingTrim, indexedSource),
      }),
    };
  }

  async function runExtractionPhase<T>(
    phase: ReaderExtractionPhase,
    options: ReaderExtractionOptions,
    work: () => T,
  ): Promise<T> {
    throwIfAborted(options.signal);
    await yieldToAnimationFrame(options.signal);
    const startedAt = phaseNow();
    const result = work();
    throwIfAborted(options.signal);
    await yieldToAnimationFrame(options.signal);
    options.onPhase?.(phase);
    globalThis.console?.debug?.("reader preparation phase", {
      phase,
      durationMs: Math.max(0, Math.round(phaseNow() - startedAt)),
    });
    return result;
  }

  function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw new DOMException("Aborted", "AbortError");
  }

  function yieldToAnimationFrame(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise<void>((resolve) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => resolve());
      } else Promise.resolve().then(resolve);
    }).then(() => {
      throwIfAborted(signal);
    });
  }

  function phaseNow(): number {
    return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
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
    leadingTrim: number,
    indexedSource: IndexedSource,
  ): number {
    const indexedRange = indexedSource.ranges.get(element);
    if (indexedRange !== undefined) {
      return toTextOffset(indexedRange.start, leadingTrim, textLength);
    }
    const prefixRange = sourceDocument.createRange();
    prefixRange.selectNodeContents(contentRoot);
    prefixRange.setEndBefore(element);
    return toTextOffset(prefixRange.toString().length, leadingTrim, textLength);
  }

  function indexSourceOffsets(
    contentRoot: DocumentFragment | HTMLElement,
  ): IndexedSource {
    const ranges = new Map<Node, IndexedNodeRange>();
    let rawText = "";
    const visit = (node: Node): void => {
      const start = rawText.length;
      if (node.nodeType === 3) {
        rawText += node.nodeValue || "";
        const end = rawText.length;
        ranges.set(node, { start, contentEnd: end, end });
        return;
      }
      for (const child of node.childNodes || []) visit(child);
      const contentEnd = rawText.length;
      const tagName = String((node as Element).tagName || "").toUpperCase();
      if (TEXT_BOUNDARY_TAGS.has(tagName) && !rawText.endsWith("\n")) rawText += "\n";
      ranges.set(node, { start, contentEnd, end: rawText.length });
    };
    visit(contentRoot);
    return { rawText, ranges };
  }

  function toTextOffset(rawOffset: number, leadingTrim: number, textLength: number): number {
    return Math.min(textLength, Math.max(0, rawOffset - leadingTrim));
  }

  function trimTextRange(text: string, start: number, end: number): { start: number; end: number; value: string } {
    const boundedStart = Math.min(text.length, Math.max(0, start));
    const boundedEnd = Math.min(text.length, Math.max(boundedStart, end));
    const value = text.slice(boundedStart, boundedEnd);
    const leadingTrim = value.length - value.trimStart().length;
    const trailingTrim = value.length - value.trimEnd().length;
    const trimmedStart = boundedStart + leadingTrim;
    const trimmedEnd = Math.max(trimmedStart, boundedEnd - trailingTrim);
    return {
      start: trimmedStart,
      end: trimmedEnd,
      value: text.slice(trimmedStart, trimmedEnd),
    };
  }

  function trimIndexedNodeRange(text: string, range: IndexedNodeRange, leadingTrim: number): { start: number; end: number; value: string } {
    return trimTextRange(
      text,
      toTextOffset(range.start, leadingTrim, text.length),
      toTextOffset(range.contentEnd, leadingTrim, text.length),
    );
  }

  function fallbackNodeRange(
    sourceDocument: Document,
    contentRoot: DocumentFragment | HTMLElement,
    element: Element,
    text: string,
    leadingTrim: number,
    indexedSource: IndexedSource,
  ): { start: number; end: number; value: string } {
    const start = offsetBefore(sourceDocument, contentRoot, element, text.length, leadingTrim, indexedSource);
    const endRange = sourceDocument.createRange();
    endRange.selectNodeContents(contentRoot);
    if (typeof endRange.setEndAfter === "function") {
      endRange.setEndAfter(element);
      return trimTextRange(
        text,
        start,
        toTextOffset(endRange.toString().length, leadingTrim, text.length),
      );
    }
    const elementText = typeof element.textContent === "string" ? element.textContent : "";
    const rawStart = start + leadingTrim;
    const rawEnd = rawStart + elementText.length;
    return trimTextRange(
      text,
      toTextOffset(rawStart, leadingTrim, text.length),
      toTextOffset(rawEnd, leadingTrim, text.length),
    );
  }

  function extractBlocks(
    sourceDocument: Document,
    contentRoot: DocumentFragment | HTMLElement,
    text: string,
    leadingTrim: number,
    indexedSource: IndexedSource,
  ): ReaderBlock[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const blockSelector = "h1, h2, h3, h4, h5, h6, p, blockquote, pre, li";
    return [...contentRoot.querySelectorAll(blockSelector)]
      .map((element) => {
        const parentBlock = element.parentElement?.closest?.(blockSelector);
        if (parentBlock && parentBlock !== contentRoot) return null;
        const indexedRange = indexedSource.ranges.get(element);
        const blockRange = indexedRange
          ? trimIndexedNodeRange(text, indexedRange, leadingTrim)
          : fallbackNodeRange(sourceDocument, contentRoot, element, text, leadingTrim, indexedSource);
        if (!blockRange.value) return null;
        const tagName = String(element.tagName || "p").toLowerCase();
        return {
          text: blockRange.value,
          kind: /^h[1-6]$/u.test(tagName) ? "heading" : tagName === "blockquote" ? "quote" : tagName === "pre" ? "preformatted" : "paragraph",
          level: /^h[1-6]$/u.test(tagName) ? Number(tagName.slice(1)) : null,
          start: blockRange.start,
          end: blockRange.end,
        };
      })
      .filter((block): block is ReaderBlock => block !== null);
  }

  function extractFigures(
    sourceDocument: Document,
    contentRoot: DocumentFragment | HTMLElement,
    text: string,
    leadingTrim: number,
    indexedSource: IndexedSource,
  ): ReaderFigure[] {
    if (typeof contentRoot.querySelectorAll !== "function") return [];
    const figures: ReaderFigure[] = [];
    for (const image of contentRoot.querySelectorAll("img")) {
      const container = image.closest?.("figure") || image;
      const src = String(image.currentSrc || image.src || image.getAttribute?.("src") || "").trim();
      if (!src || /^javascript:/iu.test(src)) continue;
      const indexedRange = indexedSource.ranges.get(container);
      const figureOffset = indexedRange
        ? toTextOffset(indexedRange.start, leadingTrim, text.length)
        : offsetBefore(sourceDocument, contentRoot, container, text.length, leadingTrim, indexedSource);
      const caption = (container.querySelector?.("figcaption")?.textContent || "").trim();
      const sourceEnd = indexedRange
        ? toTextOffset(indexedRange.contentEnd, leadingTrim, text.length)
        : fallbackFigureEnd(sourceDocument, contentRoot, container, figureOffset, text.length, leadingTrim, caption);
      const figure: ReaderFigure = {
        src,
        alt: (image.getAttribute?.("alt") || "").trim(),
        caption,
        sourceOffset: figureOffset,
        sourceEnd,
      };
      const srcset = optionalAttribute(image, "srcset");
      const sizes = optionalAttribute(image, "sizes");
      const width = positiveDimension(optionalAttribute(image, "width"));
      const height = positiveDimension(optionalAttribute(image, "height"));
      if (srcset !== undefined) figure.srcset = srcset;
      if (sizes !== undefined) figure.sizes = sizes;
      if (width !== undefined) figure.width = width;
      if (height !== undefined) figure.height = height;
      figures.push(figure);
    }
    return figures.sort((left, right) => left.sourceOffset - right.sourceOffset);
  }

  function optionalAttribute(element: Element, name: string): string | undefined {
    if (typeof element.hasAttribute === "function" && !element.hasAttribute(name)) return undefined;
    const value = element.getAttribute?.(name);
    return value === null || value === undefined ? undefined : String(value);
  }

  function positiveDimension(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  function fallbackFigureEnd(
    sourceDocument: Document,
    contentRoot: DocumentFragment | HTMLElement,
    container: Element,
    figureOffset: number,
    textLength: number,
    leadingTrim: number,
    caption: string,
  ): number {
    const endRange = sourceDocument.createRange();
    endRange.selectNodeContents(contentRoot);
    if (typeof endRange.setEndAfter === "function") {
      endRange.setEndAfter(container);
      return toTextOffset(endRange.toString().length, leadingTrim, textLength);
    }
    return Math.min(textLength, figureOffset + caption.length);
  }

  return { fromPage, fromPageAsync, fromText };
});
