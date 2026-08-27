import type {
  ReaderEngine as ReaderEngineContract,
  ReaderFlowItem as ReaderFlowItemContract,
  ReaderPosition as ReaderPositionContract,
  Spot as SpotContract,
  SpotOptions as SpotOptionsContract,
  ReaderTimingProfile as ReaderTimingProfileContract,
  ReaderUnit as ReaderUnitContract,
  ReaderUnitKind as ReaderUnitKindContract,
  SentenceSpan as SentenceSpanContract,
} from "./types";

declare global {
  type ReaderUnitKind = ReaderUnitKindContract;
  type SentenceSpan = SentenceSpanContract;
  type ReaderUnit = ReaderUnitContract;
  type ReaderTimingProfile = ReaderTimingProfileContract;
  type ReaderPosition = ReaderPositionContract;
  type Spot = SpotContract;
  type SpotOptions = SpotOptionsContract;
  type ReaderFlowItem = ReaderFlowItemContract;
  type ReaderEngine = ReaderEngineContract;

  var module: { exports: unknown };
  var Engine: ReaderEngine;
}

export {};
