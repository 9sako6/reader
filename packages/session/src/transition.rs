use std::cmp::Ordering;

use crate::command::ReaderSessionCommand;
use crate::effect::ReaderSessionEffect;
use crate::state::{
    FlowItem, Mode, Playback, Position, PreparationFailure, PreparationInput, ReaderSessionState,
    ReaderUnit, SessionContent,
};
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct Transition {
    pub state: ReaderSessionState,
    pub effects: Vec<ReaderSessionEffect>,
}

pub fn initial_state() -> ReaderSessionState {
    ReaderSessionState::Idle { generation: 0 }
}

pub fn reduce(state: &ReaderSessionState, command: ReaderSessionCommand) -> Transition {
    if state.is_ended() {
        return unchanged(state);
    }
    match command {
        ReaderSessionCommand::Open { request_id } => open(state, request_id),
        ReaderSessionCommand::PrepareSucceeded { request_id, flow } => {
            prepare_succeeded(state, request_id, flow)
        }
        ReaderSessionCommand::PrepareFailed { request_id, reason } => {
            prepare_failed(state, request_id, reason)
        }
        ReaderSessionCommand::Cancel { request_id } => cancel(state, request_id),
        ReaderSessionCommand::Play => play(state),
        ReaderSessionCommand::Pause => pause(state),
        ReaderSessionCommand::Tick { generation } => tick(state, generation),
        ReaderSessionCommand::PreviousSentence => previous_sentence(state),
        ReaderSessionCommand::SwitchToText { position } => switch_mode(state, Mode::Text, position),
        ReaderSessionCommand::SwitchToRsvp { position } => switch_mode(state, Mode::Rsvp, position),
        ReaderSessionCommand::ResumeFromFigure => resume_from_figure(state),
        ReaderSessionCommand::RebuildUnits { units, position } => {
            rebuild_units(state, units, position)
        }
        ReaderSessionCommand::VisibilityHidden => pause(state),
        ReaderSessionCommand::Close => close(state),
    }
}

fn open(state: &ReaderSessionState, request_id: String) -> Transition {
    let effects = if matches!(state, ReaderSessionState::Reading { .. }) {
        vec![ReaderSessionEffect::CancelTimer]
    } else {
        Vec::new()
    };
    Transition {
        state: ReaderSessionState::Preparing {
            request_id,
            generation: state.generation().saturating_add(1),
        },
        effects,
    }
}

fn prepare_succeeded(
    state: &ReaderSessionState,
    request_id: String,
    mut input: PreparationInput,
) -> Transition {
    let ReaderSessionState::Preparing {
        request_id: active_request,
        generation,
    } = state
    else {
        return unchanged(state);
    };
    if active_request != &request_id {
        return unchanged(state);
    }
    if let Err(reason) = normalize_input(&mut input) {
        return Transition {
            state: ReaderSessionState::Error {
                request_id: Some(request_id),
                reason,
                generation: generation.saturating_add(1),
            },
            effects: vec![ReaderSessionEffect::CancelTimer],
        };
    }
    let content: Arc<SessionContent> = input.into();
    let first = &content.flow[0];
    let (position, playback) = position_and_playback(first, &content.units);
    let next_generation = generation.saturating_add(1);
    let effects = if matches!(playback, Playback::Playing) {
        vec![schedule_effect(&content, 0, next_generation)]
    } else {
        vec![ReaderSessionEffect::CancelTimer]
    };
    Transition {
        state: ReaderSessionState::Reading {
            mode: Mode::Rsvp,
            playback,
            content,
            flow_index: 0,
            position,
            generation: next_generation,
            request_id,
        },
        effects,
    }
}

fn prepare_failed(
    state: &ReaderSessionState,
    request_id: String,
    reason: PreparationFailure,
) -> Transition {
    let ReaderSessionState::Preparing {
        request_id: active_request,
        generation,
    } = state
    else {
        return unchanged(state);
    };
    if active_request != &request_id {
        return unchanged(state);
    }
    Transition {
        state: ReaderSessionState::Error {
            request_id: Some(request_id),
            reason,
            generation: generation.saturating_add(1),
        },
        effects: vec![ReaderSessionEffect::CancelTimer],
    }
}

