export {};

const assert = require("node:assert/strict");
const { buildPerformanceSample } = require("../../scripts/performance-sample.mjs");

const completeMarks = {
  tap: 10,
  firstFeedback: 12,
  extractionStart: 20,
  extractionEnd: 35,
  firstRender: 40,
  firstUnit: 38,
  sessionInitStart: 14,
  sessionInitEnd: 19,
};

test("performance sample preserves valid zero metrics and computes mark deltas", () => {
  const sample = buildPerformanceSample({
    marks: completeMarks,
    metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2, contextMs: 3 },
    nodeCount: 100,
    wasmFetchedBeforeTap: false,
  });

  assert.equal(sample.dominantArticleMs, 0);
  assert.equal(sample.tapToFirstFeedbackMs, 2);
  assert.equal(sample.extractionMs, 15);
  assert.equal(sample.nodeCount, 100);
});

test("performance sample fails when a required mark is missing", () => {
  const marks = { ...completeMarks };
  delete marks.firstRender;

  assert.throws(
    () => buildPerformanceSample({
      marks,
      metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2, contextMs: 3 },
      nodeCount: 100,
      wasmFetchedBeforeTap: false,
    }),
    /Missing required performance marks: firstRender/,
  );
});

test("performance sample fails when extraction metrics are missing", () => {
  assert.throws(
    () => buildPerformanceSample({
      marks: completeMarks,
      metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2 },
      nodeCount: 100,
      wasmFetchedBeforeTap: false,
    }),
    /Missing required performance metrics: contextMs/,
  );
});

test("performance sample fails when a mark goes backwards", () => {
  const marks = { ...completeMarks, firstRender: 9 };

  assert.throws(
    () => buildPerformanceSample({
      marks,
      metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2, contextMs: 3 },
      nodeCount: 100,
      wasmFetchedBeforeTap: false,
    }),
    /Performance mark order invalid: firstRender/,
  );
});
