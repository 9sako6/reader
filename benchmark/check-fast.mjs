import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { FAST_BENCHMARK_CONFIG } from "./fast-config.mjs";
import { evaluateVitestReport, FAST_PAIRED_BUDGET } from "./paired.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const inputPath = resolve(repositoryRoot, process.argv[2] || "test-results/performance/fast-vitest.json");
const outputPath = resolve(repositoryRoot, process.argv[3] || "test-results/performance/fast.json");
const vitestReport = JSON.parse(await readFile(inputPath, "utf8"));
const evaluation = evaluateVitestReport(vitestReport, FAST_PAIRED_BUDGET, {
  expectedSampleCount: FAST_BENCHMARK_CONFIG.sampleIterations,
});
const report = {
  schemaVersion: 1,
  source: inputPath.startsWith(`${repositoryRoot}/`) ? inputPath.slice(repositoryRoot.length + 1) : "vitest-output",
  status: evaluation.status,
  groups: evaluation.groups,
  failures: evaluation.failures,
};

await mkdir(resolve(repositoryRoot, "test-results/performance"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (evaluation.status !== "pass") {
  throw new Error(`Fast paired performance regression: ${evaluation.failures.join("; ")}`);
}
