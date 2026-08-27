import assert from "node:assert/strict";
import { timingCorpus } from "./timing-corpus";

const Engine = require("../../../.build/packages/engine/src/engine.js");

function graphemeCount(text: string, locale: string): number {
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
}

function spots(entry: {
  locale: string;
  text: string;
  initialHeadingIndex: number;
  sectionTransitions: Array<{ offset: number; headingIndex: number }>;
}, timingProfile = Engine.DEFAULT_TIMING_PROFILE) {
  const units = Engine.segmentText(entry.text, entry.locale);
  return Engine.buildSpots(units, {
    locale: entry.locale,
    maxWidth: 12,
    measureText: (text: string) => graphemeCount(text, entry.locale),
    sectionOffsets: entry.sectionTransitions.map(({ offset }) => offset),
    timingProfile,
  });
}

function durationSequence(entry: Parameters<typeof spots>[0]): number[] {
  return spots(entry).map(({ durationMs }: { durationMs: number }) => durationMs);
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

test("final spot timing adds section pauses at the owned transition boundaries", () => {
  const entry = timingCorpus.find(({ id }) => id === "ja-technical");
  assert.ok(entry);
  assert.equal(entry.sectionTransitions.length, 4);
  const withPauses = spots(entry);
  const withoutPauses = spots(entry, {
    ...Engine.DEFAULT_TIMING_PROFILE,
    sectionPauseMs: 0,
  });
  const deltas = withPauses.map((spot: { durationMs: number }, index: number) => (
    spot.durationMs - withoutPauses[index].durationMs
  ));
  assert.equal(deltas.filter((delta: number) => delta > 0).length, entry.sectionTransitions.length);
  assert.ok(deltas.every((delta: number) => delta === 0 || delta === Engine.DEFAULT_TIMING_PROFILE.sectionPauseMs));
});

test("the same units and profile produce a deterministic duration sequence", () => {
  for (const entry of timingCorpus) {
    assert.deepEqual(durationSequence(entry), durationSequence(entry), entry.id);
  }
});
