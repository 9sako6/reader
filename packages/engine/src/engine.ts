type EngineCodeRange = import("../../extractor/src/types").ReaderCodeRange;
type EngineFigure = import("../../extractor/src/types").ReaderFigure;
type EngineSectionTransition = import("../../extractor/src/types").ReaderSectionTransition;

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
  const LINE_START_CLOSING_PUNCTUATION = new Set(["、","。","，","．","！","？","!","?","）",")","」","』","】","]","〉","》","〕","］","｝","}"]);
  const LINE_END_OPENING_PUNCTUATION = new Set(["（","(","「","『","【","[","〈","《","〔","［","｛","{"]);
  const QUOTE_PAIRS = new Map([["「","」"],["『","』"]]);
  const ASIDE_PAIRS = new Map([["（","）"],["(",")"]]);
  const SENTENCE_LEADING_OPENERS = new Set(["「", "『", "（", "(", "【", "〈", "《"]);
  const DEFAULT_TIMING_PROFILE: Readonly<ReaderTimingProfile> = Object.freeze({
    baseUnitMs: 180,
    msPerGrapheme: 24,
    minUnitMs: 240,
    maxUnitMs: 600,
    clausePauseMs: 120,
    sentencePauseMs: 360,
    sectionPauseMs: 240,
    speedMultiplier: 1,
  });

  function graphemeCount(text: string, locale = "ja"): number {
    return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
  }

  function splitSentenceSpans(text: string, locale = "ja"): SentenceSpan[] {
    if (!text) return [];
    const sentenceSegments = [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text)];
    const boundaries = new Set<number>();
    for (const segment of sentenceSegments) boundaries.add(segment.index + segment.segment.length);
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\n") boundaries.add(index + 1);
    }
    boundaries.add(text.length);

    const sortedBoundaries = [...boundaries]
      .filter((boundary) => boundary > 0 && boundary <= text.length)
      .sort((left, right) => left - right);
    const spans: SentenceSpan[] = [];
    let start = 0;
    for (const boundary of sortedBoundaries) {
      let end = boundary;
      while (end > start && SENTENCE_LEADING_OPENERS.has(text[end - 1] || "")) end -= 1;
      if (end > start) spans.push({ start, end, sentenceIndex: spans.length });
      start = end;
    }
    if (start < text.length) {
      spans.push({ start, end: text.length, sentenceIndex: spans.length });
    }
    return spans;
  }

  function splitStructuralSpans(text: string): Array<{ text: string; kind: ReaderUnitKind; start: number; end: number }> {
    const spans: Array<{ text: string; kind: ReaderUnitKind; start: number; end: number }> = [];
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
      if (normalStart < index) spans.push({ text: text.slice(normalStart, index), kind: "body", start: normalStart, end: index });
      spans.push({ text: text.slice(index, end), kind, start: index, end });
      index = end;
      normalStart = end;
    }
    if (normalStart < text.length) spans.push({ text: text.slice(normalStart), kind: "body", start: normalStart, end: text.length });
    return spans;
  }

  function segmentFlowSpan(
    text: string,
    sentenceIndex: number,
    absoluteStart: number,
    locale: string,
    kind: ReaderUnitKind,
  ): ReaderUnit[] {
    if (!text) return [];
    const pieces = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)];
    const units: ReaderUnit[] = [];
    let unitText = "";
    let unitStart = absoluteStart;
    let unitEnd = absoluteStart;
    let wordLikeCount = 0;
    function flush() {
      if (!unitText) return;
      units.push({ text: unitText, sentenceIndex, kind, start: unitStart, end: unitEnd });
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
      const grammaticalBoundary = piece.isWordLike && SOFT_BOUNDARY_WORDS.has(piece.segment) && wordLikeCount >= MIN_WORDS_BEFORE_BOUNDARY && nextIsWordLike;
      const lengthBoundary = kind !== "quote" && piece.isWordLike && wordLikeCount >= MAX_WORDS_PER_UNIT && nextIsWordLike;
      if (phraseBoundary || (kind === "body" && grammaticalBoundary) || lengthBoundary) flush();
    }
    flush();
    return units;
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
    return units.flatMap((unit) => unit.kind === "code" ? [{ ...unit }] : splitUnitAtGraphemeLimit(unit, locale, limit));
  }

  function preserveCodeRanges(units: ReaderUnit[], text: string, ranges: EngineCodeRange[]): ReaderUnit[] {
    if (!Array.isArray(units) || !Array.isArray(ranges) || ranges.length === 0) return [...units];
    const safeRanges = ranges
      .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end) && range.start >= 0 && range.end > range.start && range.end <= text.length)
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .filter((range, index, all) => index === 0 || range.start >= (all[index - 1]?.end ?? 0));
    if (safeRanges.length === 0) return [...units];
    const preserved: ReaderUnit[] = [];
    for (const unit of units) {
      if (safeRanges.some((range) => unit.start >= range.start && unit.end <= range.end)) continue;
      preserved.push({ ...unit });
    }
    for (const range of safeRanges) {
      const overlapping = units.find((unit) => unit.end > range.start && unit.start < range.end);
      preserved.push({
        text: text.slice(range.start, range.end),
        sentenceIndex: overlapping?.sentenceIndex ?? 0,
        kind: "code",
        start: range.start,
        end: range.end,
      });
    }
    return preserved.sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function splitUnitAtGraphemeLimit(unit: ReaderUnit, locale: string, limit: number): ReaderUnit[] {
    const graphemes = [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(unit.text)];
    if (graphemes.length <= limit) return [{ ...unit }];

    const graphemeIndexByOffset = new Map<number, number>([
      ...graphemes.map((piece, index) => [piece.index, index] as const),
      [unit.text.length, graphemes.length],
    ]);
    const wordBoundaries = new Set<number>();
    for (const piece of new Intl.Segmenter(locale, { granularity: "word" }).segment(unit.text)) {
      if (piece.index > 0) wordBoundaries.add(piece.index);
      const pieceEnd = piece.index + piece.segment.length;
      wordBoundaries.add(pieceEnd);
    }

    const partRanges: Array<{ start: number; end: number }> = [];
    let graphemeStart = 0;
    while (graphemeStart < graphemes.length) {
      const candidateGraphemeEnd = Math.min(graphemes.length, graphemeStart + limit);
      const start = graphemes[graphemeStart]?.index ?? unit.text.length;
      const candidateEnd = candidateGraphemeEnd === graphemes.length
        ? unit.text.length
        : graphemes[candidateGraphemeEnd]?.index ?? unit.text.length;
      const wordBoundary = [...wordBoundaries]
        .filter((offset) => offset > start && offset <= candidateEnd && graphemeIndexByOffset.has(offset))
        .sort((left, right) => right - left)[0];
      const end = wordBoundary ?? candidateEnd;
      const endGrapheme = graphemeIndexByOffset.get(end) ?? candidateGraphemeEnd;
      const safeEndGrapheme = endGrapheme > graphemeStart ? endGrapheme : candidateGraphemeEnd;
      const safeEnd = safeEndGrapheme === graphemes.length
        ? unit.text.length
        : graphemes[safeEndGrapheme]?.index ?? candidateEnd;

      partRanges.push({ start: graphemeStart, end: safeEndGrapheme });
      graphemeStart = safeEndGrapheme;
    }
    for (let index = 1; index < partRanges.length; index += 1) {
      const previous = partRanges[index - 1];
      const current = partRanges[index];
      if (!previous || !current) continue;
      const startsWithClosingPunctuation = LINE_START_CLOSING_PUNCTUATION.has(
        graphemes[current.start]?.segment || "",
      );
      const endsWithOpeningPunctuation = LINE_END_OPENING_PUNCTUATION.has(
        graphemes[previous.end - 1]?.segment || "",
      );
      if ((!startsWithClosingPunctuation && !endsWithOpeningPunctuation) || previous.end - previous.start <= 1) continue;

      previous.end -= 1;
      current.start -= 1;
      if (current.end - current.start > limit) {
        const overflow = { start: current.start + limit, end: current.end };
        current.end = current.start + limit;
        partRanges.splice(index + 1, 0, overflow);
      }
    }
    const parts = partRanges.map(({ start, end }) => ({
      ...unit,
      text: unit.text.slice(
        start === graphemes.length ? unit.text.length : graphemes[start]?.index ?? unit.text.length,
        end === graphemes.length ? unit.text.length : graphemes[end]?.index ?? unit.text.length,
      ),
      start: unit.start + (start === graphemes.length ? unit.text.length : graphemes[start]?.index ?? unit.text.length),
      end: unit.start + (end === graphemes.length ? unit.text.length : graphemes[end]?.index ?? unit.text.length),
    }));
    return parts.reduce<ReaderUnit[]>((merged, part) => {
      const previous = merged.at(-1);
      if (
        previous
        && previous.sentenceIndex === part.sentenceIndex
        && !/[\p{L}\p{N}]/u.test(part.text)
        && graphemeCount(`${previous.text}${part.text}`, locale) <= limit
      ) {
        previous.text += part.text;
        previous.end = part.end;
      } else merged.push(part);
      return merged;
    }, []);
  }

  function segmentText(text: string, locale = "ja", boundaries: number[] = []): ReaderUnit[] {
    if (!text) return [];
    const units: ReaderUnit[] = [];
    const sentenceSpans = splitSentenceSpans(text, locale).map((span) => ({ ...span }));
    for (let index = 0; index < sentenceSpans.length - 1; index += 1) {
      const current = sentenceSpans[index];
      const next = sentenceSpans[index + 1];
      if (!current || !next) continue;
      let boundary = current.end;
      while (boundary > current.start && /[^\S\r\n]/u.test(text[boundary - 1] || "")) boundary -= 1;
      current.end = boundary;
      next.start = boundary;
    }
    const structuralSpans = splitStructuralSpans(text);
    for (const sentenceSpan of sentenceSpans) {
      for (const structuralSpan of structuralSpans) {
        const start = Math.max(sentenceSpan.start, structuralSpan.start);
        const end = Math.min(sentenceSpan.end, structuralSpan.end);
        if (start >= end) continue;
        units.push(...segmentFlowSpan(
          text.slice(start, end),
          sentenceSpan.sentenceIndex,
          start,
          locale,
          structuralSpan.kind,
        ));
      }
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

  function buildReadingFlow(units: ReaderUnit[], figures: EngineFigure[]): ReaderFlowItem[] {
    const items: Array<ReaderFlowItem & { order: number }> = [];
    for (const [unitIndex, unit] of (Array.isArray(units) ? units : []).entries()) {
      if (!unit) continue;
      items.push({
        kind: "unit",
        sourceOffset: unit.start,
        unitIndex,
        order: unitIndex,
      });
    }
    for (const [figureIndex, figure] of (Array.isArray(figures) ? figures : []).entries()) {
      if (!figure) continue;
      items.push({
        kind: "figure",
        sourceOffset: figure.sourceOffset,
        figureIndex,
        order: figureIndex,
      });
    }
    return items
      .sort((left, right) => (
        left.sourceOffset - right.sourceOffset
        || (left.kind === right.kind ? left.order - right.order : left.kind === "figure" ? -1 : 1)
      ))
      .map(({ order: _order, ...item }) => item);
  }

  function positionForFlowItem(flowItem: ReaderFlowItem, units: ReaderUnit[]): ReaderPosition {
    if (flowItem.kind === "figure") {
      return {
        kind: "figure",
        sourceOffset: flowItem.sourceOffset,
        figureIndex: flowItem.figureIndex,
      };
    }
    return {
      kind: "text",
      sourceOffset: units[flowItem.unitIndex]?.start ?? flowItem.sourceOffset,
    };
  }

  function findActiveHeadingIndex(transitions: EngineSectionTransition[], currentOffset: number, fallbackIndex = -1): number {
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

  function normalizeTimingProfile(profile?: Partial<ReaderTimingProfile>): ReaderTimingProfile {
    const candidate = profile && typeof profile === "object" ? profile : {};
    const nonNegativeFinite = (value: unknown, fallback: number): number => (
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
    );
    const speedMultiplier = (
      typeof candidate.speedMultiplier === "number"
      && Number.isFinite(candidate.speedMultiplier)
      && candidate.speedMultiplier > 0
    )
      ? candidate.speedMultiplier
      : DEFAULT_TIMING_PROFILE.speedMultiplier;
    const minUnitMs = nonNegativeFinite(candidate.minUnitMs, DEFAULT_TIMING_PROFILE.minUnitMs);
    const maxUnitMs = nonNegativeFinite(candidate.maxUnitMs, DEFAULT_TIMING_PROFILE.maxUnitMs);
    const boundedUnitRange = minUnitMs <= maxUnitMs
      ? { minUnitMs, maxUnitMs }
      : {
        minUnitMs: DEFAULT_TIMING_PROFILE.minUnitMs,
        maxUnitMs: DEFAULT_TIMING_PROFILE.maxUnitMs,
      };
    return {
      baseUnitMs: nonNegativeFinite(candidate.baseUnitMs, DEFAULT_TIMING_PROFILE.baseUnitMs),
      msPerGrapheme: nonNegativeFinite(candidate.msPerGrapheme, DEFAULT_TIMING_PROFILE.msPerGrapheme),
      minUnitMs: boundedUnitRange.minUnitMs,
      maxUnitMs: boundedUnitRange.maxUnitMs,
      clausePauseMs: nonNegativeFinite(candidate.clausePauseMs, DEFAULT_TIMING_PROFILE.clausePauseMs),
      sentencePauseMs: nonNegativeFinite(candidate.sentencePauseMs, DEFAULT_TIMING_PROFILE.sentencePauseMs),
      sectionPauseMs: nonNegativeFinite(candidate.sectionPauseMs, DEFAULT_TIMING_PROFILE.sectionPauseMs),
      speedMultiplier,
    };
  }

  function displayDuration(
    unit: Pick<ReaderUnit, "text" | "sentenceIndex">,
    nextUnit?: Pick<ReaderUnit, "sentenceIndex">,
    sectionBreak = false,
    profile?: ReaderTimingProfile,
  ): number {
    const timing = normalizeTimingProfile(profile);
    const graphemes = graphemeCount(unit?.text || "");
    const base = Math.min(
      timing.maxUnitMs,
      Math.max(timing.minUnitMs, timing.baseUnitMs + graphemes * timing.msPerGrapheme),
    );
    let total = base;
    if (/[、，;；:：]\s*$/u.test(unit?.text || "")) total += timing.clausePauseMs;
    if (nextUnit?.sentenceIndex !== undefined && nextUnit.sentenceIndex !== unit?.sentenceIndex) {
      total += timing.sentencePauseMs;
    }
    if (sectionBreak) total += timing.sectionPauseMs;
    return Math.max(1, Math.round(total / timing.speedMultiplier));
  }

  return {
    MAX_GRAPHEMES_PER_UNIT,
    DEFAULT_TIMING_PROFILE,
    segmentText,
    splitSentenceSpans,
    splitLongUnits,
    preserveCodeRanges,
    buildReadingFlow,
    positionForFlowItem,
    findActiveHeadingIndex,
    calculateReadingProgress,
    findUnitIndex,
    surroundingSentences,
    displayDuration,
  };
});
