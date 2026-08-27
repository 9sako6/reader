use serde::{Deserialize, Serialize};

use crate::state::{Position, PreparationFailure, PreparationInput, Spot};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum ReaderSessionCommand {
    #[serde(rename = "open")]
    Open {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    #[serde(rename = "prepareSucceeded")]
    PrepareSucceeded {
        #[serde(rename = "requestId")]
        request_id: String,
        flow: PreparationInput,
    },
    #[serde(rename = "prepareFailed")]
    PrepareFailed {
        #[serde(rename = "requestId")]
        request_id: String,
        reason: PreparationFailure,
    },
    #[serde(rename = "cancel")]
    Cancel {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    #[serde(rename = "play")]
    Play,
    #[serde(rename = "pause")]
    Pause,
    #[serde(rename = "tick")]
    Tick { generation: u64 },
    #[serde(rename = "previousSentence")]
    PreviousSentence,
    #[serde(rename = "switchToPage")]
    SwitchToPage { position: Position },
    #[serde(rename = "switchToSpots")]
    SwitchToSpots { position: Position },
    #[serde(rename = "resumeFromFigure")]
    ResumeFromFigure,
    #[serde(rename = "rebuildSpots")]
    RebuildSpots {
        spots: Vec<Spot>,
        position: Position,
    },
    #[serde(rename = "visibilityHidden")]
    VisibilityHidden,
    #[serde(rename = "close")]
    Close,
}
