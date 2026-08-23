import { createRequire } from "node:module";
import { resolve } from "node:path";
import { bench } from "vitest";

const require = createRequire(import.meta.url);
const PAIR_COUNT = 6;
const BATCH_SIZE = 32;
const SAMPLE_ITERATIONS = 10;
const benchmarkOptions = {
  time: 0,
  iterations: SAMPLE_ITERATIONS,
  warmupTime: 0,
  warmupIterations: 10,
};

const source = [
  "Readerの短い本文を同じ条件で分割します。",
  "paired benchmarkはmainとcandidateを同じrunnerで交互に測定します。",
  "このfixtureはNode上で完結し、ブラウザやheapの長時間計測を含みません。",
].join(" ").repeat(4);
const figures = [
  { sourceOffset: 120, sourceEnd: 120 },
  { sourceOffset: 420, sourceEnd: 420 },
];

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
  for (let batch = 0; batch < BATCH_SIZE; batch += 1) {
    consume(engine.segmentText(source, "ja"));
  }
}

function flow(engine) {
  for (let batch = 0; batch < BATCH_SIZE; batch += 1) {
    const units = engine.segmentText(source, "ja");
    consume(engine.buildReadingFlow(units, figures));
  }
}

const fixtures = [
  ["segment", segment],
  ["flow", flow],
];

for (const [fixtureName, runFixture] of fixtures) {
  for (let run = 0; run < PAIR_COUNT; run += 1) {
    const first = run % 2 === 0 ? "main" : "candidate";
    const second = first === "main" ? "candidate" : "main";
    for (const side of [first, second]) {
      const engine = side === "main" ? mainEngine : candidateEngine;
      bench(`fast/${fixtureName}/pair-${run}/${side}`, () => runFixture(engine), benchmarkOptions);
    }
  }
}

void observed;
