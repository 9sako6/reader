import type {
  ReaderEngine as ReaderEngineContract,
  ReaderFlowItem as ReaderFlowItemContract,
  ReaderPosition as ReaderPositionContract,
  RsvpFrame as RsvpFrameContract,
  RsvpFrameOptions as RsvpFrameOptionsContract,
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
  type RsvpFrame = RsvpFrameContract;
  type RsvpFrameOptions = RsvpFrameOptionsContract;
  type ReaderFlowItem = ReaderFlowItemContract;
  type ReaderEngine = ReaderEngineContract;

  var module: { exports: unknown };
  var Engine: ReaderEngine;
}

export {};
