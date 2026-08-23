import type { ReaderUnitKind } from "../../engine/src/types";
import type { PreparationFailure } from "../../extractor/src/types";

export type ReaderSessionMode = "rsvp" | "text";
export type ReaderSessionPlayback = "playing" | "paused";

export type ReaderSessionPosition =
  | { kind: "text"; sourceOffset: number }
  | { kind: "figure"; sourceOffset: number; figureIndex: number };

export type ReaderSessionFlowItem =
  | { kind: "unit"; sourceOffset: number; unitIndex: number }
  | { kind: "figure"; sourceOffset: number; figureIndex: number };

export interface ReaderSessionUnitMetadata {
  sentenceIndex: number;
  kind: ReaderUnitKind;
  start: number;
  end: number;
  durationMs: number;
}

export interface ReaderSessionFigureMetadata {
  sourceOffset: number;
  sourceEnd: number;
}

export interface ReaderSessionPreparation {
  textLength: number;
  units: ReaderSessionUnitMetadata[];
  figures: ReaderSessionFigureMetadata[];
  flow: ReaderSessionFlowItem[];
}

export type ReaderSessionFailure = PreparationFailure | "invalid_flow";

export type ReaderSessionState =
  | { phase: "idle"; generation: number }
  | { phase: "preparing"; requestId: string; generation: number }
  | {
      phase: "reading";
      mode: ReaderSessionMode;
      playback: ReaderSessionPlayback;
      flowIndex: number;
      flowLength: number;
      generation: number;
      sourceOffset: number;
      currentKind: "unit" | "figure";
      requestId: string;
      timerPending: boolean;
      position: ReaderSessionPosition;
      unitIndex: number | null;
      figureIndex: number | null;
    }
  | { phase: "error"; requestId: string; reason: ReaderSessionFailure; generation: number }
  | { phase: "ended"; generation: number };

export type ReaderSessionCommand =
  | { type: "open"; requestId: string }
  | { type: "prepareSucceeded"; requestId: string; flow: ReaderSessionPreparation }
  | { type: "prepareFailed"; requestId: string; reason: ReaderSessionFailure }
  | { type: "cancel"; requestId: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "previousSentence" }
  | { type: "switchToText"; position: ReaderSessionPosition }
  | { type: "switchToRsvp"; position: ReaderSessionPosition }
  | { type: "resumeFromFigure" }
  | { type: "rebuildUnits"; units: ReaderSessionUnitMetadata[]; position: ReaderSessionPosition }
  | { type: "visibilityHidden" }
  | { type: "close" };

export interface ReaderSessionHandle {
  readonly ready: Promise<void>;
  readonly state: ReaderSessionState | null;
  dispatch(command: ReaderSessionCommand): void;
  destroy(): void;
}

export interface ReaderSessionApi {
  create(onStateChange?: (state: ReaderSessionState) => void): ReaderSessionHandle;
}
