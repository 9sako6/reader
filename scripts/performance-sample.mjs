const requiredMarks = [
  "tap",
  "firstFeedback",
  "extractionStart",
  "extractionEnd",
  "firstRender",
  "firstUnit",
  "sessionInitStart",
  "sessionInitEnd",
];

const requiredMetrics = ["dominantArticleMs", "defuddleMs", "indexMs", "contextMs"];

export function median(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

export function percentile(values, percentileRank) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentileRank) - 1)];
}

function duration(marks, start, end) {
  if (!Number.isFinite(marks?.[start]) || !Number.isFinite(marks?.[end])) return null;
  return marks[end] - marks[start];
}

function initializationSpan(marks) {
  const starts = [marks?.reactInitStart, marks?.wasmInitStart].filter(Number.isFinite);
  const ends = [marks?.reactInitEnd, marks?.wasmInitEnd].filter(Number.isFinite);
  if (starts.length !== 2 || ends.length !== 2) return null;
  return Math.max(...ends) - Math.min(...starts);
}

export function buildPerformanceSample({ marks, metrics, nodeCount, wasmFetchedBeforeTap }) {
  const missingMarks = requiredMarks.filter((name) => !Number.isFinite(marks?.[name]));
  if (missingMarks.length > 0) {
    throw new Error(`Missing required performance marks: ${missingMarks.join(", ")}`);
  }
  const missingMetrics = requiredMetrics.filter((name) => !Number.isFinite(metrics?.[name]));
  if (missingMetrics.length > 0) {
    throw new Error(`Missing required performance metrics: ${missingMetrics.join(", ")}`);
  }
  const invalidOrder = [
    ["firstFeedback", marks.firstFeedback, marks.tap],
    ["firstUnit", marks.firstUnit, marks.tap],
    ["firstRender", marks.firstRender, marks.tap],
    ["extractionEnd", marks.extractionEnd, marks.extractionStart],
    ["sessionInitEnd", marks.sessionInitEnd, marks.sessionInitStart],
    ["reactInitEnd", marks.reactInitEnd, marks.reactInitStart],
    ["wasmInitEnd", marks.wasmInitEnd, marks.wasmInitStart],
  ].filter(([, end, start]) => end < start).map(([name]) => name);
  if (invalidOrder.length > 0) {
    throw new Error(`Performance mark order invalid: ${invalidOrder.join(", ")}`);
  }

  return {
    bootstrapMs: 0,
    tapToFirstFeedbackMs: marks.firstFeedback - marks.tap,
    tapToFirstUnitMs: marks.firstUnit - marks.tap,
    sessionInitMs: marks.sessionInitEnd - marks.sessionInitStart,
    reactInitMs: duration(marks, "reactInitStart", "reactInitEnd"),
    wasmInitMs: duration(marks, "wasmInitStart", "wasmInitEnd"),
    initializationSpanMs: initializationSpan(marks),
    wasmFetchedBeforeTap,
    extractionMs: marks.extractionEnd - marks.extractionStart,
    tapToFirstRenderMs: marks.firstRender - marks.tap,
    nodeCount,
    ...metrics,
  };
}
