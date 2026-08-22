use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderUnit {
    pub sentence_index: usize,
    pub kind: ReaderUnitKind,
    pub start: usize,
    pub end: usize,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderUnitKind {
    Body,
    Quote,
    Aside,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Figure {
    pub source_offset: usize,
    pub source_end: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FlowItem {
    Unit {
        #[serde(rename = "sourceOffset")]
        source_offset: usize,
        #[serde(rename = "unitIndex")]
        unit_index: usize,
    },
    Figure {
        #[serde(rename = "sourceOffset")]
        source_offset: usize,
        #[serde(rename = "figureIndex")]
        figure_index: usize,
    },
}

impl FlowItem {
    pub fn source_offset(&self) -> usize {
        match self {
            Self::Unit { source_offset, .. } | Self::Figure { source_offset, .. } => *source_offset,
        }
    }

    pub fn is_figure(&self) -> bool {
        matches!(self, Self::Figure { .. })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Position {
    Text {
        #[serde(rename = "sourceOffset")]
        source_offset: usize,
    },
    Figure {
        #[serde(rename = "sourceOffset")]
        source_offset: usize,
        #[serde(rename = "figureIndex")]
        figure_index: usize,
    },
}

impl Position {
    pub fn source_offset(&self) -> usize {
        match self {
            Self::Text { source_offset } | Self::Figure { source_offset, .. } => *source_offset,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Rsvp,
    Text,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Playback {
    Playing,
    Paused,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparationFailure {
    ContentNotFound,
    UnsupportedPage,
    ExtractionFailed,
    InvalidFlow,
    SessionUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationInput {
    pub text_length: usize,
    #[serde(default)]
    pub units: Vec<ReaderUnit>,
    #[serde(default)]
    pub figures: Vec<Figure>,
    #[serde(default)]
    pub flow: Vec<FlowItem>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionContent {
    pub text_length: usize,
    pub units: Vec<ReaderUnit>,
    pub figures: Vec<Figure>,
    pub flow: Vec<FlowItem>,
}

impl From<PreparationInput> for Arc<SessionContent> {
    fn from(input: PreparationInput) -> Self {
        Arc::new(SessionContent {
            text_length: input.text_length,
            units: input.units,
            figures: input.figures,
            flow: input.flow,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReaderSessionState {
    Idle {
        generation: u64,
    },
    Preparing {
        request_id: String,
        generation: u64,
    },
    Reading {
        mode: Mode,
        playback: Playback,
        content: Arc<SessionContent>,
        flow_index: usize,
        position: Position,
        generation: u64,
        request_id: String,
    },
    Error {
        request_id: Option<String>,
        reason: PreparationFailure,
        generation: u64,
    },
    Ended {
        generation: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservableState {
    pub phase: String,
    pub mode: String,
    pub playback: String,
    pub flow_index: usize,
    pub flow_length: usize,
    pub generation: u64,
    pub source_offset: usize,
    pub current_kind: String,
    pub request_id: String,
    pub timer_pending: bool,
    pub content_present: bool,
    pub position: Option<Position>,
    pub unit_index: Option<usize>,
    pub figure_index: Option<usize>,
    pub reason: Option<String>,
}

impl ReaderSessionState {
    pub fn generation(&self) -> u64 {
        match self {
            Self::Idle { generation }
            | Self::Preparing { generation, .. }
            | Self::Reading { generation, .. }
            | Self::Error { generation, .. }
            | Self::Ended { generation } => *generation,
        }
    }

    pub fn is_ended(&self) -> bool {
        matches!(self, Self::Ended { .. })
    }

    pub fn observable(&self) -> ObservableState {
        let empty = |phase: &str, generation: u64, request_id: String| ObservableState {
            phase: phase.into(),
            mode: "rsvp".into(),
            playback: "paused".into(),
            flow_index: 0,
            flow_length: 0,
            generation,
            source_offset: 0,
            current_kind: "none".into(),
            request_id,
            timer_pending: false,
            content_present: false,
            position: None,
            unit_index: None,
            figure_index: None,
            reason: None,
        };
        match self {
            Self::Idle { generation } => empty("idle", *generation, String::new()),
            Self::Preparing {
                request_id,
                generation,
            } => empty("preparing", *generation, request_id.clone()),
            Self::Reading {
                mode,
                playback,
                content,
                flow_index,
                position,
                generation,
                request_id,
            } => {
                let current = content.flow.get(*flow_index);
                let (current_kind, unit_index, figure_index) = match current {
                    Some(FlowItem::Unit { unit_index, .. }) => {
                        ("unit".into(), Some(*unit_index), None)
                    }
                    Some(FlowItem::Figure { figure_index, .. }) => {
                        ("figure".into(), None, Some(*figure_index))
                    }
                    None => ("none".into(), None, None),
                };
                ObservableState {
                    phase: "reading".into(),
                    mode: mode_string(mode),
                    playback: playback_string(playback),
                    flow_index: *flow_index,
                    flow_length: content.flow.len(),
                    generation: *generation,
                    source_offset: position.source_offset(),
                    current_kind,
                    request_id: request_id.clone(),
                    timer_pending: matches!(playback, Playback::Playing),
                    content_present: true,
                    position: Some(position.clone()),
                    unit_index,
                    figure_index,
                    reason: None,
                }
            }
            Self::Error {
                request_id,
                reason,
                generation,
            } => {
                let mut value = empty("error", *generation, request_id.clone().unwrap_or_default());
                value.reason = Some(reason_string(reason));
                value
            }
            Self::Ended { generation } => empty("ended", *generation, String::new()),
        }
    }
}

fn mode_string(mode: &Mode) -> String {
    match mode {
        Mode::Rsvp => "rsvp",
        Mode::Text => "text",
    }
    .into()
}

fn playback_string(playback: &Playback) -> String {
    match playback {
        Playback::Playing => "playing",
        Playback::Paused => "paused",
    }
    .into()
}

fn reason_string(reason: &PreparationFailure) -> String {
    match reason {
        PreparationFailure::ContentNotFound => "content_not_found",
        PreparationFailure::UnsupportedPage => "unsupported_page",
        PreparationFailure::ExtractionFailed => "extraction_failed",
        PreparationFailure::InvalidFlow => "invalid_flow",
        PreparationFailure::SessionUnavailable => "session_unavailable",
    }
    .into()
}
