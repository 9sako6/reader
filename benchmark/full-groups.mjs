export function selectPerformanceGroup(name, fixtureNames, nodeCounts) {
  const allFixtures = [...fixtureNames];
  const allNodeCounts = [...nodeCounts];
  const groups = {
    "short-article": { fixtures: ["short-article"], nodeCounts: [], cleanup: false, passive: false },
    "long-article": { fixtures: ["long-article", "dominant-article", "defuddle-fallback"], nodeCounts: [], cleanup: false, passive: false },
    "large-dom": { fixtures: [], nodeCounts: allNodeCounts, cleanup: false, passive: false },
    heap: { fixtures: ["short-article"], nodeCounts: [100_000], cleanup: true, passive: false },
    passive: { fixtures: [], nodeCounts: [], cleanup: false, passive: true },
    all: { fixtures: allFixtures, nodeCounts: allNodeCounts, cleanup: true, passive: true },
  };
  const selected = groups[name];
  if (!selected) throw new Error(`Unknown full benchmark fixture group: ${name}`);
  return {
    name,
    fixtures: [...selected.fixtures],
    nodeCounts: [...selected.nodeCounts],
    cleanup: selected.cleanup,
    passive: selected.passive,
  };
}

export function assertDistinctCommits(baselineCommit, candidateCommit) {
  if (!baselineCommit || !candidateCommit) throw new Error("paired performance commit metadata is required");
  if (baselineCommit === candidateCommit) throw new Error("paired performance baseline and candidate commits must differ");
  return { baselineCommit, candidateCommit };
}
