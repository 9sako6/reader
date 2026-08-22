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
    previousPhase: str,
    previousMode: str,
    previousPlayback: str,
    previousFlowLength: int,
    previousTimerPending: bool,
    previousContentPresent: bool,
    preparationHidden: bool,
    previousPreparationHidden: bool,
    figure0Visits: int,
    figure1Visits: int,
    figure0Consumes: int,
    figure1Consumes: int,
    previousFigure0Visits: int,
    previousFigure1Visits: int,
    previousFigure0Consumes: int,
    previousFigure1Consumes: int,
    modeAnchorPosition: int,
    modeAnchorPending: bool,
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
    preparationHidden: bool,
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
  var lastRequest: str

  pure def figureIndexForFlow(index: int): int = if (index == 1) 0 else if (index == 2) 1 else -1
  pure def kindForFlow(index: int): str = if (figureIndexForFlow(index) >= 0) "figure" else "unit"
  pure def sentenceHeadForFlow(index: int): int = if (index == 4) 3 else index
  pure def nextGeneration(generation: int): int = generation + 1
  pure def figureVisitIncrement(before: SessionState, after: SessionUpdate, figureIndex: int): int =
    if (after.phase != "reading" or before.phase != "reading" or before.flowIndex == after.flowIndex) 0
    else if (figureIndexForFlow(after.flowIndex) == figureIndex) 1 else 0
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
    preparationHidden: after.preparationHidden,
    previousFlowIndex: before.flowIndex,
    previousPosition: before.position,
    previousGeneration: before.timerGeneration,
    previousActiveRequest: before.activeRequest,
    previousPhase: before.phase,
    previousMode: before.mode,
    previousPlayback: before.playback,
    previousFlowLength: before.flowLength,
    previousTimerPending: before.timerPending,
    previousContentPresent: before.contentPresent,
    previousPreparationHidden: before.preparationHidden,
    figure0Visits: if (after.phase == "reading") before.figure0Visits + figureVisitIncrement(before, after, 0) else 0,
    figure1Visits: if (after.phase == "reading") before.figure1Visits + figureVisitIncrement(before, after, 1) else 0,
    figure0Consumes: if (after.phase == "reading") before.figure0Consumes else 0,
    figure1Consumes: if (after.phase == "reading") before.figure1Consumes else 0,
    previousFigure0Visits: before.figure0Visits,
    previousFigure1Visits: before.figure1Visits,
    previousFigure0Consumes: before.figure0Consumes,
    previousFigure1Consumes: before.figure1Consumes,
    modeAnchorPosition: before.modeAnchorPosition,
    modeAnchorPending: false,
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
    preparationHidden: state.preparationHidden,
  }

  pure def rememberWithAnchor(before: SessionState, after: SessionUpdate, anchor: int): SessionState = {
    ...remember(before, after),
    figure0Visits: if (after.flowIndex < before.flowIndex and after.phase == "reading")
      (if (figureIndexForFlow(after.flowIndex) == 0) 1 else 0)
      else before.figure0Visits + figureVisitIncrement(before, after, 0),
    figure1Visits: if (after.flowIndex < before.flowIndex and after.phase == "reading")
      (if (figureIndexForFlow(after.flowIndex) == 1) 1 else 0)
      else before.figure1Visits + figureVisitIncrement(before, after, 1),
    figure0Consumes: if (after.flowIndex < before.flowIndex and after.phase == "reading") 0 else before.figure0Consumes,
    figure1Consumes: if (after.flowIndex < before.flowIndex and after.phase == "reading") 0 else before.figure1Consumes,
    previousFigure0Visits: before.figure0Visits,
    previousFigure1Visits: before.figure1Visits,
    previousFigure0Consumes: before.figure0Consumes,
    previousFigure1Consumes: before.figure1Consumes,
    modeAnchorPosition: anchor,
    modeAnchorPending: true,
  }

  pure def rememberWithExistingAnchor(before: SessionState, after: SessionUpdate): SessionState = {
    ...remember(before, after),
    figure0Visits: if (after.phase == "reading" and figureIndexForFlow(after.flowIndex) == 0 and before.figure0Visits == 0) 1 else before.figure0Visits,
    figure1Visits: if (after.phase == "reading" and figureIndexForFlow(after.flowIndex) == 1 and before.figure1Visits == 0) 1 else before.figure1Visits,
    figure0Consumes: before.figure0Consumes,
    figure1Consumes: before.figure1Consumes,
    previousFigure0Visits: before.figure0Visits,
    previousFigure1Visits: before.figure1Visits,
    previousFigure0Consumes: before.figure0Consumes,
    previousFigure1Consumes: before.figure1Consumes,
    modeAnchorPosition: before.modeAnchorPosition,
    modeAnchorPending: before.modeAnchorPending,
  }

  pure def rememberWithFigureEpoch(before: SessionState, after: SessionUpdate): SessionState = {
    ...remember(before, after),
    figure0Visits: if (after.phase == "reading" and figureIndexForFlow(after.flowIndex) == 0) 1 else 0,
    figure1Visits: if (after.phase == "reading" and figureIndexForFlow(after.flowIndex) == 1) 1 else 0,
    figure0Consumes: 0,
    figure1Consumes: 0,
  }

  pure def rememberWithFigureConsumed(before: SessionState, after: SessionUpdate): SessionState = {
    ...remember(before, after),
    figure0Consumes: before.figure0Consumes + if (figureIndexForFlow(before.flowIndex) == 0) 1 else 0,
    figure1Consumes: before.figure1Consumes + if (figureIndexForFlow(before.flowIndex) == 1) 1 else 0,
  }

  action init = all {
    session' = {
      phase: "idle", activeRequest: "", mode: "rsvp", playback: "paused",
      flowIndex: 0, flowLength: 0, position: 0, timerGeneration: 0,
      timerPending: false, contentPresent: false,
      previousFlowIndex: 0, previousPosition: 0, previousGeneration: 0, previousActiveRequest: "",
      previousPhase: "idle", previousMode: "rsvp", previousPlayback: "paused",
      previousFlowLength: 0, previousTimerPending: false, previousContentPresent: false,
      preparationHidden: false, previousPreparationHidden: false,
      figure0Visits: 0, figure1Visits: 0, figure0Consumes: 0, figure1Consumes: 0,
      previousFigure0Visits: 0, previousFigure1Visits: 0,
      previousFigure0Consumes: 0, previousFigure1Consumes: 0,
      modeAnchorPosition: 0, modeAnchorPending: false,
    },
    actionTaken' = Init,
    lastAction' = "init",
    lastRequest' = "",
  }

  action open(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    session.timerGeneration < 8,
    if (session.phase == "ended") {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "preparing", activeRequest: requestId, mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
        preparationHidden: false,
      })
    },
    actionTaken' = Open({request_id: requestId}),
    lastAction' = "open",
    lastRequest' = requestId,
  }

  action prepareSucceeded(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    session.timerGeneration < 8,
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "reading", activeRequest: requestId, mode: "rsvp",
        playback: if (session.preparationHidden) "paused" else "playing",
        flowIndex: 0, flowLength: 5, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: not(session.preparationHidden), contentPresent: true,
        preparationHidden: false,
      })
    },
    actionTaken' = PrepareSucceeded({request_id: requestId}),
    lastAction' = "prepareSucceeded",
    lastRequest' = requestId,
  }

  action prepareFailed(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    session.timerGeneration < 8,
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "error", activeRequest: requestId, mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
        preparationHidden: false,
      })
    },
    actionTaken' = PrepareFailed({request_id: requestId}),
    lastAction' = "prepareFailed",
    lastRequest' = requestId,
  }

  action cancel(requestId: str): bool = all {
    requestId == "A" or requestId == "B",
    session.timerGeneration < 8,
    if (session.phase != "preparing" or session.activeRequest != requestId) {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "idle", activeRequest: "", mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
        preparationHidden: false,
      })
    },
    actionTaken' = Cancel({request_id: requestId}),
    lastAction' = "cancel",
    lastRequest' = requestId,
  }

  action play = all {
    session.phase == "reading", session.mode == "rsvp", session.playback == "paused",
    kindForFlow(session.flowIndex) == "unit",
    session.timerGeneration < 8,
    session' = remember(session, { ...updateOf(session), playback: "playing", timerGeneration: nextGeneration(session.timerGeneration), timerPending: true }),
    actionTaken' = Play,
    lastAction' = "play",
    lastRequest' = "",
  }

  action pause = all {
    session.phase == "reading",
    session.timerGeneration < 8,
    session' = remember(session, { ...updateOf(session), playback: "paused", timerGeneration: nextGeneration(session.timerGeneration), timerPending: false }),
    actionTaken' = Pause,
    lastAction' = "pause",
    lastRequest' = "",
  }

  action tick(generation: int): bool = all {
    generation >= 0 and generation <= 8,
    session.timerGeneration < 8,
    if (session.phase != "reading" or session.playback != "playing" or generation != session.timerGeneration) {
      session' = remember(session, updateOf(session))
    } else if (session.flowIndex + 1 >= session.flowLength) {
      session' = remember(session, { ...updateOf(session), playback: "paused", timerGeneration: nextGeneration(session.timerGeneration), timerPending: false })
    } else {
      val nextIndex = session.flowIndex + 1
      session' = remember(session, { ...updateOf(session),
        flowIndex: nextIndex, position: nextIndex,
        playback: if (kindForFlow(nextIndex) == "figure") "paused" else "playing",
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: kindForFlow(nextIndex) == "unit",
      })
    },
    actionTaken' = Tick({generation: generation}),
    lastAction' = "tick",
    lastRequest' = "",
  }

  action previousSentence = all {
    session.phase == "reading",
    session.timerGeneration < 8,
    val targetIndex = 0
    session' = rememberWithFigureEpoch(session, { ...updateOf(session),
      flowIndex: targetIndex, position: targetIndex,
      playback: if (session.mode == "rsvp" and session.playback == "playing") "playing" else "paused",
      timerGeneration: nextGeneration(session.timerGeneration),
      timerPending: session.mode == "rsvp" and session.playback == "playing",
    }),
    actionTaken' = PreviousSentence,
    lastAction' = "previousSentence",
    lastRequest' = "",
  }

  action switchToText(position: int): bool = all {
    session.phase == "reading", position >= 0 and position < session.flowLength,
    session.timerGeneration < 8,
    val targetIndex = position
    session' = rememberWithAnchor(session, { ...updateOf(session),
      mode: "text", flowIndex: targetIndex, position: position, playback: "paused",
      timerGeneration: nextGeneration(session.timerGeneration), timerPending: false,
    }, position),
    actionTaken' = SwitchToText({position: position}),
    lastAction' = "switchToText",
    lastRequest' = "",
  }

  action switchToRsvp(position: int): bool = all {
    session.phase == "reading", position >= 0 and position < session.flowLength,
    session.mode != "text" or position == session.modeAnchorPosition,
    session.timerGeneration < 8,
    val targetIndex = if (kindForFlow(position) == "figure") position else sentenceHeadForFlow(position)
    session' = if (session.mode == "text" and session.position == session.modeAnchorPosition and position == session.modeAnchorPosition) {
      rememberWithExistingAnchor(session, { ...updateOf(session),
        mode: "rsvp", flowIndex: targetIndex, position: targetIndex,
        playback: if (kindForFlow(targetIndex) == "figure") "paused" else "playing",
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: kindForFlow(targetIndex) == "unit",
      })
    } else if (position < session.flowIndex) {
      rememberWithFigureEpoch(session, { ...updateOf(session),
        mode: "rsvp", flowIndex: targetIndex, position: targetIndex,
        playback: if (kindForFlow(targetIndex) == "figure") "paused" else "playing",
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: kindForFlow(targetIndex) == "unit",
      })
    } else {
      remember(session, { ...updateOf(session),
        mode: "rsvp", flowIndex: targetIndex, position: targetIndex,
        playback: if (kindForFlow(targetIndex) == "figure") "paused" else "playing",
        timerGeneration: nextGeneration(session.timerGeneration),
        timerPending: kindForFlow(targetIndex) == "unit",
      })
    },
    actionTaken' = SwitchToRsvp({position: position}),
    lastAction' = "switchToRsvp",
    lastRequest' = "",
  }

  action resumeFromFigure = all {
    session.phase == "reading", kindForFlow(session.flowIndex) == "figure",
    session.timerGeneration < 8,
    val targetIndex = session.flowIndex + 1
    session' = rememberWithFigureConsumed(session, { ...updateOf(session),
      flowIndex: targetIndex, position: targetIndex,
      playback: if (session.mode == "rsvp" and kindForFlow(targetIndex) == "unit") "playing" else "paused",
      timerGeneration: nextGeneration(session.timerGeneration), timerPending: session.mode == "rsvp" and kindForFlow(targetIndex) == "unit",
    }),
    actionTaken' = ResumeFromFigure,
    lastAction' = "resumeFromFigure",
    lastRequest' = "",
  }

  action rebuildUnits(position: int): bool = all {
    session.phase == "reading", position >= 0 and position < session.flowLength,
    session.timerGeneration < 8,
    val targetIndex = position
    session' = rememberWithFigureEpoch(session, { ...updateOf(session),
      flowIndex: targetIndex, position: position, flowLength: 5,
      playback: if (session.mode == "rsvp" and kindForFlow(targetIndex) == "unit") session.playback else "paused",
      timerGeneration: nextGeneration(session.timerGeneration),
      timerPending: session.mode == "rsvp" and kindForFlow(targetIndex) == "unit" and session.playback == "playing",
    }),
    actionTaken' = RebuildUnits({position: position}),
    lastAction' = "rebuildUnits",
    lastRequest' = "",
  }

  action visibilityHidden = all {
    session.phase == "reading" or session.phase == "preparing",
    session.timerGeneration < 8,
    if (session.phase == "preparing") {
      if (session.preparationHidden) {
        session' = remember(session, updateOf(session))
      } else {
        session' = remember(session, { ...updateOf(session), preparationHidden: true, timerGeneration: nextGeneration(session.timerGeneration) })
      }
    } else {
      session' = remember(session, { ...updateOf(session), playback: "paused", preparationHidden: false, timerGeneration: nextGeneration(session.timerGeneration), timerPending: false })
    },
    actionTaken' = VisibilityHidden,
    lastAction' = "visibilityHidden",
    lastRequest' = "",
  }

  action close = all {
    session.timerGeneration < 8,
    if (session.phase == "ended") {
      session' = remember(session, updateOf(session))
    } else {
      session' = remember(session, {
        phase: "ended", activeRequest: "", mode: "rsvp", playback: "paused",
        flowIndex: 0, flowLength: 0, position: 0,
        timerGeneration: nextGeneration(session.timerGeneration), timerPending: false, contentPresent: false,
        preparationHidden: false,
      })
    },
    actionTaken' = Close,
    lastAction' = "close",
    lastRequest' = "",
  }

  action step = any {
    open("A"), open("B"), prepareSucceeded("A"), prepareSucceeded("B"),
    prepareFailed("A"), prepareFailed("B"), cancel("A"), cancel("B"), play, pause,
    tick(0), tick(1), tick(2), tick(3), tick(4), tick(5), tick(6), tick(7), tick(8),
    previousSentence, switchToText(0), switchToText(1), switchToText(2), switchToText(3), switchToText(4),
    switchToRsvp(0), switchToRsvp(1), switchToRsvp(2), switchToRsvp(3), switchToRsvp(4), resumeFromFigure,
    rebuildUnits(0), rebuildUnits(1), rebuildUnits(2), rebuildUnits(3), rebuildUnits(4), visibilityHidden, close,
  }

  val endedHasNoContent = session.phase != "ended" or and {
    not(session.contentPresent), session.flowLength == 0, not(session.timerPending),
  }
  val playingOnlyInRsvp = session.playback != "playing" or and { session.phase == "reading", session.mode == "rsvp" }
  val figureIsPaused = kindForFlow(session.flowIndex) != "figure" or session.playback == "paused"
  val timerOnlyWhilePlaying = not(session.timerPending) or session.playback == "playing"
  val positionIsInRange = session.flowLength == 0 or and {
    session.flowIndex >= 0, session.flowIndex < session.flowLength,
    session.position == session.flowIndex,
  }
  val staleTickDoesNotAdvance = lastAction != "tick" or session.timerGeneration != session.previousGeneration or session.flowIndex == session.previousFlowIndex
  val stalePreparationDoesNotOpen = (lastAction != "prepareSucceeded" and lastAction != "prepareFailed") or
    (session.previousPhase == "preparing" and lastRequest == session.previousActiveRequest and lastAction == "prepareSucceeded" and
      session.phase == "reading" and session.contentPresent and session.flowLength > 0 and
      (session.timerPending or session.previousPreparationHidden)) or
    (session.previousPhase == "preparing" and lastRequest == session.previousActiveRequest and lastAction == "prepareFailed" and
      session.phase == "error" and not(session.contentPresent) and session.flowLength == 0 and
      not(session.timerPending) and session.activeRequest == lastRequest) or
    (not(session.previousPhase == "preparing" and lastRequest == session.previousActiveRequest) and
      session.phase == session.previousPhase and
      session.activeRequest == session.previousActiveRequest and
      session.mode == session.previousMode and
      session.playback == session.previousPlayback and
      session.flowIndex == session.previousFlowIndex and
      session.flowLength == session.previousFlowLength and
      session.position == session.previousPosition and
      session.timerGeneration == session.previousGeneration and
      session.timerPending == session.previousTimerPending and
      session.contentPresent == session.previousContentPresent)
  val hiddenPreparationStartsPaused = lastAction != "prepareSucceeded" or
    session.previousPhase != "preparing" or not(session.previousPreparationHidden) or session.playback == "paused"
  val repeatedPreparationVisibilityIsStable = lastAction != "visibilityHidden" or
    session.previousPhase != "preparing" or not(session.previousPreparationHidden) or
    (session.phase == "preparing" and session.preparationHidden and session.timerGeneration == session.previousGeneration)
  val closedSessionCannotRevive = session.previousPhase != "ended" or and {
    session.phase == "ended", not(session.contentPresent), session.flowLength == 0,
    not(session.timerPending), session.activeRequest == "",
  }
  val noImplicitRewind = session.phase != "reading" or session.flowIndex >= session.previousFlowIndex or lastAction == "previousSentence" or lastAction == "switchToText" or lastAction == "switchToRsvp" or lastAction == "rebuildUnits"
  val figureConsumedAtMostOnce = and {
    session.figure0Visits >= 0, session.figure1Visits >= 0,
    session.figure0Consumes >= 0, session.figure1Consumes >= 0,
    session.figure0Consumes <= session.figure0Visits,
    session.figure1Consumes <= session.figure1Visits,
    session.figure0Visits <= 1, session.figure1Visits <= 1,
    session.figure0Consumes <= 1, session.figure1Consumes <= 1,
    lastAction != "tick" or and {
      session.figure0Visits == session.previousFigure0Visits or session.figure0Visits == session.previousFigure0Visits + 1,
      session.figure1Visits == session.previousFigure1Visits or session.figure1Visits == session.previousFigure1Visits + 1,
      session.flowIndex == session.previousFlowIndex or and {
        session.flowIndex == session.previousFlowIndex + 1,
        or {
          and {
            figureIndexForFlow(session.flowIndex) == 0,
            session.figure0Visits == session.previousFigure0Visits + 1,
            session.figure1Visits == session.previousFigure1Visits,
          },
          and {
            figureIndexForFlow(session.flowIndex) == 1,
            session.figure0Visits == session.previousFigure0Visits,
            session.figure1Visits == session.previousFigure1Visits + 1,
          },
          and {
            figureIndexForFlow(session.flowIndex) == -1,
            session.figure0Visits == session.previousFigure0Visits,
            session.figure1Visits == session.previousFigure1Visits,
          },
        },
      },
    },
    lastAction != "resumeFromFigure" or or {
      session.previousFlowIndex == 1 and session.figure0Consumes == session.previousFigure0Consumes + 1 and
        session.figure1Consumes == session.previousFigure1Consumes and session.flowIndex == 2,
      session.previousFlowIndex == 2 and session.figure1Consumes == session.previousFigure1Consumes + 1 and
        session.figure0Consumes == session.previousFigure0Consumes and session.flowIndex == 3,
    },
    lastAction != "resumeFromFigure" or session.flowIndex == session.previousFlowIndex + 1,
  }
  val modeRoundTripKeepsLocation = lastAction != "switchToRsvp" or session.previousMode != "text" or not(session.modeAnchorPending) or and {
    session.mode == "rsvp", session.phase == "reading", session.position == sentenceHeadForFlow(session.previousPosition),
    session.position == sentenceHeadForFlow(session.modeAnchorPosition),
  }

  val invariant = and {
    endedHasNoContent, playingOnlyInRsvp, figureIsPaused, timerOnlyWhilePlaying,
    positionIsInRange, staleTickDoesNotAdvance, stalePreparationDoesNotOpen, hiddenPreparationStartsPaused,
    repeatedPreparationVisibilityIsStable,
    closedSessionCannotRevive,
    noImplicitRewind, figureConsumedAtMostOnce, modeRoundTripKeepsLocation,
  }

  run closeThenLateTick = init.then(open("A")).then(prepareSucceeded("A")).then(close).then(tick(2))
  run closeThenLatePreparationSuccess = init.then(open("A")).then(close).then(prepareSucceeded("A"))
  run newRequestSupersedesOldRequest = init.then(open("A")).then(open("B")).then(prepareSucceeded("A")).then(prepareSucceeded("B"))
  run newRequestRejectsLatePreparationFailure = init.then(open("A")).then(open("B")).then(prepareFailed("A"))
  run playUntilFigureAndResume = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure)
  run consecutiveFiguresAndResume = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure).then(resumeFromFigure)
  run duplicateFigureTickDoesNotConsume = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(tick(2)).then(resumeFromFigure)
  run previousSentenceWhilePlaying = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure).then(resumeFromFigure).then(previousSentence)
  run previousSentenceFromPaused = init.then(open("A")).then(prepareSucceeded("A")).then(pause).then(previousSentence)
  run previousSentenceFromFigure = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(previousSentence)
  run pausedTickDoesNotAdvance = init.then(open("A")).then(prepareSucceeded("A")).then(pause).then(tick(2))
  run staleGenerationTickDoesNotAdvance = init.then(open("A")).then(prepareSucceeded("A")).then(tick(1))
  run cancelThenLatePreparationSuccess = init.then(open("A")).then(cancel("A")).then(prepareSucceeded("A"))
  run switchModeAtFigure = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(switchToText(1)).then(switchToRsvp(1))
  run switchModeAfterFigure = init.then(open("A")).then(prepareSucceeded("A")).then(tick(2)).then(resumeFromFigure).then(resumeFromFigure).then(switchToText(3)).then(switchToRsvp(3))
  run pausedModeRoundTrip = init.then(open("A")).then(prepareSucceeded("A")).then(pause).then(switchToText(0)).then(switchToRsvp(0))
  run rebuildUnitsWhilePlaying = init.then(open("A")).then(prepareSucceeded("A")).then(rebuildUnits(0))
  run visibilityHiddenPauses = init.then(open("A")).then(prepareSucceeded("A")).then(visibilityHidden)
  run visibilityHiddenDuringPreparation = init.then(open("A")).then(visibilityHidden).then(prepareSucceeded("A"))
  run visibilityHiddenDuringPreparationThenFailure = init.then(open("A")).then(visibilityHidden).then(prepareFailed("A"))
  run visibilityHiddenDuringPreparationIsIdempotent = init.then(open("A")).then(visibilityHidden).then(visibilityHidden).then(prepareSucceeded("A"))
}
