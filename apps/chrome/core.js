(function installRsvpCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RsvpCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRsvpCore() {
  const MAX_WORDS_PER_UNIT = 7;
  const MAX_GRAPHEMES_PER_UNIT = 12;
  const MIN_WORDS_BEFORE_BOUNDARY = 3;
  const SOFT_BOUNDARY_WORDS = new Set(["を","に","へ","と","から","まで","より","が","は","も","て","で","ので","のに","なら","れば","けど","けれど"]);
  const PHRASE_BOUNDARY_PUNCTUATION = new Set(["、","，",";","；",":","："]);
  const SENTENCE_END_PUNCTUATION = new Set(["。","！","？","!","?"]);
  const QUOTE_PAIRS = new Map([["「","」"],["『","』"]]);
  const ASIDE_PAIRS = new Map([["（","）"],["(",")"]]);

  function graphemeCount(text, locale = "ja") {
    return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
  }

  function splitStructuralSpans(text) {
    const spans = [];
    let normalStart = 0;
    let index = 0;
    while (index < text.length) {
      const opener = text[index];
      const quoteCloser = QUOTE_PAIRS.get(opener);
      const asideCloser = ASIDE_PAIRS.get(opener);
      if (!quoteCloser && !asideCloser) { index += 1; continue; }
      const kind = quoteCloser ? "quote" : "aside";
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

  function segmentFlowSpan(text, sentenceIndex, absoluteStart, locale, kind, trackSentenceEnds) {
    if (!text) return { units: [], sentenceIndex };
    const pieces = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)];
    const units = [];
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
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
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

  function mergeDanglingPunctuation(units) {
    const merged = [];
    for (const unit of units) {
      if (merged.length > 0 && unit.sentenceIndex === merged[merged.length - 1].sentenceIndex && !/[\p{L}\p{N}]/u.test(unit.text)) {
        const previous = merged[merged.length - 1];
        previous.text += unit.text;
        previous.end = unit.end;
      } else merged.push({ ...unit });
    }
    return merged;
  }

  function splitLongUnits(units, locale = "ja", maxGraphemes = MAX_GRAPHEMES_PER_UNIT) {
    const limit = Math.max(1, Number.isInteger(maxGraphemes) ? maxGraphemes : MAX_GRAPHEMES_PER_UNIT);
    const graphemeSegmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
    const wordSegmenter = new Intl.Segmenter(locale, { granularity: "word" });
    const result = [];
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

  function segmentText(text, locale = "ja") {
    if (!text) return [];
    const units = [];
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
    return splitLongUnits(mergeDanglingPunctuation(units), locale);
  }

  function findPreviousSentenceStart(units, currentUnitIndex) {
    if (!Array.isArray(units) || units.length === 0) return 0;
    const safeIndex = Math.min(Math.max(Number.isInteger(currentUnitIndex) ? currentUnitIndex : 0, 0), units.length - 1);
    const currentSentenceIndex = units[safeIndex].sentenceIndex;
    const targetSentenceIndex = Math.max(0, currentSentenceIndex - 1);
    const targetIndex = units.findIndex((unit) => unit.sentenceIndex === targetSentenceIndex);
    return targetIndex === -1 ? 0 : targetIndex;
  }

  function findActiveHeadingIndex(transitions, currentOffset, fallbackIndex = -1) {
    let activeIndex = fallbackIndex;
    if (!Array.isArray(transitions)) return activeIndex;
    for (const transition of transitions) {
      if (Number.isInteger(transition?.offset) && Number.isInteger(transition?.headingIndex) && transition.offset <= currentOffset) activeIndex = transition.headingIndex;
    }
    return activeIndex;
  }

  function calculateReadingProgress(currentEnd, sourceLength) {
    if (!Number.isFinite(currentEnd) || !Number.isFinite(sourceLength) || sourceLength <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((currentEnd / sourceLength) * 100)));
  }

  return {
    MAX_WORDS_PER_UNIT,
    MAX_GRAPHEMES_PER_UNIT,
    segmentText,
    splitLongUnits,
    splitStructuralSpans,
    findPreviousSentenceStart,
    findActiveHeadingIndex,
    calculateReadingProgress,
  };
});
