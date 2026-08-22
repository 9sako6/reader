use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::command::ReaderSessionCommand;
use crate::effect::ReaderSessionEffect;
use crate::state::{
    FlowItem, Mode, Playback, Position, PreparationFailure, PreparationInput, ReaderSessionState,
    ReaderTimingProfile, ReaderUnit,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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
        ReaderSessionCommand::VisibilityHidden => visibility_hidden(state),
        ReaderSessionCommand::Close => close(state),
    }
}

fn open(state: &ReaderSessionState, request_id: String) -> Transition {
    let generation = state.generation().saturating_add(1);
    let effects = if matches!(state, ReaderSessionState::Reading { .. }) {
        vec![ReaderSessionEffect::CancelTimer]
    } else {
        Vec::new()
    };
    Transition {
        state: ReaderSessionState::Preparing {
            request_id,
            generation,
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
    if *active_request != request_id {
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
    let first = input.flow.first().expect("validated flow is non-empty");
    let (position, playback) = position_and_playback(first, &input.units);
    let next_generation = generation.saturating_add(1);
    let effects = if matches!(playback, Playback::Playing) {
        vec![schedule_effect(&input, &input.flow, 0, next_generation)]
    } else {
        vec![ReaderSessionEffect::CancelTimer]
    };
    Transition {
        state: ReaderSessionState::Reading {
            mode: Mode::Rsvp,
            playback,
            text_length: input.text_length,
            units: input.units,
            figures: input.figures,
            flow: input.flow,
            flow_index: 0,
            position,
            timing_profile: input.timing_profile,
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
    if *active_request != request_id {
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
    if *active_request != request_id {
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
        flow,
        flow_index,
        units,
        timing_profile,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let Some(FlowItem::Unit { .. }) = flow.get(*flow_index) else {
        return unchanged(state);
    };
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
        effects: vec![schedule_effect_for_current(
            units,
            flow,
            *flow_index,
            timing_profile,
            next_generation,
        )],
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
    let effects = if matches!(playback, Playback::Playing) {
        vec![ReaderSessionEffect::CancelTimer]
    } else {
        Vec::new()
    };
    Transition {
        state: next,
        effects,
    }
}

fn tick(state: &ReaderSessionState, generation: u64) -> Transition {
    let ReaderSessionState::Reading {
        playback: Playback::Playing,
        flow,
        flow_index,
        units,
        timing_profile,
        ..
    } = state
    else {
        return unchanged(state);
    };
    if state.generation() != generation {
        return unchanged(state);
    }
    let next_index = flow_index.saturating_add(1);
    let Some(next_item) = flow.get(next_index) else {
        return pause(state);
    };
    let (position, playback) = position_and_playback(next_item, units);
    let next_generation = state.generation().saturating_add(1);
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
        vec![schedule_effect_for_current(
            units,
            flow,
            next_index,
            timing_profile,
            next_generation,
        )]
    };
    Transition {
        state: next,
        effects,
    }
}

fn previous_sentence(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        playback,
        flow,
        flow_index,
        units,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let was_playing = matches!(playback, Playback::Playing);
    let Some(current_item) = flow.get(*flow_index) else {
        return unchanged(state);
    };
    let current_unit_index = match current_item {
        FlowItem::Unit { unit_index, .. } => *unit_index,
        FlowItem::Figure { source_offset, .. } => units
            .iter()
            .enumerate()
            .filter(|(_, unit)| unit.end <= *source_offset)
            .map(|(index, _)| index)
            .next_back()
            .unwrap_or(0),
    };
    let target_unit_index = previous_sentence_start(units, current_unit_index);
    let Some(target_unit) = units.get(target_unit_index) else {
        return unchanged(state);
    };
    let target_position = Position::Text {
        source_offset: target_unit.start,
    };
    let target_flow_index = find_flow_index(flow, units, &target_position);
    if target_flow_index >= flow.len() {
        return unchanged(state);
    }
    let next_generation = generation.saturating_add(1);
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
        *playback = if was_playing {
            Playback::Playing
        } else {
            Playback::Paused
        };
        *generation = next_generation;
    }
    let mut effects = vec![ReaderSessionEffect::CancelTimer];
    if was_playing {
        if let ReaderSessionState::Reading {
            flow,
            units,
            timing_profile,
            ..
        } = &next
        {
            effects.push(schedule_effect_for_current(
                units,
                flow,
                target_flow_index,
                timing_profile,
                next_generation,
            ));
        }
    }
    Transition {
        state: next,
        effects,
    }
}

fn resume_from_figure(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Reading {
        flow,
        flow_index,
        units,
        mode,
        timing_profile,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let Some(FlowItem::Figure { .. }) = flow.get(*flow_index) else {
        return unchanged(state);
    };
    let next_index = flow_index.saturating_add(1);
    let Some(next_item) = flow.get(next_index) else {
        return pause(state);
    };
    let (position, next_playback) = position_and_playback(next_item, units);
    let next_playback = if matches!(mode, Mode::Rsvp) {
        next_playback
    } else {
        Playback::Paused
    };
    let next_generation = generation.saturating_add(1);
    let mut next = state.clone();
    if let ReaderSessionState::Reading {
        flow_index,
        position: current_position,
        playback,
        generation,
        ..
    } = &mut next
    {
        *flow_index = next_index;
        *current_position = position;
        *playback = next_playback.clone();
        *generation = next_generation;
    }
    let effects = if matches!(next_playback, Playback::Playing) {
        vec![schedule_effect_for_current(
            units,
            flow,
            next_index,
            timing_profile,
            next_generation,
        )]
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
        units,
        flow,
        generation,
        timing_profile,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let target_flow_index = find_flow_index(flow, units, &position);
    let Some(item) = flow.get(target_flow_index) else {
        return unchanged(state);
    };
    let (target_position, target_playback) = match mode {
        Mode::Text => (position, Playback::Paused),
        Mode::Rsvp => position_and_playback(item, units),
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
        effects.push(schedule_effect_for_current(
            units,
            flow,
            target_flow_index,
            timing_profile,
            next_generation,
        ));
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
        text_length,
        figures,
        mode,
        playback,
        timing_profile,
        generation,
        request_id,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let mut input = PreparationInput {
        text_length: *text_length,
        units,
        figures: figures.clone(),
        flow: Vec::new(),
        timing_profile: timing_profile.clone(),
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
    let target_flow_index = find_flow_index(&input.flow, &input.units, &position);
    let Some(item) = input.flow.get(target_flow_index).cloned() else {
        return unchanged(state);
    };
    let (target_position, _) = position_and_playback(&item, &input.units);
    let next_playback = if item.is_figure() || matches!(mode, Mode::Text) {
        Playback::Paused
    } else {
        playback.clone()
    };
    let next_generation = generation.saturating_add(1);
    let next = ReaderSessionState::Reading {
        mode: mode.clone(),
        playback: next_playback.clone(),
        text_length: input.text_length,
        units: input.units,
        figures: input.figures,
        flow: input.flow,
        flow_index: target_flow_index,
        position: if item.is_figure() {
            target_position
        } else {
            position
        },
        timing_profile: input.timing_profile,
        generation: next_generation,
        request_id: request_id.clone(),
    };
    let mut effects = vec![ReaderSessionEffect::CancelTimer];
    if matches!(next_playback, Playback::Playing) {
        if let ReaderSessionState::Reading {
            flow,
            units,
            timing_profile,
            ..
        } = &next
        {
            effects.push(schedule_effect_for_current(
                units,
                flow,
                target_flow_index,
                timing_profile,
                next_generation,
            ));
        }
    }
    Transition {
        state: next,
        effects,
    }
}

fn visibility_hidden(state: &ReaderSessionState) -> Transition {
    pause(state)
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

fn schedule_effect(
    input: &PreparationInput,
    flow: &[FlowItem],
    index: usize,
    generation: u64,
) -> ReaderSessionEffect {
    schedule_effect_for_current(&input.units, flow, index, &input.timing_profile, generation)
}

fn schedule_effect_for_current(
    units: &[ReaderUnit],
    flow: &[FlowItem],
    index: usize,
    profile: &ReaderTimingProfile,
    generation: u64,
) -> ReaderSessionEffect {
    let Some(FlowItem::Unit { unit_index, .. }) = flow.get(index) else {
        return ReaderSessionEffect::CancelTimer;
    };
    let unit = &units[*unit_index];
    let next_unit = flow[index.saturating_add(1)..]
        .iter()
        .find_map(|item| match item {
            FlowItem::Unit { unit_index, .. } => units.get(*unit_index),
            FlowItem::Figure { .. } => None,
        });
    ReaderSessionEffect::ScheduleTick {
        generation,
        delay_ms: profile.duration_for(unit, next_unit, false),
    }
}

fn previous_sentence_start(units: &[ReaderUnit], current: usize) -> usize {
    if units.is_empty() {
        return 0;
    }
    let safe = current.min(units.len() - 1);
    if safe == 0 {
        return 0;
    }
    let sentence = units[safe].sentence_index;
    let mut first_of_current = safe;
    while first_of_current > 0 && units[first_of_current - 1].sentence_index == sentence {
        first_of_current -= 1;
    }
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

fn find_flow_index(flow: &[FlowItem], units: &[ReaderUnit], position: &Position) -> usize {
    if flow.is_empty() {
        return 0;
    }
    if let Position::Figure { figure_index, .. } = position {
        if let Some(index) = flow.iter().position(|item| matches!(item, FlowItem::Figure { figure_index: candidate, .. } if candidate == figure_index)) {
            return index;
        }
    }
    if let Position::Text { source_offset } = position {
        let unit_index = units
            .iter()
            .position(|unit| unit.start <= *source_offset && *source_offset < unit.end)
            .or_else(|| units.iter().position(|unit| unit.start >= *source_offset))
            .unwrap_or_else(|| units.len().saturating_sub(1));
        if let Some(index) = flow.iter().position(|item| matches!(item, FlowItem::Unit { unit_index: candidate, .. } if candidate == &unit_index)) {
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
    if input.text_length == 0
        || input.units.is_empty()
        || (input.flow.is_empty() && input.figures.is_empty())
    {
        return Err(PreparationFailure::InvalidFlow);
    }
    for unit in &input.units {
        if unit.start >= unit.end || unit.end > input.text_length {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    for figure in &input.figures {
        if figure.source_offset > figure.source_end || figure.source_end > input.text_length {
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
    use crate::command::ReaderSessionCommand;
    use crate::effect::ReaderSessionEffect;
    use crate::state::{Figure, ReaderUnitKind};

    fn input() -> PreparationInput {
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
    fn starts_on_first_unit_and_schedules_with_generation() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        );
        assert!(matches!(opened.state, ReaderSessionState::Preparing { .. }));
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
            ReaderSessionEffect::ScheduleTick { generation: 2, .. }
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
        let started = reduce(
            &newer,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "B".into(),
                flow: input(),
            },
        )
        .state;
        let late_tick = reduce(&started, ReaderSessionCommand::Tick { generation: 1 });
        assert_eq!(late_tick.state, started);
    }

    #[test]
    fn tick_pauses_on_figure_and_resume_advances_to_unit() {
        let started = reading();
        let figure = reduce(
            &started,
            ReaderSessionCommand::Tick {
                generation: started.generation(),
            },
        );
        assert!(matches!(
            figure.state,
            ReaderSessionState::Reading {
                flow_index: 1,
                playback: Playback::Paused,
                generation: 3,
                ..
            }
        ));
        assert!(
            figure
                .effects
                .iter()
                .any(|effect| matches!(effect, ReaderSessionEffect::CancelTimer))
        );
        let resumed = reduce(&figure.state, ReaderSessionCommand::ResumeFromFigure);
        assert!(matches!(
            resumed.state,
            ReaderSessionState::Reading {
                flow_index: 2,
                playback: Playback::Playing,
                ..
            }
        ));
    }

    #[test]
    fn previous_sentence_preserves_playback_and_invalidates_timer() {
        let started = reading();
        let figure = reduce(
            &started,
            ReaderSessionCommand::Tick {
                generation: started.generation(),
            },
        )
        .state;
        let resumed = reduce(&figure, ReaderSessionCommand::ResumeFromFigure).state;
        let next = reduce(
            &resumed,
            ReaderSessionCommand::Tick {
                generation: resumed.generation(),
            },
        )
        .state;
        let previous = reduce(&next, ReaderSessionCommand::PreviousSentence);
        assert!(matches!(
            previous.state,
            ReaderSessionState::Reading {
                flow_index: 2,
                playback: Playback::Playing,
                ..
            }
        ));
        assert!(
            previous
                .effects
                .iter()
                .any(|effect| matches!(effect, ReaderSessionEffect::CancelTimer))
        );
    }

    #[test]
    fn close_discards_content_and_rejects_late_commands() {
        let started = reading();
        let closed = reduce(&started, ReaderSessionCommand::Close);
        assert!(matches!(closed.state, ReaderSessionState::Ended { .. }));
        let encoded = serde_json::to_string(&closed.state).unwrap();
        assert!(!encoded.contains("units"));
        assert!(!encoded.contains("figures"));
        assert!(!encoded.contains("flow"));
        let late = reduce(
            &closed.state,
            ReaderSessionCommand::Tick { generation: 999 },
        );
        assert!(late.effects.is_empty());
        assert_eq!(late.state, closed.state);
    }

    #[test]
    fn visibility_hidden_pauses_and_cancels() {
        let started = reading();
        let hidden = reduce(&started, ReaderSessionCommand::VisibilityHidden);
        assert!(matches!(
            hidden.state,
            ReaderSessionState::Reading {
                playback: Playback::Paused,
                ..
            }
        ));
        assert!(
            hidden
                .effects
                .iter()
                .any(|effect| matches!(effect, ReaderSessionEffect::CancelTimer))
        );
    }

    #[test]
    fn invalid_flow_enters_error_without_retaining_content() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        )
        .state;
        let invalid = PreparationInput {
            text_length: 2,
            units: Vec::new(),
            figures: Vec::new(),
            flow: Vec::new(),
            timing_profile: ReaderTimingProfile::default(),
        };
        let failed = reduce(
            &opened,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: invalid,
            },
        );
        assert!(matches!(
            failed.state,
            ReaderSessionState::Error {
                reason: PreparationFailure::InvalidFlow,
                ..
            }
        ));
        let encoded = serde_json::to_string(&failed.state).unwrap();
        assert!(!encoded.contains("units"));
    }
}
