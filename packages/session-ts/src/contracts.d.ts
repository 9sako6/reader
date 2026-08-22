export {};

declare global {
  type ReaderSessionMode = "rsvp" | "text";
  type ReaderSessionPlayback = "playing" | "paused";

  type ReaderSessionPosition =
    | { kind: "text"; sourceOffset: number }
    | { kind: "figure"; sourceOffset: number; figureIndex: number };

  type ReaderSessionFlowItem =
    | { kind: "unit"; sourceOffset: number; unitIndex: number }
    | { kind: "figure"; sourceOffset: number; figureIndex: number };

  type ReaderSessionUnitMetadata = {
    sentenceIndex: number;
    kind: ReaderUnitKind;
    start: number;
    end: number;
    durationMs: number;
  };

  type ReaderSessionFigureMetadata = {
    sourceOffset: number;
    sourceEnd: number;
  };

  type ReaderSessionPreparation = {
    textLength: number;
    units: ReaderSessionUnitMetadata[];
    figures: ReaderSessionFigureMetadata[];
    flow: ReaderSessionFlowItem[];
  };

  type ReaderSessionEffect =
    | { type: "cancelTimer" }
    | { type: "scheduleTick"; generation: number; delayMs: number };

  type ReaderSessionObservableState = {
    phase: "idle" | "preparing" | "reading" | "error" | "ended";
    mode: ReaderSessionMode;
    playback: ReaderSessionPlayback;
    flowIndex: number;
    flowLength: number;
    generation: number;
    sourceOffset: number;
    currentKind: "none" | "unit" | "figure";
    requestId: string;
    timerPending: boolean;
    contentPresent: boolean;
    position: ReaderSessionPosition | null;
    unitIndex: number | null;
    figureIndex: number | null;
    reason: PreparationFailure | "invalid_flow" | "session_unavailable" | null;
  };

  type ReaderSessionState = ReaderSessionObservableState;

  type ReaderSessionHandle = {
    id: number;
    state: ReaderSessionObservableState;
    destroyed: boolean;
  };

  type ReaderSessionCommand =
    | { type: "open"; requestId: string }
    | { type: "prepareSucceeded"; requestId: string; flow: ReaderSessionPreparation }
    | { type: "prepareFailed"; requestId: string; reason: PreparationFailure | "invalid_flow" | "session_unavailable" }
    | { type: "cancel"; requestId: string }
    | { type: "play" }
    | { type: "pause" }
    | { type: "tick"; generation: number }
    | { type: "previousSentence" }
    | { type: "switchToText"; position: ReaderSessionPosition }
    | { type: "switchToRsvp"; position: ReaderSessionPosition }
    | { type: "resumeFromFigure" }
    | { type: "rebuildUnits"; units: ReaderSessionUnitMetadata[]; position: ReaderSessionPosition }
    | { type: "visibilityHidden" }
    | { type: "close" };

  interface ReaderSessionTransition {
    state: ReaderSessionObservableState;
    effects: ReaderSessionEffect[];
  }

  interface ReaderSessionApi {
    init(): Promise<void>;
    ready(): boolean;
    create(): ReaderSessionHandle;
    dispatch(handle: ReaderSessionHandle, command: ReaderSessionCommand): ReaderSessionTransition;
    destroy(handle: ReaderSessionHandle): void;
  }

  var ReaderSession: ReaderSessionApi;
  var ReaderSessionWasm: unknown;
  var wasm_bindgen: ((moduleOrPath?: string) => Promise<unknown>) | undefined;
}
