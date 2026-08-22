use quint_connect::{Config, Driver, Result, State, Step};
use reader_session::{
    Figure, FlowItem, Position, PreparationInput, ReaderSessionCommand, ReaderSessionState,
    ReaderTimingProfile, ReaderUnit, ReaderUnitKind, initial_state, reduce,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ModelState {
    phase: String,
    mode: String,
    playback: String,
    flow_index: String,
    flow_length: String,
    position: String,
    timer_generation: String,
    timer_pending: bool,
    content_present: bool,
    active_request: String,
}

impl State<SessionDriver> for ModelState {
    fn from_driver(driver: &SessionDriver) -> Result<Self> {
        let value = driver.state.observable();
        Ok(Self {
            phase: value.phase,
            mode: value.mode,
            playback: value.playback,
            flow_index: value.flow_index.to_string(),
            flow_length: value.flow_length.to_string(),
            position: value.source_offset.to_string(),
            timer_generation: value.generation.to_string(),
            timer_pending: value.timer_pending,
            content_present: value.content_present,
            active_request: value.request_id,
        })
    }

    fn from_spec(value: itf::Value) -> Result<Self> {
        let value: ModelState = itf::de::decode_value(value)
            .map_err(|error| anyhow::anyhow!("model state: {error}"))?;
        Ok(value)
    }
}

struct SessionDriver {
    state: ReaderSessionState,
}

impl Default for SessionDriver {
    fn default() -> Self {
        Self {
            state: initial_state(),
        }
    }
}

impl Driver for SessionDriver {
    type State = ModelState;

    fn config() -> Config {
        Config {
            state: &["session"],
            nondet: &["actionTaken"],
        }
    }

    fn step(&mut self, step: &Step) -> Result {
        quint_connect::switch!(step {
            Init => self.state = initial_state(),
            Open(request_id: String) => self.apply(ReaderSessionCommand::Open { request_id }),
            PrepareSucceeded(request_id: String) => self.apply(ReaderSessionCommand::PrepareSucceeded { request_id, flow: preparation() }),
            PrepareFailed(request_id: String) => self.apply(ReaderSessionCommand::PrepareFailed { request_id, reason: reader_session::PreparationFailure::ExtractionFailed }),
            Cancel(request_id: String) => self.apply(ReaderSessionCommand::Cancel { request_id }),
            Play => self.apply(ReaderSessionCommand::Play),
            Pause => self.apply(ReaderSessionCommand::Pause),
            Tick(generation: u64) => self.apply(ReaderSessionCommand::Tick { generation }),
            PreviousSentence => self.apply(ReaderSessionCommand::PreviousSentence),
            SwitchToText(position: u64) => self.apply(ReaderSessionCommand::SwitchToText { position: model_position(position) }),
            SwitchToRsvp(position: u64) => self.apply(ReaderSessionCommand::SwitchToRsvp { position: model_position(position) }),
            ResumeFromFigure => self.apply(ReaderSessionCommand::ResumeFromFigure),
            RebuildUnits(position: u64) => self.apply(ReaderSessionCommand::RebuildUnits { units: preparation().units, position: model_position(position) }),
            VisibilityHidden => self.apply(ReaderSessionCommand::VisibilityHidden),
            Close => self.apply(ReaderSessionCommand::Close),
        })
    }
}

impl SessionDriver {
    fn apply(&mut self, command: ReaderSessionCommand) {
        self.state = reduce(&self.state, command).state;
    }
}

fn preparation() -> PreparationInput {
    let units = vec![
        ReaderUnit {
            text: "最初。".into(),
            sentence_index: 0,
            kind: ReaderUnitKind::Body,
            start: 0,
            end: 3,
            duration_ms: Some(10),
        },
        ReaderUnit {
            text: "次。".into(),
            sentence_index: 1,
            kind: ReaderUnitKind::Body,
            start: 3,
            end: 5,
            duration_ms: Some(10),
        },
        ReaderUnit {
            text: "最後。".into(),
            sentence_index: 2,
            kind: ReaderUnitKind::Body,
            start: 5,
            end: 8,
            duration_ms: Some(10),
        },
    ];
    let figures = vec![Figure {
        src: "figure".into(),
        alt: String::new(),
        caption: String::new(),
        source_offset: 3,
        source_end: 3,
    }];
    let flow = vec![
        FlowItem::Unit {
            source_offset: 0,
            unit_index: 0,
        },
        FlowItem::Figure {
            source_offset: 3,
            figure_index: 0,
        },
        FlowItem::Unit {
            source_offset: 3,
            unit_index: 1,
        },
        FlowItem::Unit {
            source_offset: 5,
            unit_index: 2,
        },
    ];
    PreparationInput {
        text_length: 8,
        units,
        figures,
        flow,
        timing_profile: ReaderTimingProfile::default(),
    }
}

fn model_position(source_offset: u64) -> Position {
    if source_offset == 3 {
        Position::Figure {
            source_offset: 3,
            figure_index: 0,
        }
    } else {
        Position::Text {
            source_offset: source_offset as usize,
        }
    }
}

#[test]
fn observable_state_is_stable_for_the_same_command_trace() {
    let mut driver = SessionDriver::default();
    driver.apply(ReaderSessionCommand::Open {
        request_id: "A".into(),
    });
    driver.apply(ReaderSessionCommand::PrepareSucceeded {
        request_id: "A".into(),
        flow: preparation(),
    });
    assert_eq!(driver.state.observable().flow_length, 4);
    assert_eq!(driver.state.observable().current_kind, "unit");
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "closeThenLateTick")]
fn close_then_late_tick() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "newRequestSupersedesOldRequest"
)]
fn new_request_supersedes_old_request() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_run(
    spec = "spec/reader_session.qnt",
    max_samples = 1000,
    max_steps = 8,
    seed = "180018"
)]
fn random_session_traces() -> impl Driver {
    SessionDriver::default()
}