fn cancel(state: &ReaderSessionState, request_id: String) -> Transition {
    let ReaderSessionState::Preparing {
        request_id: active_request,
        generation,
    } = state
    else {
        return unchanged(state);
    };
    if active_request != &request_id {
        return unchanged(state);
    }
    Transition {
        state: ReaderSessionState::Idle {
            generation: generation.saturating_add(1),
        },
        effects: vec![ReaderSessionEffect::CancelTimer],
    }
}

fn play(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        mode: Mode::Rsvp,
        playback: Playback::Paused,
        content,
        flow_index,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    if !matches!(content.flow.get(*flow_index), Some(FlowItem::Unit { .. })) {
        return unchanged(state);
    }
    let next_generation = generation.saturating_add(1);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        playback,
        generation,
        ..
    } = &mut next
    {
        *playback = Playback::Playing;
        *generation = next_generation;
    }
    Transition {
        state: next,
        effects: vec![schedule_effect(content, *flow_index, next_generation)],
    }
}

fn pause(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        playback,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let next_generation = generation.saturating_add(1);
    let was_playing = matches!(playback, Playback::Playing);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        playback,
        generation,
        ..
    } = &mut next
    {
        *playback = Playback::Paused;
        *generation = next_generation;
    }
    Transition {
        state: next,
        effects: if was_playing {
            vec![ReaderSessionEffect::CancelTimer]
        } else {
            Vec::new()
        },
    }
}

fn tick(state: &ReaderSessionState, generation: u64) -> Transition {
    let ReaderSessionState::Reading {
        playback: Playback::Playing,
        content,
        flow_index,
        ..
    } = state
    else {
        return unchanged(state);
    };
    if state.generation() != generation {
        return unchanged(state);
    }
    let next_index = flow_index.saturating_add(1);
    let Some(next_item) = content.flow.get(next_index) else {
        return pause(state);
    };
    let (position, playback) = position_and_playback(next_item, &content.units);
    let next_generation = generation.saturating_add(1);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        flow_index,
        position: current_position,
        playback: current_playback,
        generation,
        ..
    } = &mut next
    {
        *flow_index = next_index;
        *current_position = position;
        *current_playback = playback.clone();
        *generation = next_generation;
    }
    let effects = if next_item.is_figure() {
        vec![ReaderSessionEffect::CancelTimer]
    } else {
        vec![schedule_effect(content, next_index, next_generation)]
    };
    Transition {
        state: next,
        effects,
    }
}

fn previous_sentence(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        playback,
        content,
        flow_index,
        generation,
        mode,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let Some(current_item) = content.flow.get(*flow_index) else {
        return unchanged(state);
    };
    let was_figure = current_item.is_figure();
    let was_playing = matches!(playback, Playback::Playing);
    let current_unit_index = match current_item {
        FlowItem::Unit { unit_index, .. } => *unit_index,
        FlowItem::Figure { source_offset, .. } => content
            .units
            .iter()
            .enumerate()
            .filter(|(_, unit)| unit.end <= *source_offset)
            .map(|(index, _)| index)
            .next_back()
            .unwrap_or(0),
    };
    let target_unit_index = if was_figure {
        sentence_start(&content.units, current_unit_index)
    } else {
        previous_sentence_start(&content.units, current_unit_index)
    };
    let Some(target_unit) = content.units.get(target_unit_index) else {
        return unchanged(state);
    };
    let target_position = Position::Text {
        source_offset: target_unit.start,
    };
    let target_flow_index = find_flow_index(&content.flow, &content.units, &target_position);
    if target_flow_index >= content.flow.len() {
        return unchanged(state);
    }
    let next_generation = generation.saturating_add(1);
    let target_playback = if matches!(mode, Mode::Text) {
        Playback::Paused
    } else if was_figure || was_playing {
        Playback::Playing
    } else {
        Playback::Paused
    };
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        flow_index,
        position,
        playback,
        generation,
        ..
    } = &mut next
    {
        *flow_index = target_flow_index;
        *position = target_position;
        *playback = target_playback.clone();
        *generation = next_generation;
    }
    let mut effects = vec![ReaderSessionEffect::CancelTimer];
    if matches!(target_playback, Playback::Playing) {
        effects.push(schedule_effect(content, target_flow_index, next_generation));
    }
    Transition {
        state: next,
        effects,
    }
}

