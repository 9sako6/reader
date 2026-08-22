export interface TimingCorpusSectionTransition {
  offset: number;
  headingIndex: number;
}

export interface TimingCorpusEntry {
  id: string;
  locale: string;
  text: string;
  initialHeadingIndex: number;
  sectionTransitions: TimingCorpusSectionTransition[];
}

const corpusModule = require("./timing-corpus.mjs") as {
  timingCorpus: TimingCorpusEntry[];
};

export const timingCorpus: TimingCorpusEntry[] = corpusModule.timingCorpus;
