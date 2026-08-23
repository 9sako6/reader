export {};

const assert = require("node:assert/strict");
const { buildPerformanceSample, median, percentile } = require("./sample.mjs");

test("performance aggregation keeps missing phase values null", () => {
  assert.equal(median([null, undefined]), null);
  assert.equal(percentile([null, undefined], 0.9), null);
  assert.equal(median([null, 2, 4]), null);
  assert.equal(percentile([null, 2, 4], 0.9), null);
  assert.equal(median([2, 4]), 4);
  assert.equal(percentile([2, 4], 0.9), 4);
});

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
  assert.equal(sample.reactInitMs, null);
  assert.equal(sample.wasmInitMs, null);
  assert.equal(sample.initializationSpanMs, null);
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

test("performance sample records React and WASM initialization phases when all marks are present", () => {
  const sample = buildPerformanceSample({
    marks: {
      ...completeMarks,
      reactInitStart: 11,
      reactInitEnd: 14,
      wasmInitStart: 12,
      wasmInitEnd: 24,
    },
    metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2, contextMs: 3 },
    nodeCount: 100,
    wasmFetchedBeforeTap: false,
  });

  assert.equal(sample.reactInitMs, 3);
  assert.equal(sample.wasmInitMs, 12);
  assert.equal(sample.initializationSpanMs, 13);
});

test("performance sample rejects a reversed initialization mark pair", () => {
  assert.throws(
    () => buildPerformanceSample({
      marks: { ...completeMarks, reactInitStart: 14, reactInitEnd: 11 },
      metrics: { dominantArticleMs: 0, defuddleMs: 1, indexMs: 2, contextMs: 3 },
      nodeCount: 100,
      wasmFetchedBeforeTap: false,
    }),
    /Performance mark order invalid: reactInitEnd/,
  );
});