fn resume_from_figure(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        content,
        flow_index,
        mode,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    if !matches!(content.flow.get(*flow_index), Some(FlowItem::Figure { .. })) {
        return unchanged(state);
    }
    let next_index = flow_index.saturating_add(1);
    let Some(next_item) = content.flow.get(next_index) else {
        return pause(state);
    };
    let (position, mut playback) = position_and_playback(next_item, &content.units);
    if matches!(mode, Mode::Text) {
        playback = Playback::Paused;
    }
    let next_generation = generation.saturating_add(1);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        flow_index,
        position: current_position,
        playback: current_playback,
        generation,
        ..
    } = &mut next
    {
        *flow_index = next_index;
        *current_position = position;
        *current_playback = playback.clone();
        *generation = next_generation;
    }
    let effects = if matches!(playback, Playback::Playing) {
        vec![schedule_effect(content, next_index, next_generation)]
    } else {
        vec![ReaderSessionEffect::CancelTimer]
    };
    Transition {
        state: next,
        effects,
    }
}

fn switch_mode(state: &ReaderSessionState, mode: Mode, position: Position) -> Transition {
    let ReaderSessionState::Reading {
        content,
        mode: current_mode,
        playback: current_playback,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let target_flow_index = find_flow_index(&content.flow, &content.units, &position);
    let Some(item) = content.flow.get(target_flow_index) else {
        return unchanged(state);
    };
    let (target_position, target_playback) = match mode {
        Mode::Text => (position, Playback::Paused),
        Mode::Rsvp => {
            let (target_position, inferred_playback) = position_and_playback(item, &content.units);
            let target_playback = if matches!(current_mode, Mode::Text) {
                current_playback.clone()
            } else {
                inferred_playback
            };
            (target_position, target_playback)
        }
    };
    let next_generation = generation.saturating_add(1);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        mode: current_mode,
        playback,
        flow_index,
        position: current_position,
        generation,
        ..
    } = &mut next
    {
        *current_mode = mode;
        *playback = target_playback.clone();
        *flow_index = target_flow_index;
        *current_position = target_position;
        *generation = next_generation;
    }
    let mut effects = vec![ReaderSessionEffect::CancelTimer];
    if matches!(target_playback, Playback::Playing) {
        effects.push(schedule_effect(content, target_flow_index, next_generation));
    }
    Transition {
        state: next,
        effects,
    }
}

