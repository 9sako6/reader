use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderUnitKind {
    Body,
    Quote,
    Aside,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderUnit {
    pub text: String,
    pub sentence_index: usize,
    pub kind: ReaderUnitKind,
    pub start: usize,
    pub end: usize,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Figure {
    pub src: String,
    #[serde(default)]
    pub alt: String,
    #[serde(default)]
    pub caption: String,
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderTimingProfile {
    #[serde(default = "default_base_unit_ms")]
    pub base_unit_ms: u64,
    #[serde(default = "default_ms_per_grapheme")]
    pub ms_per_grapheme: u64,
    #[serde(default = "default_min_unit_ms")]
    pub min_unit_ms: u64,
    #[serde(default = "default_max_unit_ms")]
    pub max_unit_ms: u64,
    #[serde(default = "default_clause_pause_ms")]
    pub clause_pause_ms: u64,
    #[serde(default = "default_sentence_pause_ms")]
    pub sentence_pause_ms: u64,
    #[serde(default = "default_section_pause_ms")]
    pub section_pause_ms: u64,
}

impl Default for ReaderTimingProfile {
    fn default() -> Self {
        Self {
            base_unit_ms: default_base_unit_ms(),
            ms_per_grapheme: default_ms_per_grapheme(),
            min_unit_ms: default_min_unit_ms(),
            max_unit_ms: default_max_unit_ms(),
            clause_pause_ms: default_clause_pause_ms(),
            sentence_pause_ms: default_sentence_pause_ms(),
            section_pause_ms: default_section_pause_ms(),
        }
    }
}

impl ReaderTimingProfile {
    pub fn duration_for(
        &self,
        unit: &ReaderUnit,
        next: Option<&ReaderUnit>,
        section_break: bool,
    ) -> u64 {
        if let Some(duration) = unit.duration_ms {
            return duration.max(1);
        }
        let graphemes = unit.text.chars().count() as u64;
        let mut duration = self
            .base_unit_ms
            .saturating_add(self.ms_per_grapheme.saturating_mul(graphemes))
            .clamp(self.min_unit_ms, self.max_unit_ms);
        if unit.text.ends_with(['、', ',', '，', ';', '；', ':', '：']) {
            duration = duration.saturating_add(self.clause_pause_ms);
        }
        if next.is_some_and(|next_unit| next_unit.sentence_index != unit.sentence_index) {
            duration = duration.saturating_add(self.sentence_pause_ms);
        }
        if section_break {
            duration = duration.saturating_add(self.section_pause_ms);
        }
        duration
    }
}

fn default_base_unit_ms() -> u64 {
    180
}
fn default_ms_per_grapheme() -> u64 {
    24
}
fn default_min_unit_ms() -> u64 {
    240
}
fn default_max_unit_ms() -> u64 {
    600
}
fn default_clause_pause_ms() -> u64 {
    120
}
fn default_sentence_pause_ms() -> u64 {
    360
}
fn default_section_pause_ms() -> u64 {
    240
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
    #[serde(default)]
    pub timing_profile: ReaderTimingProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum ReaderSessionState {
    Idle {
        generation: u64,
    },
    Preparing {
        #[serde(rename = "requestId")]
        request_id: String,
        generation: u64,
    },
    Reading {
        mode: Mode,
        playback: Playback,
        text_length: usize,
        units: Vec<ReaderUnit>,
        figures: Vec<Figure>,
        flow: Vec<FlowItem>,
        flow_index: usize,
        position: Position,
        timing_profile: ReaderTimingProfile,
        generation: u64,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Error {
        #[serde(rename = "requestId")]
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
        match self {
            Self::Idle { generation } => ObservableState {
                phase: "idle".into(),
                mode: "rsvp".into(),
                playback: "paused".into(),
                flow_index: 0,
                flow_length: 0,
                generation: *generation,
                source_offset: 0,
                current_kind: "none".into(),
                request_id: String::new(),
                timer_pending: false,
                content_present: false,
            },
            Self::Preparing {
                request_id,
                generation,
            } => ObservableState {
                phase: "preparing".into(),
                mode: "rsvp".into(),
                playback: "paused".into(),
                flow_index: 0,
                flow_length: 0,
                generation: *generation,
                source_offset: 0,
                current_kind: "none".into(),
                request_id: request_id.clone(),
                timer_pending: false,
                content_present: false,
            },
            Self::Reading {
                mode,
                playback,
                flow,
                flow_index,
                position,
                generation,
                request_id,
                ..
            } => ObservableState {
                phase: "reading".into(),
                mode: serde_json::to_string(mode)
                    .unwrap_or_else(|_| "\"rsvp\"".into())
                    .trim_matches('"')
                    .into(),
                playback: serde_json::to_string(playback)
                    .unwrap_or_else(|_| "\"paused\"".into())
                    .trim_matches('"')
                    .into(),
                flow_index: *flow_index,
                flow_length: flow.len(),
                generation: *generation,
                source_offset: position.source_offset(),
                current_kind: flow.get(*flow_index).map_or_else(
                    || "none".into(),
                    |item| {
                        if item.is_figure() {
                            "figure".into()
                        } else {
                            "unit".into()
                        }
                    },
                ),
                request_id: request_id.clone(),
                timer_pending: matches!(playback, Playback::Playing),
                content_present: true,
            },
            Self::Error {
                request_id,
                reason,
                generation,
            } => ObservableState {
                phase: "error".into(),
                mode: "rsvp".into(),
                playback: "paused".into(),
                flow_index: 0,
                flow_length: 0,
                generation: *generation,
                source_offset: 0,
                current_kind: serde_json::to_string(reason)
                    .unwrap_or_else(|_| "\"invalid_flow\"".into())
                    .trim_matches('"')
                    .into(),
                request_id: request_id.clone().unwrap_or_default(),
                timer_pending: false,
                content_present: false,
            },
            Self::Ended { generation } => ObservableState {
                phase: "ended".into(),
                mode: "rsvp".into(),
                playback: "paused".into(),
                flow_index: 0,
                flow_length: 0,
                generation: *generation,
                source_offset: 0,
                current_kind: "none".into(),
                request_id: String::new(),
                timer_pending: false,
                content_present: false,
            },
        }
    }
}
