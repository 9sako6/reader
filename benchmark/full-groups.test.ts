export {};

const assert = require("node:assert/strict");
const { assertDistinctCommits, selectPerformanceGroup } = require("./full-groups.mjs");

const fixtureNames = ["short-article", "long-article", "dominant-article", "defuddle-fallback"];
const nodeCounts = [1000, 10_000, 50_000, 100_000];

test("large DOM group runs only its node fixtures on one serial runner", () => {
  const group = selectPerformanceGroup("large-dom", fixtureNames, nodeCounts);

  assert.deepEqual(group.fixtures, []);
  assert.deepEqual(group.nodeCounts, nodeCounts);
  assert.equal(group.cleanup, false);
  assert.equal(group.passive, false);
});

test("full group retains every tap/render/extraction, heap, and passive responsibility", () => {
  const group = selectPerformanceGroup("all", fixtureNames, nodeCounts);

  assert.deepEqual(group.fixtures, fixtureNames);
  assert.deepEqual(group.nodeCounts, nodeCounts);
  assert.equal(group.cleanup, true);
  assert.equal(group.passive, true);
});

test("unknown full browser fixture group is rejected instead of silently changing coverage", () => {
  assert.throws(
    () => selectPerformanceGroup("not-a-group", fixtureNames, nodeCounts),
    /Unknown full benchmark fixture group/,
  );
});

test("full browser paired run rejects a baseline and candidate with the same commit", () => {
  assert.throws(
    () => assertDistinctCommits("abc123", "abc123"),
    /baseline and candidate commits must differ/,
  );
  assert.deepEqual(assertDistinctCommits("abc123", "def456"), {
    baselineCommit: "abc123",
    candidateCommit: "def456",
  });
});
