export function clearPerformanceEntries(performance = globalThis.performance) {
  performance.clearMarks();
  performance.clearMeasures();
  performance.clearResourceTimings();
}
