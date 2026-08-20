(function installReaderSession(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReaderSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReaderSession() {
  const BASE_UNIT_MS = 180;
  const MS_PER_GRAPHEME = 24;
  const MIN_UNIT_MS = 240;
  const MAX_UNIT_MS = 600;
  const CLAUSE_PAUSE_MS = 120;
  const SENTENCE_PAUSE_MS = 360;
  const SECTION_PAUSE_MS = 240;
  function findUnitIndex(units, offset) {
    if (!Array.isArray(units) || units.length === 0) return 0;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const containingIndex = units.findIndex((unit) => unit.start <= safeOffset && unit.end > safeOffset);
    if (containingIndex >= 0) return containingIndex;
    for (let index = units.length - 1; index >= 0; index -= 1) {
      if (units[index].start <= safeOffset) return index;
    }
    return 0;
  }

  function surroundingSentences(units, currentIndex) {
    if (!Array.isArray(units) || units.length === 0) return { previous: "", next: "" };
    const safeIndex = Math.min(Math.max(Number.isInteger(currentIndex) ? currentIndex : 0, 0), units.length - 1);
    const sentenceOrder = [];
    const sentenceTexts = new Map();
    for (const unit of units) {
      if (!sentenceTexts.has(unit.sentenceIndex)) sentenceOrder.push(unit.sentenceIndex);
      sentenceTexts.set(unit.sentenceIndex, `${sentenceTexts.get(unit.sentenceIndex) || ""}${unit.text}`);
    }
    const sentencePosition = sentenceOrder.indexOf(units[safeIndex].sentenceIndex);
    return {
      previous: sentencePosition > 0 ? sentenceTexts.get(sentenceOrder[sentencePosition - 1]).trim() : "",
      next: sentencePosition >= 0 && sentencePosition < sentenceOrder.length - 1
        ? sentenceTexts.get(sentenceOrder[sentencePosition + 1]).trim()
        : "",
    };
  }

  function displayDuration(unit, nextUnit, sectionBreak = false) {
    const graphemes = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(unit?.text || "")].length;
    let duration = Math.min(MAX_UNIT_MS, Math.max(MIN_UNIT_MS, BASE_UNIT_MS + graphemes * MS_PER_GRAPHEME));
    if (/[、，;；:：]\s*$/u.test(unit?.text || "")) duration += CLAUSE_PAUSE_MS;
    if (nextUnit?.sentenceIndex !== undefined && nextUnit.sentenceIndex !== unit?.sentenceIndex) {
      duration += SENTENCE_PAUSE_MS;
    }
    if (sectionBreak) duration += SECTION_PAUSE_MS;
    return duration;
  }

  function sourceOffsetAtViewportCenter(blocks, viewportCenter) {
    if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(viewportCenter)) return 0;
    let closest = blocks[0];
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
    return viewportCenter < closest.top ? closest.start : closest.end;
  }

  function findBlockIndexForOffset(blocks, offset) {
    if (!Array.isArray(blocks) || blocks.length === 0) return -1;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const containingIndex = blocks.findIndex((block) => block.start <= safeOffset && block.end >= safeOffset);
    if (containingIndex >= 0) return containingIndex;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index].start <= safeOffset) return index;
    }
    return 0;
  }

  return {
    findUnitIndex,
    surroundingSentences,
    displayDuration,
    sourceOffsetAtViewportCenter,
    findBlockIndexForOffset,
  };
});
