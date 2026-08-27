import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { timingCorpus } from "../packages/engine/tests/timing-corpus.mjs";

const require = createRequire(import.meta.url);
const Engine = require("../.build/packages/engine/src/engine.js");
const repositoryRoot = resolve(import.meta.dirname, "..");
const outputPath = resolve(repositoryRoot, "artifacts/timing/reader-timing.json");
const profile = Engine.DEFAULT_TIMING_PROFILE;

function graphemeCount(text, locale) {
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].length;
}

function wordCount(text, locale) {
  if (locale !== "en") return null;
  return [...new Intl.Segmenter("en", { granularity: "word" }).segment(text)]
    .filter((segment) => segment.isWordLike)
    .length;
}

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered.length === 0) return 0;
  const position = (ordered.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower] || 0;
  const lowerValue = ordered[lower] || 0;
  const upperValue = ordered[upper] || 0;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function activeSectionAt(entry, offset) {
  let activeHeadingIndex = entry.initialHeadingIndex;
  for (const transition of entry.sectionTransitions) {
    if (transition.offset <= offset) activeHeadingIndex = transition.headingIndex;
  }
  return activeHeadingIndex;
}

function timingForCorpus(entry) {
  const readerUnits = Engine.segmentText(entry.text, entry.locale);
  const spots = Engine.buildSpots(readerUnits, {
    locale: entry.locale,
    maxWidth: 12,
    measureText: (text) => graphemeCount(text, entry.locale),
    sectionOffsets: entry.sectionTransitions.map(({ offset }) => offset),
  });
  const zeroPauseProfile = {
    ...profile,
    clausePauseMs: 0,
    sentencePauseMs: 0,
    sectionPauseMs: 0,
  };
  const unboundedProfile = {
    ...zeroPauseProfile,
    minUnitMs: 0,
    maxUnitMs: Number.MAX_SAFE_INTEGER,
  };
  let sectionBreakCount = 0;
  let minClampedCount = 0;
  let maxClampedCount = 0;
  let clausePauseMs = 0;
  let sentencePauseMs = 0;
  let sectionPauseMs = 0;
  const durations = spots.map((spot, index) => {
    const nextSpot = spots[index + 1];
    const sectionBreak = Boolean(
      nextSpot
      && activeSectionAt(entry, spot.start) !== activeSectionAt(entry, nextSpot.start),
    );
    if (sectionBreak) sectionBreakCount += 1;

    const rawBaseDuration = Engine.displayDuration(spot, undefined, false, unboundedProfile);
    const boundedBaseDuration = Engine.displayDuration(spot, undefined, false, zeroPauseProfile);
    if (rawBaseDuration < profile.minUnitMs) minClampedCount += 1;
    if (rawBaseDuration > profile.maxUnitMs) maxClampedCount += 1;

    const baseWithoutPauses = Engine.displayDuration(spot, nextSpot, sectionBreak, zeroPauseProfile);
    const fullDuration = Engine.displayDuration(spot, nextSpot, sectionBreak, profile);
    const withClause = Engine.displayDuration(spot, { sentenceIndex: spot.sentenceIndex }, false, profile);
    const withoutClause = Engine.displayDuration(
      spot,
      { sentenceIndex: spot.sentenceIndex },
      false,
      { ...profile, clausePauseMs: 0 },
    );
    const withSentence = Engine.displayDuration(spot, nextSpot, false, profile);
    const withoutSentence = Engine.displayDuration(
      spot,
      nextSpot,
      false,
      { ...profile, sentencePauseMs: 0 },
    );
    const withSection = Engine.displayDuration(spot, nextSpot, sectionBreak, profile);
    const withoutSection = Engine.displayDuration(
      spot,
      nextSpot,
      sectionBreak,
      { ...profile, sectionPauseMs: 0 },
    );
    clausePauseMs += Math.max(0, withClause - withoutClause);
    sentencePauseMs += Math.max(0, withSentence - withoutSentence);
    sectionPauseMs += Math.max(0, withSection - withoutSection);

    if (fullDuration < baseWithoutPauses) {
      throw new Error(`duration decreased for ${entry.id} at spot ${index}`);
    }
    if (boundedBaseDuration < 1) {
      throw new Error(`non-positive duration for ${entry.id} at spot ${index}`);
    }
    return fullDuration;
  });
  const totalDurationMs = durations.reduce((total, duration) => total + duration, 0);
  const graphemes = graphemeCount(entry.text, entry.locale);
  const words = wordCount(entry.text, entry.locale);
  const minutes = totalDurationMs / 60_000;
  return {
    id: entry.id,
    locale: entry.locale,
    graphemes,
    words,
    spots: spots.length,
    totalDurationMs,
    charactersPerMinute: minutes > 0 ? graphemes / minutes : 0,
    wordsPerMinute: words === null || minutes <= 0 ? null : words / minutes,
    durationP50Ms: percentile(durations, 0.5),
    durationP90Ms: percentile(durations, 0.9),
    minClampRate: spots.length > 0 ? minClampedCount / spots.length : 0,
    maxClampRate: spots.length > 0 ? maxClampedCount / spots.length : 0,
    pauseShare: {
      clause: totalDurationMs > 0 ? clausePauseMs / totalDurationMs : 0,
      sentence: totalDurationMs > 0 ? sentencePauseMs / totalDurationMs : 0,
      section: totalDurationMs > 0 ? sectionPauseMs / totalDurationMs : 0,
    },
    sectionBreaks: sectionBreakCount,
  };
}

const corpus = timingCorpus.map(timingForCorpus);
const report = { profile, corpus };
await mkdir(resolve(repositoryRoot, "artifacts/timing"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const columns = [
  ["id", "id"],
  ["locale", "locale"],
  ["graphemes", "graphemes"],
  ["spots", "spots"],
  ["total(ms)", "totalDurationMs"],
  ["chars/min", "charactersPerMinute"],
  ["words/min", "wordsPerMinute"],
  ["p50(ms)", "durationP50Ms"],
  ["p90(ms)", "durationP90Ms"],
  ["min-clamp", "minClampRate"],
  ["max-clamp", "maxClampRate"],
  ["clause-pause", "pauseShare.clause"],
  ["sentence-pause", "pauseShare.sentence"],
  ["section-pause", "pauseShare.section"],
];

function valueAt(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function format(row, key) {
  const value = valueAt(row, key);
  if (value === null || value === undefined) return "-";
  if (key.includes("Rate") || key.startsWith("pauseShare.")) return `${(value * 100).toFixed(2)}%`;
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

process.stdout.write(`${columns.map(([label]) => label).join(" | ")}\n`);
process.stdout.write(`${columns.map(() => "---").join(" | ")}\n`);
for (const row of corpus) {
  process.stdout.write(`${columns.map(([, key]) => format(row, key)).join(" | ")}\n`);
}
