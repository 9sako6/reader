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
  ].filter(([, end, start]) => end < start).map(([name]) => name);
  if (invalidOrder.length > 0) {
    throw new Error(`Performance mark order invalid: ${invalidOrder.join(", ")}`);
  }

  return {
    bootstrapMs: 0,
    tapToFirstFeedbackMs: marks.firstFeedback - marks.tap,
    tapToFirstUnitMs: marks.firstUnit - marks.tap,
    sessionInitMs: marks.sessionInitEnd - marks.sessionInitStart,
    wasmFetchedBeforeTap,
    extractionMs: marks.extractionEnd - marks.extractionStart,
    tapToFirstRenderMs: marks.firstRender - marks.tap,
    nodeCount,
    ...metrics,
  };
}
