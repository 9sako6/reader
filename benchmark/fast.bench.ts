import { createRequire } from "node:module";
import { resolve } from "node:path";
import { bench } from "vitest";
import { FAST_BENCHMARK_CONFIG } from "./fast-config.mjs";

const require = createRequire(import.meta.url);
const benchmarkOptions = {
  time: 0,
  iterations: FAST_BENCHMARK_CONFIG.sampleIterations,
  warmupTime: 0,
  warmupIterations: FAST_BENCHMARK_CONFIG.warmupIterations,
};

const source = [
  "Readerの短い本文を同じ条件で分割します。",
  "paired benchmarkはmainとcandidateを同じrunnerで交互に測定します。",
  "このfixtureはNode上で完結し、ブラウザやheapの長時間計測を含みません。",
].join(" ").repeat(8);
const figures = [
  { sourceOffset: 120, sourceEnd: 120 },
  { sourceOffset: 420, sourceEnd: 420 },
];
const contextUnits = Array.from({ length: 400 }, (_, sentenceIndex) => ({
  text: `文${sentenceIndex}。`,
  sentenceIndex,
  kind: "body",
  start: sentenceIndex * 8,
  end: sentenceIndex * 8 + 4,
}));
const spotUnits = Array.from({ length: 400 }, (_, sentenceIndex) => ({
  text: "高速な表示を継続して検証します。",
  sentenceIndex,
  kind: "body",
  start: sentenceIndex * 16,
  end: sentenceIndex * 16 + 16,
}));

function loadEngine(root) {
  const modulePath = resolve(root, ".build/packages/engine/src/engine.js");
  try {
    return require(modulePath);
  } catch (error) {
    throw new Error(`Reader engine build is required for fast benchmark: ${modulePath}`, { cause: error });
  }
}

const candidateRoot = process.env.READER_BENCHMARK_CANDIDATE_ROOT || process.cwd();
const mainRoot = process.env.READER_BENCHMARK_BASELINE_ROOT || candidateRoot;
const mainEngine = loadEngine(mainRoot);
const candidateEngine = loadEngine(candidateRoot);
let observed = 0;

function consume(value) {
  const units = Array.isArray(value) ? value : [];
  observed = (observed + units.length + (units[0]?.start || 0) + (units.at(-1)?.end || 0)) % 1_000_000_007;
}

function segment(engine) {
  for (let batch = 0; batch < FAST_BENCHMARK_CONFIG.batchSize; batch += 1) {
    consume(engine.segmentText(source, "ja"));
  }
}

function flow(engine) {
  for (let batch = 0; batch < FAST_BENCHMARK_CONFIG.batchSize; batch += 1) {
    const units = engine.segmentText(source, "ja");
    consume(engine.buildReadingFlow(units, figures));
  }
}

function contexts(engine) {
  const values = typeof engine.buildSurroundingSentenceContexts === "function"
    ? engine.buildSurroundingSentenceContexts(contextUnits)
    : contextUnits.map((_, index) => engine.surroundingSentences(contextUnits, index));
  consume(values);
}

function spots(engine) {
  consume(engine.buildSpots(spotUnits, {
    locale: "ja",
    maxWidth: 8,
    measureText: (text) => text.length,
  }));
}

const fixtures = [
  ["segment", segment],
  ["flow", flow],
  ["contexts", contexts],
  ["spots", spots],
];

for (const [fixtureName, runFixture] of fixtures) {
  for (let run = 0; run < FAST_BENCHMARK_CONFIG.pairCount; run += 1) {
    const first = run % 2 === 0 ? "main" : "candidate";
    const second = first === "main" ? "candidate" : "main";
    for (const side of [first, second]) {
      const engine = side === "main" ? mainEngine : candidateEngine;
      bench(`fast/${fixtureName}/pair-${run}/${side}`, () => runFixture(engine), benchmarkOptions);
    }
  }
}

void observed;
