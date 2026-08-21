(function installEngine(root: typeof globalThis, factory: () => ReaderEngine) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Engine = api;
})(globalThis, function createEngine(): ReaderEngine {
  const MAX_WORDS_PER_UNIT = 7;
  const MAX_GRAPHEMES_PER_UNIT = 12;
  const MIN_WORDS_BEFORE_BOUNDARY = 3;
  const SOFT_BOUNDARY_WORDS = new Set(["を","に","へ","と","から","まで","より","が","は","も","て","で","ので","のに","なら","れば","けど","けれど"]);
  const PHRASE_BOUNDARY_PUNCTUATION = new Set(["、","，",";","；",":","："]);
  const SENTENCE_END_PUNCTUATION = new Set(["。","！","？","!","?"]);
  const QUOTE_PAIRS = new Map([["「","」"],["『","』"]]);
  const ASIDE_PAIRS = new Map([["（","）"],["(",")"]]);
  const BASE_UNIT_MS = 180;
  const MS_PER_GRAPHEME = 24;
  const MIN_UNIT_MS = 240;
  const MAX_UNIT_MS = 600;
  const CLAUSE_PAUSE_MS = 120;
  const SENTENCE_PAUSE_MS = 360;
  const SECTION_PAUSE_MS = 240;

  function graphemeCount(text: string, locale = "ja"): number {
    return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
  }

  function splitStructuralSpans(text: string): Array<{ text: string; kind: ReaderUnitKind; start: number }> {
    const spans: Array<{ text: string; kind: ReaderUnitKind; start: number }> = [];
    let normalStart = 0;
    let index = 0;
    while (index < text.length) {
      const opener = text[index];
      if (opener === undefined) break;
      const quoteCloser = QUOTE_PAIRS.get(opener);
      const asideCloser = ASIDE_PAIRS.get(opener);
      if (!quoteCloser && !asideCloser) { index += 1; continue; }
      const kind: ReaderUnitKind = quoteCloser ? "quote" : "aside";
      const closer = quoteCloser || asideCloser;
      let depth = 1;
      let end = index + 1;
      while (end < text.length) {
        if (kind === "aside" && text[end] === opener) depth += 1;
        if (text[end] === closer) {
          depth -= 1;
          if (depth === 0) { end += 1; break; }
        }
        end += 1;
      }
      if (depth !== 0) { index += 1; continue; }
      if (normalStart < index) spans.push({ text: text.slice(normalStart, index), kind: "body", start: normalStart });
      spans.push({ text: text.slice(index, end), kind, start: index });
      index = end;
      normalStart = end;
    }
    if (normalStart < text.length) spans.push({ text: text.slice(normalStart), kind: "body", start: normalStart });
    return spans;
  }

  function segmentFlowSpan(
    text: string,
    sentenceIndex: number,
    absoluteStart: number,
    locale: string,
    kind: ReaderUnitKind,
    trackSentenceEnds: boolean,
  ): { units: ReaderUnit[]; sentenceIndex: number } {
    if (!text) return { units: [], sentenceIndex };
    const pieces = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)];
    const units: ReaderUnit[] = [];
    let currentSentenceIndex = sentenceIndex;
    let unitText = "";
    let unitStart = absoluteStart;
    let unitEnd = absoluteStart;
    let wordLikeCount = 0;
    function flush() {
      if (!unitText) return;
      units.push({ text: unitText, sentenceIndex: currentSentenceIndex, kind, start: unitStart, end: unitEnd });
      unitText = "";
      wordLikeCount = 0;
    }
    for (const [index, piece] of pieces.entries()) {
      const next = pieces[index + 1];
      if (!unitText) unitStart = absoluteStart + piece.index;
      unitText += piece.segment;
      unitEnd = absoluteStart + piece.index + piece.segment.length;
      if (piece.isWordLike) wordLikeCount += 1;
      const nextIsWordLike = Boolean(next?.isWordLike);
      const phraseBoundary = PHRASE_BOUNDARY_PUNCTUATION.has(piece.segment);
      const sentenceBoundary = trackSentenceEnds && SENTENCE_END_PUNCTUATION.has(piece.segment);
      const grammaticalBoundary = piece.isWordLike && SOFT_BOUNDARY_WORDS.has(piece.segment) && wordLikeCount >= MIN_WORDS_BEFORE_BOUNDARY && nextIsWordLike;
      const lengthBoundary = piece.isWordLike && wordLikeCount >= MAX_WORDS_PER_UNIT && nextIsWordLike;
      if (phraseBoundary || sentenceBoundary || grammaticalBoundary || lengthBoundary) flush();
      if (sentenceBoundary) currentSentenceIndex += 1;
    }
    flush();
    return { units, sentenceIndex: currentSentenceIndex };
  }

  function mergeDanglingPunctuation(units: ReaderUnit[]): ReaderUnit[] {
    const merged: ReaderUnit[] = [];
    for (const unit of units) {
      const previous = merged.at(-1);
      if (previous && unit.sentenceIndex === previous.sentenceIndex && !/[\p{L}\p{N}]/u.test(unit.text)) {
        previous.text += unit.text;
        previous.end = unit.end;
      } else merged.push({ ...unit });
    }
    return merged;
  }

  function splitLongUnits(units: ReaderUnit[], locale = "ja", maxGraphemes = MAX_GRAPHEMES_PER_UNIT): ReaderUnit[] {
    const limit = Math.max(1, Number.isInteger(maxGraphemes) ? maxGraphemes : MAX_GRAPHEMES_PER_UNIT);
    const graphemeSegmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
    const wordSegmenter = new Intl.Segmenter(locale, { granularity: "word" });
    const result: ReaderUnit[] = [];
    for (const unit of units) {
      const graphemes = [...graphemeSegmenter.segment(unit.text)];
      if (graphemes.length <= limit) { result.push({ ...unit }); continue; }

      let partStart = 0;
      let partEnd = 0;
      let partHasWord = false;
      for (const piece of wordSegmenter.segment(unit.text)) {
        const pieceEnd = piece.index + piece.segment.length;
        const candidate = unit.text.slice(partStart, pieceEnd);
        const exceedsLimit = graphemeCount(candidate, locale) > limit;

        if (piece.isWordLike && partHasWord && exceedsLimit) {
          result.push({ ...unit, text: unit.text.slice(partStart, partEnd), start: unit.start + partStart, end: unit.start + partEnd });
          partStart = piece.index;
          partHasWord = false;
        }

        partEnd = pieceEnd;
        if (piece.isWordLike) partHasWord = true;
      }

      if (partStart < partEnd) {
        result.push({ ...unit, text: unit.text.slice(partStart, partEnd), start: unit.start + partStart, end: unit.start + partEnd });
      }
    }
    return result;
  }

  function segmentText(text: string, locale = "ja", boundaries: number[] = []): ReaderUnit[] {
    if (!text) return [];
    const units: ReaderUnit[] = [];
    let sentenceIndex = 0;
    for (const span of splitStructuralSpans(text)) {
      if (span.kind === "quote") {
        units.push({ text: span.text, sentenceIndex, kind: "quote", start: span.start, end: span.start + span.text.length });
        continue;
      }
      const result = segmentFlowSpan(
        span.text,
        sentenceIndex,
        span.start,
        locale,
        span.kind,
        span.kind === "body",
      );
      units.push(...result.units);
      sentenceIndex = result.sentenceIndex;
    }
    const segmentedUnits = splitLongUnits(mergeDanglingPunctuation(units), locale);
    const safeBoundaries = [...new Set(boundaries)]
      .filter((boundary) => Number.isInteger(boundary) && boundary > 0 && boundary < text.length)
      .sort((left, right) => left - right);
    if (safeBoundaries.length === 0) return segmentedUnits;
    return segmentedUnits.flatMap((unit) => {
      const unitBoundaries = safeBoundaries.filter((boundary) => boundary > unit.start && boundary < unit.end);
      if (unitBoundaries.length === 0) return [unit];
      const pieces: ReaderUnit[] = [];
      let start = unit.start;
      for (const boundary of [...unitBoundaries, unit.end]) {
        pieces.push({
          ...unit,
          text: text.slice(start, boundary),
          start,
          end: boundary,
        });
        start = boundary;
      }
      return pieces;
    });
  }

  function findSentenceStart(units: ReaderUnit[], currentUnitIndex: number): number {
    if (!Array.isArray(units) || units.length === 0) return 0;
    const safeIndex = Math.min(Math.max(Number.isInteger(currentUnitIndex) ? currentUnitIndex : 0, 0), units.length - 1);
    const sentenceIndex = units[safeIndex]?.sentenceIndex;
    if (sentenceIndex === undefined) return 0;
    const sentenceStart = units.findIndex((unit) => unit.sentenceIndex === sentenceIndex);
    return sentenceStart < 0 ? 0 : sentenceStart;
  }

  function findPreviousSentenceStart(units: ReaderUnit[], currentUnitIndex: number): number {
    if (!Array.isArray(units) || units.length === 0) return 0;
    const safeIndex = Math.min(Math.max(Number.isInteger(currentUnitIndex) ? currentUnitIndex : 0, 0), units.length - 1);
    const currentUnit = units[safeIndex];
    if (!currentUnit) return 0;
    const currentSentenceIndex = currentUnit.sentenceIndex;
    const targetSentenceIndex = Math.max(0, currentSentenceIndex - 1);
    const targetIndex = units.findIndex((unit) => unit.sentenceIndex === targetSentenceIndex);
    return targetIndex === -1 ? 0 : targetIndex;
  }

  function findActiveHeadingIndex(transitions: ReaderSectionTransition[], currentOffset: number, fallbackIndex = -1): number {
    let activeIndex = fallbackIndex;
    if (!Array.isArray(transitions)) return activeIndex;
    for (const transition of transitions) {
      if (Number.isInteger(transition?.offset) && Number.isInteger(transition?.headingIndex) && transition.offset <= currentOffset) activeIndex = transition.headingIndex;
    }
    return activeIndex;
  }

  function calculateReadingProgress(currentEnd: number, sourceLength: number): number {
    if (!Number.isFinite(currentEnd) || !Number.isFinite(sourceLength) || sourceLength <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((currentEnd / sourceLength) * 100)));
  }

  function findUnitIndex(units: ReaderUnit[], offset: number): number {
    if (!Array.isArray(units) || units.length === 0) return 0;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const containingIndex = units.findIndex((unit) => unit.start <= safeOffset && unit.end > safeOffset);
    if (containingIndex >= 0) return containingIndex;
    for (let index = units.length - 1; index >= 0; index -= 1) {
      const unit = units[index];
      if (unit && unit.start <= safeOffset) return index;
    }
    return 0;
  }

  function surroundingSentences(units: ReaderUnit[], currentIndex: number): { previous: string; next: string } {
    if (!Array.isArray(units) || units.length === 0) return { previous: "", next: "" };
    const safeIndex = Math.min(Math.max(Number.isInteger(currentIndex) ? currentIndex : 0, 0), units.length - 1);
    const sentenceOrder: number[] = [];
    const sentenceTexts = new Map<number, string>();
    for (const unit of units) {
      if (!sentenceTexts.has(unit.sentenceIndex)) sentenceOrder.push(unit.sentenceIndex);
      sentenceTexts.set(unit.sentenceIndex, `${sentenceTexts.get(unit.sentenceIndex) || ""}${unit.text}`);
    }
    const currentUnit = units[safeIndex];
    if (!currentUnit) return { previous: "", next: "" };
    const sentencePosition = sentenceOrder.indexOf(currentUnit.sentenceIndex);
    const previousSentenceIndex = sentenceOrder[sentencePosition - 1];
    const nextSentenceIndex = sentenceOrder[sentencePosition + 1];
    return {
      previous: sentencePosition > 0 && previousSentenceIndex !== undefined
        ? sentenceTexts.get(previousSentenceIndex)?.trim() ?? ""
        : "",
      next: sentencePosition >= 0 && nextSentenceIndex !== undefined
        ? sentenceTexts.get(nextSentenceIndex)?.trim() ?? ""
        : "",
    };
  }

  function displayDuration(
    unit: Pick<ReaderUnit, "text" | "sentenceIndex">,
    nextUnit?: Pick<ReaderUnit, "sentenceIndex">,
    sectionBreak = false,
  ): number {
    const graphemes = graphemeCount(unit?.text || "");
    let duration = Math.min(MAX_UNIT_MS, Math.max(MIN_UNIT_MS, BASE_UNIT_MS + graphemes * MS_PER_GRAPHEME));
    if (/[、，;；:：]\s*$/u.test(unit?.text || "")) duration += CLAUSE_PAUSE_MS;
    if (nextUnit?.sentenceIndex !== undefined && nextUnit.sentenceIndex !== unit?.sentenceIndex) duration += SENTENCE_PAUSE_MS;
    if (sectionBreak) duration += SECTION_PAUSE_MS;
    return duration;
  }

  function sourceOffsetAtViewportCenter(blocks: ReaderOffsetBlock[], viewportCenter: number): number {
    if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(viewportCenter)) return 0;
    let closest = blocks[0];
    if (!closest) return 0;
    let closestDistance = Infinity;
    for (const block of blocks) {
      const top = Number(block.top);
      const bottom = Number(block.bottom);
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      if (top <= viewportCenter && bottom >= viewportCenter) {
        const ratio = bottom > top ? (viewportCenter - top) / (bottom - top) : 0;
        return Math.round(block.start + (block.end - block.start) * ratio);
      }
      const distance = Math.min(Math.abs(viewportCenter - top), Math.abs(viewportCenter - bottom));
      if (distance < closestDistance) {
        closest = block;
        closestDistance = distance;
      }
    }
    return viewportCenter < Number(closest.top) ? closest.start : closest.end;
  }

  function findBlockIndexForOffset(blocks: ReaderOffsetBlock[], offset: number): number {
    if (!Array.isArray(blocks) || blocks.length === 0) return -1;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const containingIndex = blocks.findIndex((block) => block.start <= safeOffset && block.end >= safeOffset);
    if (containingIndex >= 0) return containingIndex;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block && block.start <= safeOffset) return index;
    }
    return 0;
  }

  return {
    MAX_WORDS_PER_UNIT,
    MAX_GRAPHEMES_PER_UNIT,
    segmentText,
    splitLongUnits,
    splitStructuralSpans,
    findSentenceStart,
    findPreviousSentenceStart,
    findActiveHeadingIndex,
    calculateReadingProgress,
    findUnitIndex,
    surroundingSentences,
    displayDuration,
    sourceOffsetAtViewportCenter,
    findBlockIndexForOffset,
  };
});