fn rebuild_units(
    state: &ReaderSessionState,
    units: Vec<ReaderUnit>,
    position: Position,
) -> Transition {
    let ReaderSessionState::Reading {
        content,
        mode,
        playback,
        generation,
        request_id,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let mut input = PreparationInput {
        text_length: content.text_length,
        units,
        figures: content.figures.clone(),
        flow: Vec::new(),
    };
    if let Err(reason) = normalize_input(&mut input) {
        return Transition {
            state: ReaderSessionState::Error {
                request_id: Some(request_id.clone()),
                reason,
                generation: generation.saturating_add(1),
            },
            effects: vec![ReaderSessionEffect::CancelTimer],
        };
    }
    let rebuilt: Arc<SessionContent> = input.into();
    let target_flow_index = find_flow_index(&rebuilt.flow, &rebuilt.units, &position);
    let Some(item) = rebuilt.flow.get(target_flow_index) else {
        return unchanged(state);
    };
    let (target_position, _) = position_and_playback(item, &rebuilt.units);
    let target_is_figure = item.is_figure();
    let next_playback = if target_is_figure || matches!(mode, Mode::Text) {
        Playback::Paused
    } else {
        playback.clone()
    };
    let next_generation = generation.saturating_add(1);
    let next = ReaderSessionState::Reading {
        mode: mode.clone(),
        playback: next_playback.clone(),
        content: rebuilt,
        flow_index: target_flow_index,
        position: if target_is_figure {
            target_position
        } else {
            position
        },
        generation: next_generation,
        request_id: request_id.clone(),
    };
    let mut effects = vec![ReaderSessionEffect::CancelTimer];
    if matches!(next_playback, Playback::Playing)
        && let ReaderSessionState::Reading { content, .. } = &next
    {
        effects.push(schedule_effect(content, target_flow_index, next_generation));
    }
    Transition {
        state: next,
        effects,
    }
}

fn close(state: &ReaderSessionState) -> Transition {
    Transition {
        state: ReaderSessionState::Ended {
            generation: state.generation().saturating_add(1),
        },
        effects: vec![ReaderSessionEffect::CancelTimer],
    }
}

fn unchanged(state: &ReaderSessionState) -> Transition {
    Transition {
        state: state.clone(),
        effects: Vec::new(),
    }
}

fn position_and_playback(item: &FlowItem, units: &[ReaderUnit]) -> (Position, Playback) {
    match item {
        FlowItem::Unit {
            source_offset,
            unit_index,
        } => (
            Position::Text {
                source_offset: units
                    .get(*unit_index)
                    .map_or(*source_offset, |unit| unit.start),
            },
            Playback::Playing,
        ),
        FlowItem::Figure {
            source_offset,
            figure_index,
        } => (
            Position::Figure {
                source_offset: *source_offset,
                figure_index: *figure_index,
            },
            Playback::Paused,
        ),
    }
}

fn schedule_effect(content: &SessionContent, index: usize, generation: u64) -> ReaderSessionEffect {
    let Some(FlowItem::Unit { unit_index, .. }) = content.flow.get(index) else {
        return ReaderSessionEffect::CancelTimer;
    };
    let Some(unit) = content.units.get(*unit_index) else {
        return ReaderSessionEffect::CancelTimer;
    };
    ReaderSessionEffect::ScheduleTick {
        generation,
        delay_ms: unit.duration_ms.max(1),
    }
}

fn previous_sentence_start(units: &[ReaderUnit], current: usize) -> usize {
    if units.is_empty() {
        return 0;
    }
    let first_of_current = sentence_start(units, current);
    if first_of_current == 0 {
        return 0;
    }
    let previous_sentence = units[first_of_current - 1].sentence_index;
    let mut target = first_of_current - 1;
    while target > 0 && units[target - 1].sentence_index == previous_sentence {
        target -= 1;
    }
    target
}

fn sentence_start(units: &[ReaderUnit], current: usize) -> usize {
    if units.is_empty() {
        return 0;
    }
    let safe = current.min(units.len() - 1);
    let sentence = units[safe].sentence_index;
    let mut first = safe;
    while first > 0 && units[first - 1].sentence_index == sentence {
        first -= 1;
    }
    first
}

fn find_flow_index(flow: &[FlowItem], units: &[ReaderUnit], position: &Position) -> usize {
    if flow.is_empty() {
        return 0;
    }
    if let Position::Figure { figure_index, .. } = position
        && let Some(index) = flow.iter().position(|item| {
            matches!(item, FlowItem::Figure { figure_index: candidate, .. } if candidate == figure_index)
        })
    {
        return index;
    }
    if let Position::Text { source_offset } = position {
        let unit_index = units
            .iter()
            .position(|unit| unit.start <= *source_offset && *source_offset < unit.end)
            .or_else(|| units.iter().position(|unit| unit.start >= *source_offset))
            .unwrap_or_else(|| units.len().saturating_sub(1));
        if let Some(index) = flow.iter().position(|item| {
            matches!(item, FlowItem::Unit { unit_index: candidate, .. } if candidate == &unit_index)
        }) {
            return index;
        }
    }
    flow.iter()
        .enumerate()
        .min_by_key(|(_, item)| {
            (item.source_offset() as isize - position.source_offset() as isize).unsigned_abs()
        })
        .map_or(0, |(index, _)| index)
}

fn normalize_input(input: &mut PreparationInput) -> Result<(), PreparationFailure> {
    if input.text_length == 0 || input.units.is_empty() {
        return Err(PreparationFailure::InvalidFlow);
    }
    for unit in &input.units {
        if unit.start >= unit.end || unit.end > input.text_length || unit.duration_ms == 0 {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    for pair in input.units.windows(2) {
        if pair[0].start >= pair[1].start || pair[0].end > pair[1].start {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    for figure in &input.figures {
        if figure.source_offset > figure.source_end || figure.source_end > input.text_length {
            return Err(PreparationFailure::InvalidFlow);
        }
        if input
            .units
            .iter()
            .any(|unit| figure.source_offset < unit.end && unit.start < figure.source_end)
        {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    if input.flow.is_empty() {
        input
            .flow
            .extend(
                input
                    .units
                    .iter()
                    .enumerate()
                    .map(|(unit_index, unit)| FlowItem::Unit {
                        source_offset: unit.start,
                        unit_index,
                    }),
            );
        input.flow.extend(
            input
                .figures
                .iter()
                .enumerate()
                .map(|(figure_index, figure)| FlowItem::Figure {
                    source_offset: figure.source_offset,
                    figure_index,
                }),
        );
    }
    let mut seen = Vec::new();
    for item in &input.flow {
        match item {
            FlowItem::Unit {
                unit_index,
                source_offset,
            } => {
                let Some(unit) = input.units.get(*unit_index) else {
                    return Err(PreparationFailure::InvalidFlow);
                };
                if *source_offset > input.text_length
                    || unit.start != *source_offset
                    || seen
                        .iter()
                        .any(|candidate: &(bool, usize)| !candidate.0 && candidate.1 == *unit_index)
                {
                    return Err(PreparationFailure::InvalidFlow);
                }
                seen.push((false, *unit_index));
            }
            FlowItem::Figure {
                figure_index,
                source_offset,
            } => {
                let Some(figure) = input.figures.get(*figure_index) else {
                    return Err(PreparationFailure::InvalidFlow);
                };
                if *source_offset > input.text_length
                    || figure.source_offset != *source_offset
                    || seen.iter().any(|candidate: &(bool, usize)| {
                        candidate.0 && candidate.1 == *figure_index
                    })
                {
                    return Err(PreparationFailure::InvalidFlow);
                }
                seen.push((true, *figure_index));
            }
        }
    }
    if input.units.iter().enumerate().any(|(unit_index, _)| {
        !seen
            .iter()
            .any(|candidate: &(bool, usize)| !candidate.0 && candidate.1 == unit_index)
    }) || input.figures.iter().enumerate().any(|(figure_index, _)| {
        !seen
            .iter()
            .any(|candidate: &(bool, usize)| candidate.0 && candidate.1 == figure_index)
    }) {
        return Err(PreparationFailure::InvalidFlow);
    }
    input.flow.sort_by(|left, right| {
        left.source_offset()
            .cmp(&right.source_offset())
            .then_with(|| match (left, right) {
                (
                    FlowItem::Figure {
                        figure_index: left, ..
                    },
                    FlowItem::Figure {
                        figure_index: right,
                        ..
                    },
                ) => left.cmp(right),
                (
                    FlowItem::Unit {
                        unit_index: left, ..
                    },
                    FlowItem::Unit {
                        unit_index: right, ..
                    },
                ) => left.cmp(right),
                (FlowItem::Figure { .. }, FlowItem::Unit { .. }) => Ordering::Less,
                (FlowItem::Unit { .. }, FlowItem::Figure { .. }) => Ordering::Greater,
            })
    });
    if input.flow.is_empty() {
        return Err(PreparationFailure::InvalidFlow);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effect::ReaderSessionEffect;
    use crate::state::ReaderUnitKind;

    fn input() -> PreparationInput {
        let units = vec![
            ReaderUnit {
                sentence_index: 0,
                kind: ReaderUnitKind::Body,
                start: 0,
                end: 3,
                duration_ms: 10,
            },
            ReaderUnit {
                sentence_index: 1,
                kind: ReaderUnitKind::Body,
                start: 3,
                end: 5,
                duration_ms: 20,
            },
            ReaderUnit {
                sentence_index: 2,
                kind: ReaderUnitKind::Body,
                start: 5,
                end: 8,
                duration_ms: 30,
            },
        ];
        PreparationInput {
            text_length: 8,
            units,
            figures: vec![crate::state::Figure {
                source_offset: 3,
                source_end: 3,
            }],
            flow: vec![
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
            ],
        }
    }

    fn figure_after_third_sentence_input() -> PreparationInput {
        PreparationInput {
            text_length: 11,
            units: vec![
                ReaderUnit {
                    sentence_index: 0,
                    kind: ReaderUnitKind::Body,
                    start: 0,
                    end: 2,
                    duration_ms: 10,
                },
                ReaderUnit {
                    sentence_index: 1,
                    kind: ReaderUnitKind::Body,
                    start: 2,
                    end: 5,
                    duration_ms: 20,
                },
                ReaderUnit {
                    sentence_index: 2,
                    kind: ReaderUnitKind::Body,
                    start: 5,
                    end: 8,
                    duration_ms: 30,
                },
                ReaderUnit {
                    sentence_index: 3,
                    kind: ReaderUnitKind::Body,
                    start: 8,
                    end: 11,
                    duration_ms: 40,
                },
            ],
            figures: vec![crate::state::Figure {
                source_offset: 8,
                source_end: 8,
            }],
            flow: vec![
                FlowItem::Unit {
                    source_offset: 0,
                    unit_index: 0,
                },
                FlowItem::Unit {
                    source_offset: 2,
                    unit_index: 1,
                },
                FlowItem::Unit {
                    source_offset: 5,
                    unit_index: 2,
                },
                FlowItem::Figure {
                    source_offset: 8,
                    figure_index: 0,
                },
                FlowItem::Unit {
                    source_offset: 8,
                    unit_index: 3,
                },
            ],
        }
    }

    fn reading() -> ReaderSessionState {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        )
        .state;
        reduce(
            &opened,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: input(),
            },
        )
        .state
    }

    #[test]
    fn starts_with_precomputed_duration() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        );
        let started = reduce(
            &opened.state,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: input(),
            },
        );
        assert!(matches!(
            started.state,
            ReaderSessionState::Reading {
                playback: Playback::Playing,
                flow_index: 0,
                generation: 2,
                ..
            }
        ));
        assert!(started.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick {
                generation: 2,
                delay_ms: 10
            }
        )));
    }

    #[test]
    fn stale_request_and_timer_are_ignored() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        )
        .state;
        let newer = reduce(
            &opened,
            ReaderSessionCommand::Open {
                request_id: "B".into(),
            },
        )
        .state;
        let late = reduce(
            &newer,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: input(),
            },
        );
        assert_eq!(late.state, newer);
        let late_failure = reduce(
            &newer,
            ReaderSessionCommand::PrepareFailed {
                request_id: "A".into(),
                reason: PreparationFailure::ExtractionFailed,
            },
        );
        assert_eq!(late_failure.state, newer);
        assert!(late_failure.effects.is_empty());
        let started = reduce(
            &newer,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "B".into(),
                flow: input(),
            },
        )
        .state;
        assert_eq!(
            reduce(&started, ReaderSessionCommand::Tick { generation: 1 }).state,
            started
        );
    }

    #[test]
    fn figure_previous_sentence_starts_playback() {
        let started = reading();
        let figure = reduce(
            &started,
            ReaderSessionCommand::Tick {
                generation: started.generation(),
            },
        )
        .state;
        let previous = reduce(&figure, ReaderSessionCommand::PreviousSentence);
        assert!(matches!(
            previous.state,
            ReaderSessionState::Reading {
                flow_index: 0,
                playback: Playback::Playing,
                ..
            }
        ));
        assert!(previous.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick { delay_ms: 10, .. }
        )));
    }

    #[test]
    fn figure_previous_sentence_returns_to_the_sentence_before_a_late_figure() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        )
        .state;
        let started = reduce(
            &opened,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: figure_after_third_sentence_input(),
            },
        )
        .state;
        let second = reduce(
            &started,
            ReaderSessionCommand::Tick {
                generation: started.generation(),
            },
        )
        .state;
        let third = reduce(
            &second,
            ReaderSessionCommand::Tick {
                generation: second.generation(),
            },
        )
        .state;
        let figure = reduce(
            &third,
            ReaderSessionCommand::Tick {
                generation: third.generation(),
            },
        )
        .state;
        assert!(matches!(
            figure,
            ReaderSessionState::Reading {
                flow_index: 3,
                playback: Playback::Paused,
                ..
            }
        ));
        let previous = reduce(&figure, ReaderSessionCommand::PreviousSentence);
        assert!(matches!(
            previous.state,
            ReaderSessionState::Reading {
                flow_index: 2,
                playback: Playback::Playing,
                position: Position::Text { source_offset: 5 },
                ..
            }
        ));
        assert!(previous.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick { delay_ms: 30, .. }
        )));
    }

    #[test]
    fn tick_stops_at_figure_and_resume_schedules_next_unit() {
        let started = reading();
        let figure = reduce(&started, ReaderSessionCommand::Tick { generation: 2 });
        assert!(matches!(
            figure.state,
            ReaderSessionState::Reading {
                flow_index: 1,
                playback: Playback::Paused,
                ..
            }
        ));
        let resumed = reduce(&figure.state, ReaderSessionCommand::ResumeFromFigure);
        assert!(matches!(
            resumed.state,
            ReaderSessionState::Reading {
                flow_index: 2,
                playback: Playback::Playing,
                ..
            }
        ));
        assert!(resumed.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick { delay_ms: 20, .. }
        )));
    }

    #[test]
    fn text_to_rsvp_round_trip_preserves_a_paused_unit() {
        let paused = reduce(&reading(), ReaderSessionCommand::Pause).state;
        let text = reduce(
            &paused,
            ReaderSessionCommand::SwitchToText {
                position: Position::Text { source_offset: 0 },
            },
        )
        .state;
        let rsvp = reduce(
            &text,
            ReaderSessionCommand::SwitchToRsvp {
                position: Position::Text { source_offset: 0 },
            },
        );

        assert!(matches!(
            rsvp.state,
            ReaderSessionState::Reading {
                mode: Mode::Rsvp,
                playback: Playback::Paused,
                flow_index: 0,
                ..
            }
        ));
        assert!(
            rsvp.effects
                .iter()
                .all(|effect| matches!(effect, ReaderSessionEffect::CancelTimer))
        );
    }

    #[test]
    fn close_cannot_be_revived() {
        let ended = reduce(&reading(), ReaderSessionCommand::Close).state;
        let later = reduce(
            &ended,
            ReaderSessionCommand::Open {
                request_id: "B".into(),
            },
        );
        assert_eq!(later.state, ended);
        assert!(later.effects.is_empty());
    }

    #[test]
    fn non_reading_observables_have_no_content_kind() {
        let idle = initial_state().observable();
        assert_eq!(idle.current_kind, "none");
        assert_eq!(idle.position, None);
        assert_eq!(idle.unit_index, None);
        assert_eq!(idle.figure_index, None);

        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        );
        assert_eq!(opened.state.observable().current_kind, "none");

        let failed = reduce(
            &opened.state,
            ReaderSessionCommand::PrepareFailed {
                request_id: "A".into(),
                reason: PreparationFailure::SessionUnavailable,
            },
        );
        assert_eq!(failed.state.observable().current_kind, "none");
        assert_eq!(
            failed.state.observable().reason.as_deref(),
            Some("session_unavailable")
        );

        let ended = reduce(&failed.state, ReaderSessionCommand::Close);
        assert_eq!(ended.state.observable().current_kind, "none");
        assert_eq!(ended.state.observable().position, None);
    }

    #[test]
    fn rejects_a_supplied_flow_that_skips_metadata() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        );
        let mut incomplete = input();
        incomplete.flow.retain(|item| !item.is_figure());
        let failed = reduce(
            &opened.state,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: incomplete,
            },
        );
        assert!(matches!(
            failed.state,
            ReaderSessionState::Error {
                reason: PreparationFailure::InvalidFlow,
                ..
            }
        ));
    }
}
