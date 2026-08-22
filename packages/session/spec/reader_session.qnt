module reader_session {
  type SessionState = {
    phase: str,
    activeRequest: str,
    mode: str,
    playback: str,
    flowIndex: int,
    flowLength: int,
    position: int,
    timerGeneration: int,
    timerPending: bool,
    contentPresent: bool,
    previousFlowIndex: int,
    previousPosition: int,
    previousGeneration: int,
    previousActiveRequest: str,
  }

  type SessionUpdate = {
    phase: str,
    activeRequest: str,
    mode: str,
    playback: str,
    flowIndex: int,
    flowLength: int,
    position: int,
    timerGeneration: int,
    timerPending: bool,
    contentPresent: bool,
  }

  type ActionTaken =
    | Init
    | Open({request_id: str})
    | PrepareSucceeded({request_id: str})
    | PrepareFailed({request_id: str})
    | Cancel({request_id: str})
    | Play
    | Pause
    | Tick({generation: int})
    | PreviousSentence
    | SwitchToText({position: int})
    | SwitchToRsvp({position: int})
    | ResumeFromFigure
    | RebuildUnits({position: int})
    | VisibilityHidden
    | Close

  var session: SessionState
  var actionTaken: ActionTaken
  var lastAction: str

  pure def sourceForFlow(index: int): int = if (index == 0) 0 else if (index == 1) 3 else if (index == 2) 3 else 5
  pure def kindForFlow(index: int): str = if (index == 1) "figure" else "unit"
  pure def flowForSource(offset: int): int = if (offset == 0) 0 else if (offset == 3) 1 else 3
  pure def nextGeneration(generation: int): int = if (generation >= 8) 0 else generation + 1
  pure def remember(before: SessionState, after: SessionUpdate): SessionState = {
    phase: after.phase,
    activeRequest: after.activeRequest,
    mode: after.mode,
    playback: after.playback,
    flowIndex: after.flowIndex,
    flowLength: after.flowLength,
    position: after.position,
    timerGeneration: after.timerGeneration,
    timerPending: after.timerPending,
    contentPresent: after.contentPresent,
    previousFlowIndex: before.flowIndex,
    previousPosition: before.position,
    previousGeneration: before.timerGeneration,
    previousActiveRequest: before.activeRequest,
  }
  pure def updateOf(state: SessionState): SessionUpdate = {
    phase: state.phase,
    activeRequest: state.activeRequest,
    mode: state.mode,
    playback: state.playback,
    flowIndex: state.flowIndex,
    flowLength: state.flowLength,
    position: state.position,
    timerGeneration: state.timerGeneration,
    timerPending: state.timerPending,
    contentPresent: state.contentPresent,
  }

  action init = all {
    session' = {
      phase: "idle", activeRequest: "", mode: "rsvp", playback: "paused",
      flowIndex: 0, flowLength: 0, position: 0, timerGeneration: 0,
      timerPending: false, contentPresent: false,
      previousFlowIndex: 0, previousPosition: 0, previousGeneration: 0, previousActiveRequest: "",
    },
    actionTaken' = Init,
    lastAction' = "init",
  }

  action open(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    if (session.phase == "ended") {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "preparing", activeRequest: requestId, mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
      })
    },
    actionTaken' = Open({request_id: requestId}),
    lastAction' = "open",
  }

  action prepareSucceeded(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "reading", activeRequest: requestId, mode: "rsvp", playback: "playing",
        flowIndex: 0, flowLength: 4, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: true, contentPresent: true,
      })
    },
    actionTaken' = PrepareSucceeded({request_id: requestId}),
    lastAction' = "prepareSucceeded",
  }

  action prepareFailed(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "error", activeRequest: requestId, mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
      })
    },
    actionTaken' = PrepareFailed({request_id: requestId}),
    lastAction' = "prepareFailed",
  }

  action cancel(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "idle", activeRequest: "", mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
      })
    },
    actionTaken' = Cancel({request_id: requestId}),
    lastAction' = "cancel",
  }

  action play = all {
    session.phase == "reading", session.mode == "rsvp", session.playback == "paused",
    kindForFlow(session.flowIndex) == "unit",
    session' = remember(session, { ...updateOf(session), playback: "playing", timerGeneration: nextGeneration(session.timerGeneration), timerPending: true }),
    actionTaken' = Play,
    lastAction' = "play",
  }

  action pause = all {
    session.phase == "reading",
    session' = remember(session, { ...updateOf(session), playback: "paused", timerGeneration: nextGeneration(session.timerGeneration), timerPending: false }),
    actionTaken' = Pause,
    lastAction' = "pause",
  }

  action tick(generation: int): bool = all {
    generation >= 0 and generation <= 8,
    if (session.phase != "reading" or session.playback != "playing" or generation != session.timerGeneration) {
      session' = remember(session, updateOf(session))
    } else if (session.flowIndex + 1 >= session.flowLength) {
      session' = remember(session, { ...updateOf(session), playback: "paused", timerGeneration: nextGeneration(session.timerGeneration), timerPending: false })
    } else {
      val nextIndex = session.flowIndex + 1
      session' = remember(session, { ...updateOf(session),
        flowIndex: nextIndex, position: sourceForFlow(nextIndex),
        playback: if (kindForFlow(nextIndex) == "figure") "paused" else "playing",
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: kindForFlow(nextIndex) == "unit",
      })
    },
    actionTaken' = Tick({generation: generation}),
    lastAction' = "tick",
  }

  action previousSentence = all {
    session.phase == "reading",
    val targetIndex = if (session.flowIndex <= 1) 0 else 2
    session' = remember(session, { ...updateOf(session),
      flowIndex: targetIndex, position: sourceForFlow(targetIndex), playback: session.playback,
      timerGeneration: nextGeneration(session.timerGeneration), timerPending: session.playback == "playing",
    }),
    actionTaken' = PreviousSentence,
    lastAction' = "previousSentence",
  }

  action switchToText(position: int): bool = all {
    session.phase == "reading", position == 0 or position == 3 or position == 5,
    val targetIndex = flowForSource(position)
    session' = remember(session, { ...updateOf(session),
      mode: "text", flowIndex: targetIndex, position: position, playback: "paused",
      timerGeneration: nextGeneration(session.timerGeneration), timerPending: false,
    }),
    actionTaken' = SwitchToText({position: position}),
    lastAction' = "switchToText",
  }

  action switchToRsvp(position: int): bool = all {
    session.phase == "reading", position == 0 or position == 3 or position == 5,
    val targetIndex = flowForSource(position)
    session' = remember(session, { ...updateOf(session),
      mode: "rsvp", flowIndex: targetIndex, position: position,
      playback: if (kindForFlow(targetIndex) == "figure") "paused" else "playing",
      timerGeneration: nextGeneration(session.timerGeneration),
      timerPending: kindForFlow(targetIndex) == "unit",
    }),
    actionTaken' = SwitchToRsvp({position: position}),
    lastAction' = "switchToRsvp",
  }

  action resumeFromFigure = all {
    session.phase == "reading", kindForFlow(session.flowIndex) == "figure",
    val targetIndex = session.flowIndex + 1
    session' = remember(session, { ...updateOf(session),
      flowIndex: targetIndex, position: sourceForFlow(targetIndex),
      playback: if (session.mode == "rsvp") "playing" else "paused",
      timerGeneration: nextGeneration(session.timerGeneration), timerPending: session.mode == "rsvp",
    }),
    actionTaken' = ResumeFromFigure,
    lastAction' = "resumeFromFigure",
  }

  action rebuildUnits(position: int): bool = all {
    session.phase == "reading", position == 0 or position == 3 or position == 5,
    val targetIndex = flowForSource(position)
    session' = remember(session, { ...updateOf(session),
      flowIndex: targetIndex, position: position, flowLength: 4,
      playback: if (session.mode == "rsvp" and kindForFlow(targetIndex) == "unit") session.playback else "paused",
      timerGeneration: nextGeneration(session.timerGeneration),
      timerPending: session.mode == "rsvp" and kindForFlow(targetIndex) == "unit" and session.playback == "playing",
    }),
    actionTaken' = RebuildUnits({position: position}),
    lastAction' = "rebuildUnits",
  }

  action visibilityHidden = all {
    session.phase == "reading",
    session' = remember(session, { ...updateOf(session), playback: "paused", timerGeneration: nextGeneration(session.timerGeneration), timerPending: false }),
    actionTaken' = VisibilityHidden,
    lastAction' = "visibilityHidden",
  }

  action close = all {
    if (session.phase == "ended") {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "ended", activeRequest: "", mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
      })
    },
    actionTaken' = Close,
    lastAction' = "close",
  }

  action step = any {
    open("A"), open("B"), prepareSucceeded("A"), prepareSucceeded("B"),
    prepareFailed("A"), prepareFailed("B"), cancel("A"), cancel("B"), play, pause,
    tick(0), tick(1), tick(2), tick(3), tick(4), tick(5), tick(6), tick(7), tick(8),
    previousSentence, switchToText(0), switchToText(3), switchToText(5),
    switchToRsvp(0), switchToRsvp(3), switchToRsvp(5), resumeFromFigure,
    rebuildUnits(0), rebuildUnits(3), rebuildUnits(5), visibilityHidden, close,
  }

  val endedHasNoContent = session.phase != "ended" or and {
    not(session.contentPresent), session.flowLength == 0, not(session.timerPending),
  }
  val playingOnlyInRsvp = session.playback != "playing" or and { session.phase == "reading", session.mode == "rsvp" }
  val figureIsPaused = kindForFlow(session.flowIndex) != "figure" or session.playback == "paused"
  val timerOnlyWhilePlaying = not(session.timerPending) or session.playback == "playing"
  val positionIsInRange = session.flowLength == 0 or and {
    session.flowIndex >= 0, session.flowIndex < session.flowLength,
    session.position == sourceForFlow(session.flowIndex),
  }
  val staleTickDoesNotAdvance = lastAction != "tick" or session.timerGeneration != session.previousGeneration or session.flowIndex == session.previousFlowIndex
  val stalePreparationDoesNotOpen = lastAction != "prepareSucceeded" or session.activeRequest == session.previousActiveRequest or and {
    session.phase != "reading", not(session.contentPresent),
  }
  val closedSessionCannotRevive = session.phase == "ended" implies and { not(session.contentPresent), session.flowLength == 0 }
  val noImplicitRewind = session.phase != "reading" or session.flowIndex >= session.previousFlowIndex or lastAction == "previousSentence" or lastAction == "switchToText" or lastAction == "switchToRsvp" or lastAction == "rebuildUnits"
  val figureConsumedAtMostOnce = lastAction != "tick" or session.flowIndex != 1 or session.previousFlowIndex != 1 or session.timerGeneration == session.previousGeneration or session.position == session.previousPosition
  val modeRoundTripKeepsLocation = (lastAction != "switchToText" and lastAction != "switchToRsvp") or and {
    session.phase == "reading", session.position == sourceForFlow(session.flowIndex),
  }

  val invariant = and {
    endedHasNoContent, playingOnlyInRsvp, figureIsPaused, timerOnlyWhilePlaying,
    positionIsInRange, staleTickDoesNotAdvance, stalePreparationDoesNotOpen,
    closedSessionCannotRevive, noImplicitRewind, figureConsumedAtMostOnce, modeRoundTripKeepsLocation,
  }

  run closeThenLateTick = init.then(open("A")).then(prepareSucceeded("A")).then(close).then(tick(2))
  run closeThenLatePreparationSuccess = init.then(open("A")).then(close).then(prepareSucceeded("A"))
  run newRequestSupersedesOldRequest = init.then(open("A")).then(open("B")).then(prepareSucceeded("A")).then(prepareSucceeded("B"))
  run playUntilFigureAndResume = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure)
  run previousSentenceWhilePlaying = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure).then(previousSentence)
  run switchModeAtFigure = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(switchToText(3)).then(switchToRsvp(3))
  run rebuildUnitsWhilePlaying = init.then(open("A")).then(prepareSucceeded("A")).then(rebuildUnits(0))
  run visibilityHiddenPauses = init.then(open("A")).then(prepareSucceeded("A")).then(visibilityHidden)
}
