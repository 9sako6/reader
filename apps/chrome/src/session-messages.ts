export type SessionClientMessage = { type: "dispatch"; command: ReaderSessionCommand };

export type SessionWorkerMessage =
  | { type: "ready" }
  | { type: "state"; state: ReaderSessionState }
  | { type: "error"; message: string };
