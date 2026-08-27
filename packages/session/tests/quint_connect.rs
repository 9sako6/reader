use quint_connect::{Config, Driver, Result, State, Step};
use reader_session::{
    Figure, FlowItem, Position, PreparationInput, ReaderSessionCommand, ReaderSessionState, Spot,
    SpotKind, initial_state, reduce,
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
            position: value.flow_index.to_string(),
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
            SwitchToPage(position: u64) => self.apply(ReaderSessionCommand::SwitchToPage { position: model_position(position) }),
            SwitchToSpots(position: u64) => self.apply(ReaderSessionCommand::SwitchToSpots { position: model_position(position) }),
            ResumeFromFigure => self.apply(ReaderSessionCommand::ResumeFromFigure),
            RebuildSpots(position: u64) => self.apply(ReaderSessionCommand::RebuildSpots { spots: preparation().spots, position: model_position(position) }),
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
    let spots = vec![
        Spot {
            sentence_index: 0,
            kind: SpotKind::Body,
            start: 0,
            end: 3,
            duration_ms: 10,
        },
        Spot {
            sentence_index: 1,
            kind: SpotKind::Body,
            start: 3,
            end: 5,
            duration_ms: 10,
        },
        Spot {
            sentence_index: 1,
            kind: SpotKind::Body,
            start: 5,
            end: 8,
            duration_ms: 10,
        },
    ];
    let figures = vec![
        Figure {
            source_offset: 3,
            source_end: 3,
        },
        Figure {
            source_offset: 3,
            source_end: 3,
        },
    ];
    let flow = vec![
        FlowItem::Spot {
            source_offset: 0,
            spot_index: 0,
        },
        FlowItem::Figure {
            source_offset: 3,
            figure_index: 0,
        },
        FlowItem::Figure {
            source_offset: 3,
            figure_index: 1,
        },
        FlowItem::Spot {
            source_offset: 3,
            spot_index: 1,
        },
        FlowItem::Spot {
            source_offset: 5,
            spot_index: 2,
        },
    ];
    PreparationInput {
        text_length: 8,
        spots,
        figures,
        flow,
    }
}

fn model_position(flow_index: u64) -> Position {
    match flow_index {
        0 => Position::Text { source_offset: 0 },
        1 => Position::Figure {
            source_offset: 3,
            figure_index: 0,
        },
        2 => Position::Figure {
            source_offset: 3,
            figure_index: 1,
        },
        3 => Position::Text { source_offset: 3 },
        _ => Position::Text { source_offset: 5 },
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
    assert_eq!(driver.state.observable().flow_length, 5);
    assert_eq!(driver.state.observable().current_kind, "spot");
}

#[test]
fn consecutive_figures_keep_identity_and_consume_once() {
    let mut driver = SessionDriver::default();
    driver.apply(ReaderSessionCommand::Open {
        request_id: "A".into(),
    });
    driver.apply(ReaderSessionCommand::PrepareSucceeded {
        request_id: "A".into(),
        flow: preparation(),
    });
    let generation = driver.state.generation();
    driver.apply(ReaderSessionCommand::Tick { generation });
    let first_figure = driver.state.observable();
    assert_eq!(first_figure.flow_index, 1);
    assert_eq!(first_figure.current_kind, "figure");
    assert_eq!(first_figure.figure_index, Some(0));

    let first_generation = driver.state.generation();
    driver.apply(ReaderSessionCommand::ResumeFromFigure);
    let second_figure = driver.state.observable();
    assert_eq!(second_figure.flow_index, 2);
    assert_eq!(second_figure.current_kind, "figure");
    assert_eq!(second_figure.figure_index, Some(1));
    assert_eq!(second_figure.playback, "paused");
    assert!(!second_figure.timer_pending);

    driver.apply(ReaderSessionCommand::Tick {
        generation: first_generation,
    });
    assert_eq!(driver.state.observable().flow_index, 2);

    driver.apply(ReaderSessionCommand::ResumeFromFigure);
    let after_figures = driver.state.observable();
    assert_eq!(after_figures.flow_index, 3);
    assert_eq!(after_figures.current_kind, "spot");
    assert_eq!(after_figures.spot_index, Some(1));
    assert_eq!(after_figures.playback, "playing");
    assert!(after_figures.timer_pending);
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

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "newRequestRejectsLatePreparationFailure"
)]
fn new_request_rejects_late_preparation_failure() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "closeThenLatePreparationSuccess"
)]
fn close_then_late_preparation_success() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "playUntilFigureAndResume")]
fn play_until_figure_and_resume() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "consecutiveFiguresAndResume")]
fn consecutive_figures_and_resume() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "duplicateFigureTickDoesNotConsume"
)]
fn duplicate_figure_tick_does_not_consume() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "previousSentenceWhilePlaying"
)]
fn previous_sentence_while_playing() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "previousSentenceFromPaused")]
fn previous_sentence_from_paused() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "previousSentenceFromFigure")]
fn previous_sentence_from_figure() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "pausedTickDoesNotAdvance")]
fn paused_tick_does_not_advance() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "staleGenerationTickDoesNotAdvance"
)]
fn stale_generation_tick_does_not_advance() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "cancelThenLatePreparationSuccess"
)]
fn cancel_then_late_preparation_success() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "switchModeAtFigure")]
fn switch_mode_at_figure() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "switchModeAfterFigure")]
fn switch_mode_after_figure() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "pausedModeRoundTrip")]
fn paused_mode_round_trip() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "rebuildSpotsWhilePlaying")]
fn rebuild_spots_while_playing() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(spec = "spec/reader_session.qnt", test = "visibilityHiddenPauses")]
fn visibility_hidden_pauses() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "visibilityHiddenDuringPreparation"
)]
fn visibility_hidden_during_preparation() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "visibilityHiddenDuringPreparationThenFailure"
)]
fn visibility_hidden_during_preparation_then_failure() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_test(
    spec = "spec/reader_session.qnt",
    test = "visibilityHiddenDuringPreparationIsIdempotent"
)]
fn visibility_hidden_during_preparation_is_idempotent() -> impl Driver {
    SessionDriver::default()
}

#[quint_connect::quint_run(
    spec = "spec/reader_session.qnt",
    max_samples = 1000,
    max_steps = 12,
    seed = "180018"
)]
fn random_session_traces() -> impl Driver {
    SessionDriver::default()
}
