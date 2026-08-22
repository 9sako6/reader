import assert from "node:assert/strict";
import { timingCorpus } from "./timing-corpus";

const Engine = require("../../../.build/packages/engine/src/engine.js");

function graphemeCount(text: string, locale: string): number {
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
}

function activeSectionAt(entry: {
  initialHeadingIndex: number;
  sectionTransitions: Array<{ offset: number; headingIndex: number }>;
}, offset: number): number {
  let activeHeadingIndex = entry.initialHeadingIndex;
  for (const transition of entry.sectionTransitions) {
    if (transition.offset <= offset) activeHeadingIndex = transition.headingIndex;
  }
  return activeHeadingIndex;
}

function durationSequence(entry: {
  locale: string;
  text: string;
  initialHeadingIndex: number;
  sectionTransitions: Array<{ offset: number; headingIndex: number }>;
}): number[] {
  const units = Engine.segmentText(entry.text, entry.locale);
  return units.map((unit: { text: string; sentenceIndex: number; start: number }, index: number) => {
    const nextUnit = units[index + 1];
    const sectionBreak = Boolean(
      nextUnit
      && activeSectionAt(entry, unit.start) !== activeSectionAt(entry, nextUnit.start),
    );
    return Engine.displayDuration(unit, nextUnit, sectionBreak);
  });
}

test("timing corpus stays repository-owned, categorized, and bounded", () => {
  assert.deepEqual(timingCorpus.map((entry) => entry.id), [
    "ja-general",
    "ja-technical",
    "ja-dialogue",
    "ja-short-sentences",
    "ja-long-sentence",
    "mixed-code-numbers",
    "en-general",
  ]);
  for (const entry of timingCorpus) {
    const graphemes = graphemeCount(entry.text, entry.locale);
    assert.ok(graphemes >= 300, `${entry.id} has fewer than 300 graphemes`);
    assert.ok(graphemes <= 1000, `${entry.id} has more than 1,000 graphemes`);
    assert.ok(entry.text.length > 0, `${entry.id} is empty`);
  }
});

test("Japanese general baseline stays near the calibrated reading speed", () => {
  const entry = timingCorpus.find(({ id }) => id === "ja-general");
  assert.ok(entry);
  const durationMs = durationSequence(entry).reduce((total, duration) => total + duration, 0);
  const speed = graphemeCount(entry.text, entry.locale) * 60_000 / durationMs;
  assert.ok(speed >= 925 && speed <= 950, `expected 925–950 graphemes/min, received ${speed}`);
});

test("explicit section transitions add a pause only when the next unit crosses one", () => {
  const entry = timingCorpus.find(({ id }) => id === "ja-technical");
  assert.ok(entry);
  assert.equal(entry.sectionTransitions.length, 4);
  const units = Engine.segmentText(entry.text, entry.locale);
  const crossingIndex = units.findIndex((unit: { start: number }, index: number) => {
    const nextUnit = units[index + 1];
    return Boolean(
      nextUnit
      && activeSectionAt(entry, unit.start) !== activeSectionAt(entry, nextUnit.start),
    );
  });
  assert.ok(crossingIndex >= 0);
  const crossingUnit = units[crossingIndex];
  const crossingNextUnit = units[crossingIndex + 1];
  assert.ok(crossingUnit);
  assert.ok(crossingNextUnit);
  assert.equal(
    Engine.displayDuration(crossingUnit, crossingNextUnit, true)
      - Engine.displayDuration(crossingUnit, crossingNextUnit, false),
    Engine.DEFAULT_TIMING_PROFILE.sectionPauseMs,
  );

  const nonCrossingIndex = crossingIndex > 0 ? crossingIndex - 1 : crossingIndex + 1;
  const nonCrossingUnit = units[nonCrossingIndex];
  const nonCrossingNextUnit = units[nonCrossingIndex + 1];
  assert.ok(nonCrossingUnit);
  assert.ok(nonCrossingNextUnit);
  const nonCrossingSectionBreak = activeSectionAt(entry, nonCrossingUnit.start)
    !== activeSectionAt(entry, nonCrossingNextUnit.start);
  assert.equal(nonCrossingSectionBreak, false);
  assert.equal(
    Engine.displayDuration(nonCrossingUnit, nonCrossingNextUnit, nonCrossingSectionBreak)
      - Engine.displayDuration(nonCrossingUnit, nonCrossingNextUnit, false),
    0,
  );
});

test("the same units and profile produce a deterministic duration sequence", () => {
  for (const entry of timingCorpus) {
    assert.deepEqual(durationSequence(entry), durationSequence(entry), entry.id);
  }
});
