export {};

const assert = require("node:assert/strict");
const { clearPerformanceEntries } = require("../../scripts/performance-entry-cleanup.mjs");

function fakePerformance() {
  const calls = [];
  return {
    calls,
    clearMarks() {
      calls.push("marks");
    },
    clearMeasures() {
      calls.push("measures");
    },
    clearResourceTimings() {
      calls.push("resources");
    },
  };
}

test("cleanup clears marks at a same-page cycle boundary", () => {
  const performance = fakePerformance();

  clearPerformanceEntries(performance);

  assert.deepEqual(performance.calls.slice(0, 1), ["marks"]);
});

test("cleanup clears measures at a same-page cycle boundary", () => {
  const performance = fakePerformance();

  clearPerformanceEntries(performance);

  assert.deepEqual(performance.calls.slice(1, 2), ["measures"]);
});

test("cleanup clears resource timings after the close sample is captured", () => {
  const performance = fakePerformance();

  clearPerformanceEntries(performance);

  assert.deepEqual(performance.calls.slice(2, 3), ["resources"]);
});

test("cleanup is repeatable for every measured open-close cycle", () => {
  const performance = fakePerformance();

  clearPerformanceEntries(performance);
  clearPerformanceEntries(performance);

  assert.deepEqual(performance.calls, [
    "marks", "measures", "resources",
    "marks", "measures", "resources",
  ]);
});
