import type {
  ReaderSessionApi as ReaderSessionApiContract,
  ReaderSessionCommand as ReaderSessionCommandContract,
  ReaderSessionFailure as ReaderSessionFailureContract,
  ReaderSessionFlowItem as ReaderSessionFlowItemContract,
  ReaderSessionHandle as ReaderSessionHandleContract,
  ReaderSessionMode as ReaderSessionModeContract,
  ReaderSessionPlayback as ReaderSessionPlaybackContract,
  ReaderSessionPosition as ReaderSessionPositionContract,
  ReaderSessionPreparation as ReaderSessionPreparationContract,
  ReaderSessionState as ReaderSessionStateContract,
  ReaderSessionSpotMetadata as ReaderSessionSpotMetadataContract,
} from "./types";

declare global {
  type ReaderSessionMode = ReaderSessionModeContract;
  type ReaderSessionPlayback = ReaderSessionPlaybackContract;
  type ReaderSessionPosition = ReaderSessionPositionContract;
  type ReaderSessionFlowItem = ReaderSessionFlowItemContract;
  type ReaderSessionSpotMetadata = ReaderSessionSpotMetadataContract;
  type ReaderSessionPreparation = ReaderSessionPreparationContract;
  type ReaderSessionFailure = ReaderSessionFailureContract;
  type ReaderSessionState = ReaderSessionStateContract;
  type ReaderSessionCommand = ReaderSessionCommandContract;
  type ReaderSessionHandle = ReaderSessionHandleContract;
  type ReaderSessionApi = ReaderSessionApiContract;

  var ReaderSession: ReaderSessionApi;
  var ReaderSessionWasm: unknown;
}

export {};
