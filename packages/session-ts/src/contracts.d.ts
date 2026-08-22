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

  type ReaderSessionEffect =
    | { type: "cancelTimer" }
    | { type: "scheduleTick"; generation: number; delayMs: number };

  type ReaderSessionState = {
    phase: "idle" | "preparing" | "reading" | "error" | "ended";
    generation: number;
    requestId?: string;
    mode?: ReaderSessionMode;
    playback?: ReaderSessionPlayback;
    textLength?: number;
    units?: ReaderUnit[];
    figures?: ReaderFigure[];
    flow?: ReaderSessionFlowItem[];
    flowIndex?: number;
    position?: ReaderSessionPosition;
    timingProfile?: ReaderTimingProfile;
    reason?: PreparationFailure | "invalid_flow";
  };

  type ReaderSessionInput = {
    requestId?: string;
    textLength: number;
    units: ReaderUnit[];
    figures: ReaderFigure[];
    flow: ReaderSessionFlowItem[];
    timingProfile?: ReaderTimingProfile;
  };

  type ReaderSessionCommand =
    | { type: "open"; requestId: string }
    | { type: "prepareSucceeded"; requestId: string; flow: ReaderSessionInput }
    | { type: "prepareFailed"; requestId: string; reason: PreparationFailure | "invalid_flow" }
    | { type: "cancel"; requestId: string }
    | { type: "play" }
    | { type: "pause" }
    | { type: "tick"; generation: number }
    | { type: "previousSentence" }
    | { type: "switchToText"; position: ReaderSessionPosition }
    | { type: "switchToRsvp"; position: ReaderSessionPosition }
    | { type: "resumeFromFigure" }
    | { type: "rebuildUnits"; units: ReaderUnit[]; position: ReaderSessionPosition }
    | { type: "visibilityHidden" }
    | { type: "close" };

  interface ReaderSessionTransition {
    state: ReaderSessionState;
    effects: ReaderSessionEffect[];
  }

  interface ReaderSessionApi {
    init(): Promise<void>;
    ready(): boolean;
    create(input: ReaderSessionInput): ReaderSessionState;
    reduce(state: ReaderSessionState, command: ReaderSessionCommand): ReaderSessionTransition;
  }

  var ReaderSession: ReaderSessionApi;
  var ReaderSessionWasm: unknown;
  var wasm_bindgen: ((moduleOrPath?: string) => Promise<unknown>) | undefined;
}
