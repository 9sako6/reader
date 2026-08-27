use std::cmp::Ordering;

use crate::command::ReaderSessionCommand;
use crate::effect::ReaderSessionEffect;
use crate::state::{
    FlowItem, Mode, Playback, Position, PreparationFailure, PreparationInput, ReaderSessionState,
    SessionContent, Spot,
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
        ReaderSessionCommand::SwitchToPage { position } => switch_mode(state, Mode::Page, position),
        ReaderSessionCommand::SwitchToSpots { position } => {
            switch_mode(state, Mode::Spots, position)
        }
        ReaderSessionCommand::ResumeFromFigure => resume_from_figure(state),
        ReaderSessionCommand::RebuildSpots { spots, position } => {
            rebuild_spots(state, spots, position)
        }
        ReaderSessionCommand::VisibilityHidden => visibility_hidden(state),
        ReaderSessionCommand::Close => close(state),
    }
}

fn visibility_hidden(state: &ReaderSessionState) -> Transition {
    let ReaderSessionState::Preparing {
        visibility_hidden: already_hidden,
        generation,
        ..
    } = state
    else {
        return pause(state);
    };
    if *already_hidden {
        return unchanged(state);
    }
    let mut next = state.clone();
    if let ReaderSessionState::Preparing {
        visibility_hidden,
        generation: next_generation,
        ..
    } = &mut next
    {
        *visibility_hidden = true;
        *next_generation = generation.saturating_add(1);
    }
    Transition {
        state: next,
        effects: Vec::new(),
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
            visibility_hidden: false,
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
        visibility_hidden,
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
    let (position, inferred_playback) = position_and_playback(first, &content.spots);
    let playback = if *visibility_hidden {
        Playback::Paused
    } else {
        inferred_playback
    };
    let next_generation = generation.saturating_add(1);
    let effects = if matches!(playback, Playback::Playing) {
        vec![schedule_effect(&content, 0, next_generation)]
    } else {
        vec![ReaderSessionEffect::CancelTimer]
    };
    Transition {
        state: ReaderSessionState::Reading {
            mode: Mode::Spots,
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
        ..
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
        ..
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
        mode: Mode::Spots,
        playback: Playback::Paused,
        content,
        flow_index,
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    if !matches!(content.flow.get(*flow_index), Some(FlowItem::Spot { .. })) {
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
    let (position, playback) = position_and_playback(next_item, &content.spots);
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
    let current_spot_index = match current_item {
        FlowItem::Spot { spot_index, .. } => *spot_index,
        FlowItem::Figure { source_offset, .. } => content
            .spots
            .iter()
            .enumerate()
            .filter(|(_, spot)| spot.end <= *source_offset)
            .map(|(index, _)| index)
            .next_back()
            .unwrap_or(0),
    };
    let target_spot_index = if was_figure {
        sentence_start(&content.spots, current_spot_index)
    } else {
        previous_sentence_start(&content.spots, current_spot_index)
    };
    let Some(target_spot) = content.spots.get(target_spot_index) else {
        return unchanged(state);
    };
    let target_position = Position::Text {
        source_offset: target_spot.start,
    };
    let target_flow_index = find_flow_index(&content.flow, &content.spots, &target_position);
    if target_flow_index >= content.flow.len() {
        return unchanged(state);
    }
    let next_generation = generation.saturating_add(1);
    let target_playback = if matches!(mode, Mode::Spots) && was_playing {
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
    let (position, mut playback) = position_and_playback(next_item, &content.spots);
    if matches!(mode, Mode::Page) {
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
        generation,
        ..
    } = state
    else {
        return unchanged(state);
    };
    let initial_flow_index = find_flow_index(&content.flow, &content.spots, &position);
    let Some(initial_item) = content.flow.get(initial_flow_index) else {
        return unchanged(state);
    };
    let (target_flow_index, target_position, target_playback) = match mode {
        Mode::Page => (initial_flow_index, position, Playback::Paused),
        Mode::Spots => {
            let target_flow_index = match initial_item {
                FlowItem::Spot { spot_index, .. } => {
                    let sentence_head = sentence_start(&content.spots, *spot_index);
                    let sentence_position = Position::Text {
                        source_offset: content.spots[sentence_head].start,
                    };
                    find_flow_index(&content.flow, &content.spots, &sentence_position)
                }
                FlowItem::Figure { .. } => initial_flow_index,
            };
            let Some(target_item) = content.flow.get(target_flow_index) else {
                return unchanged(state);
            };
            let (target_position, target_playback) =
                position_and_playback(target_item, &content.spots);
            (target_flow_index, target_position, target_playback)
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

fn rebuild_spots(state: &ReaderSessionState, spots: Vec<Spot>, position: Position) -> Transition {
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
        spots,
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
    let target_flow_index = find_flow_index(&rebuilt.flow, &rebuilt.spots, &position);
    let Some(item) = rebuilt.flow.get(target_flow_index) else {
        return unchanged(state);
    };
    let (target_position, _) = position_and_playback(item, &rebuilt.spots);
    let target_is_figure = item.is_figure();
    let next_playback = if target_is_figure || matches!(mode, Mode::Page) {
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

fn position_and_playback(item: &FlowItem, spots: &[Spot]) -> (Position, Playback) {
    match item {
        FlowItem::Spot {
            source_offset,
            spot_index,
        } => (
            Position::Text {
                source_offset: spots
                    .get(*spot_index)
                    .map_or(*source_offset, |spot| spot.start),
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
    let Some(FlowItem::Spot { spot_index, .. }) = content.flow.get(index) else {
        return ReaderSessionEffect::CancelTimer;
    };
    let Some(spot) = content.spots.get(*spot_index) else {
        return ReaderSessionEffect::CancelTimer;
    };
    ReaderSessionEffect::ScheduleTick {
        generation,
        delay_ms: spot.duration_ms.max(1),
    }
}

fn previous_sentence_start(spots: &[Spot], current: usize) -> usize {
    if spots.is_empty() {
        return 0;
    }
    let first_of_current = sentence_start(spots, current);
    if first_of_current == 0 {
        return 0;
    }
    let previous_sentence = spots[first_of_current - 1].sentence_index;
    let mut target = first_of_current - 1;
    while target > 0 && spots[target - 1].sentence_index == previous_sentence {
        target -= 1;
    }
    target
}

fn sentence_start(spots: &[Spot], current: usize) -> usize {
    if spots.is_empty() {
        return 0;
    }
    let safe = current.min(spots.len() - 1);
    let sentence = spots[safe].sentence_index;
    let mut first = safe;
    while first > 0 && spots[first - 1].sentence_index == sentence {
        first -= 1;
    }
    first
}

fn find_flow_index(flow: &[FlowItem], spots: &[Spot], position: &Position) -> usize {
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
        let spot_index = spots
            .iter()
            .position(|spot| spot.start <= *source_offset && *source_offset < spot.end)
            .or_else(|| spots.iter().position(|spot| spot.start >= *source_offset))
            .unwrap_or_else(|| spots.len().saturating_sub(1));
        if let Some(index) = flow.iter().position(|item| {
            matches!(item, FlowItem::Spot { spot_index: candidate, .. } if candidate == &spot_index)
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
    if input.text_length == 0 || input.spots.is_empty() {
        return Err(PreparationFailure::InvalidFlow);
    }
    for spot in &input.spots {
        if spot.start >= spot.end || spot.end > input.text_length || spot.duration_ms == 0 {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    for pair in input.spots.windows(2) {
        if pair[0].start >= pair[1].start || pair[0].end > pair[1].start {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    for figure in &input.figures {
        if figure.source_offset > figure.source_end || figure.source_end > input.text_length {
            return Err(PreparationFailure::InvalidFlow);
        }
        let first_overlapping_spot = input
            .spots
            .partition_point(|spot| spot.end <= figure.source_offset);
        if input
            .spots
            .get(first_overlapping_spot)
            .is_some_and(|spot| spot.start < figure.source_end)
        {
            return Err(PreparationFailure::InvalidFlow);
        }
    }
    if input.flow.is_empty() {
        input
            .flow
            .extend(
                input
                    .spots
                    .iter()
                    .enumerate()
                    .map(|(spot_index, spot)| FlowItem::Spot {
                        source_offset: spot.start,
                        spot_index,
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
    let mut seen_spots = vec![false; input.spots.len()];
    let mut seen_figures = vec![false; input.figures.len()];
    for item in &input.flow {
        match item {
            FlowItem::Spot {
                spot_index,
                source_offset,
            } => {
                let Some(spot) = input.spots.get(*spot_index) else {
                    return Err(PreparationFailure::InvalidFlow);
                };
                if *source_offset > input.text_length
                    || spot.start != *source_offset
                    || seen_spots[*spot_index]
                {
                    return Err(PreparationFailure::InvalidFlow);
                }
                seen_spots[*spot_index] = true;
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
                    || seen_figures[*figure_index]
                {
                    return Err(PreparationFailure::InvalidFlow);
                }
                seen_figures[*figure_index] = true;
            }
        }
    }
    if seen_spots.iter().any(|seen| !seen) || seen_figures.iter().any(|seen| !seen) {
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
                    FlowItem::Spot {
                        spot_index: left, ..
                    },
                    FlowItem::Spot {
                        spot_index: right, ..
                    },
                ) => left.cmp(right),
                (FlowItem::Figure { .. }, FlowItem::Spot { .. }) => Ordering::Less,
                (FlowItem::Spot { .. }, FlowItem::Figure { .. }) => Ordering::Greater,
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
    use crate::state::SpotKind;

    fn input() -> PreparationInput {
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
                duration_ms: 20,
            },
            Spot {
                sentence_index: 2,
                kind: SpotKind::Body,
                start: 5,
                end: 8,
                duration_ms: 30,
            },
        ];
        PreparationInput {
            text_length: 8,
            spots,
            figures: vec![crate::state::Figure {
                source_offset: 3,
                source_end: 3,
            }],
            flow: vec![
                FlowItem::Spot {
                    source_offset: 0,
                    spot_index: 0,
                },
                FlowItem::Figure {
                    source_offset: 3,
                    figure_index: 0,
                },
                FlowItem::Spot {
                    source_offset: 3,
                    spot_index: 1,
                },
                FlowItem::Spot {
                    source_offset: 5,
                    spot_index: 2,
                },
            ],
        }
    }

    fn figure_after_third_sentence_input() -> PreparationInput {
        PreparationInput {
            text_length: 11,
            spots: vec![
                Spot {
                    sentence_index: 0,
                    kind: SpotKind::Body,
                    start: 0,
                    end: 2,
                    duration_ms: 10,
                },
                Spot {
                    sentence_index: 1,
                    kind: SpotKind::Body,
                    start: 2,
                    end: 5,
                    duration_ms: 20,
                },
                Spot {
                    sentence_index: 2,
                    kind: SpotKind::Body,
                    start: 5,
                    end: 8,
                    duration_ms: 30,
                },
                Spot {
                    sentence_index: 3,
                    kind: SpotKind::Body,
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
                FlowItem::Spot {
                    source_offset: 0,
                    spot_index: 0,
                },
                FlowItem::Spot {
                    source_offset: 2,
                    spot_index: 1,
                },
                FlowItem::Spot {
                    source_offset: 5,
                    spot_index: 2,
                },
                FlowItem::Figure {
                    source_offset: 8,
                    figure_index: 0,
                },
                FlowItem::Spot {
                    source_offset: 8,
                    spot_index: 3,
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
    fn hidden_preparation_starts_paused() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        );
        let hidden = reduce(&opened.state, ReaderSessionCommand::VisibilityHidden);
        let started = reduce(
            &hidden.state,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: input(),
            },
        );
        assert!(matches!(
            started.state,
            ReaderSessionState::Reading {
                playback: Playback::Paused,
                flow_index: 0,
                ..
            }
        ));
        assert_eq!(started.effects, vec![ReaderSessionEffect::CancelTimer]);
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
    fn figure_previous_sentence_preserves_pause() {
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
                playback: Playback::Paused,
                ..
            }
        ));
        assert_eq!(previous.effects, vec![ReaderSessionEffect::CancelTimer]);
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
                playback: Playback::Paused,
                position: Position::Text { source_offset: 5 },
                ..
            }
        ));
        assert_eq!(previous.effects, vec![ReaderSessionEffect::CancelTimer]);
    }

    #[test]
    fn previous_sentence_from_playing_spot_resumes_playback() {
        let started = reading();
        let figure = reduce(
            &started,
            ReaderSessionCommand::Tick {
                generation: started.generation(),
            },
        );
        let playing_spot = reduce(&figure.state, ReaderSessionCommand::ResumeFromFigure);
        let previous = reduce(&playing_spot.state, ReaderSessionCommand::PreviousSentence);

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
    fn previous_sentence_from_paused_spot_stays_paused() {
        let paused = reduce(&reading(), ReaderSessionCommand::Pause);
        let previous = reduce(&paused.state, ReaderSessionCommand::PreviousSentence);

        assert!(matches!(
            previous.state,
            ReaderSessionState::Reading {
                flow_index: 0,
                playback: Playback::Paused,
                ..
            }
        ));
        assert_eq!(previous.effects, vec![ReaderSessionEffect::CancelTimer]);
    }

    #[test]
    fn tick_stops_at_figure_and_resume_schedules_next_spot() {
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
    fn page_to_spots_round_trip_starts_a_spot() {
        let paused = reduce(&reading(), ReaderSessionCommand::Pause).state;
        let page = reduce(
            &paused,
            ReaderSessionCommand::SwitchToPage {
                position: Position::Text { source_offset: 0 },
            },
        )
        .state;
        let spots = reduce(
            &page,
            ReaderSessionCommand::SwitchToSpots {
                position: Position::Text { source_offset: 0 },
            },
        );

        assert!(matches!(
            spots.state,
            ReaderSessionState::Reading {
                mode: Mode::Spots,
                playback: Playback::Playing,
                flow_index: 0,
                ..
            }
        ));
        assert!(matches!(
            spots.effects.first(),
            Some(ReaderSessionEffect::CancelTimer)
        ));
        assert!(spots.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick { delay_ms: 10, .. }
        )));
    }

    #[test]
    fn page_to_spots_uses_the_sentence_head_spot() {
        let opened = reduce(
            &initial_state(),
            ReaderSessionCommand::Open {
                request_id: "A".into(),
            },
        )
        .state;
        let mut input = input();
        input.spots[1].sentence_index = 0;
        let started = reduce(
            &opened,
            ReaderSessionCommand::PrepareSucceeded {
                request_id: "A".into(),
                flow: input,
            },
        )
        .state;
        let page = reduce(
            &started,
            ReaderSessionCommand::SwitchToPage {
                position: Position::Text { source_offset: 4 },
            },
        )
        .state;
        let spots = reduce(
            &page,
            ReaderSessionCommand::SwitchToSpots {
                position: Position::Text { source_offset: 4 },
            },
        );

        assert!(matches!(
            spots.state,
            ReaderSessionState::Reading {
                flow_index: 0,
                position: Position::Text { source_offset: 0 },
                playback: Playback::Playing,
                ..
            }
        ));
        assert!(spots.effects.iter().any(|effect| matches!(
            effect,
            ReaderSessionEffect::ScheduleTick { delay_ms: 10, .. }
        )));
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
        assert_eq!(idle.spot_index, None);
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
