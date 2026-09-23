import Foundation

func orderedLineCodes(_ journey: Journey) -> [String] {
    var seen = Set<String>()
    return journey.legs.map(\.line).filter { !$0.isEmpty && seen.insert($0).inserted }
}

func mergeEarlierJourneys(_ earlier: [Journey], current: [Journey], cutoff: Millis) -> [Journey] {
    var rows = Dictionary(earlier.filter { $0.departure >= cutoff }.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
    current.forEach { rows[$0.key] = $0 }
    return rows.values.sorted { $0.effectiveDeparture < $1.effectiveDeparture }
}

struct JourneyRecommendation: Equatable, Sendable {
    var journey: Journey
    var board: BoardData
}

struct OfflinePlanResult: Equatable, Sendable {
    var board: BoardData
    var recommendation: JourneyRecommendation?
}

private let pastBoardRetention: Millis = 86_400_000

extension FocusedJourney {
    /// A board that never knew a locally identified journey cannot demote it; the realtime overlay owns that one.
    func demotedForUnmatchedBoard() -> FocusedJourney? {
        journey.legs.allSatisfy { $0.identity != nil } ? nil : lastKnown()
    }

    /// The overlay is the only refresh a locally identified journey has, so losing its match is last known now.
    func demotedForLostOverlay() -> FocusedJourney? {
        journey.legs.allSatisfy { $0.identity != nil } ? lastKnown() : nil
    }

    func lastKnown() -> FocusedJourney {
        var copy = self
        copy.journey.retained = true
        copy.board.offline = true
        copy.board.journeys = copy.board.journeys.map { journey in
            var retained = journey
            retained.retained = true
            return retained
        }
        return copy
    }
}


/// An offline open keeps the answer the rider last saw without inferring a ride.
func retainedHomeJourney(_ board: BoardData?, now: Millis) -> Journey? {
    guard let board, board.offline, let key = board.homeJourneyKey else { return nil }
    return (board.journeys + (board.recommendation?.journeys ?? []))
        .first { $0.key == key && now <= $0.effectiveArrival + 1_800_000 }
}

func nextHomeJourney(_ board: BoardData, now: Millis) -> Journey? {
    retainedHomeJourney(board, now: now)
        ?? board.journeys.first { !$0.cancelled && $0.effectiveDeparture >= now }
        ?? board.journeys.first { $0.effectiveDeparture >= now }
}

/// Online answers own future services. A failed request cannot erase a saved service.
func mergeBoardResults(previous: BoardData?, local: BoardData?, online: BoardData?, now: Millis) -> BoardData? {
    let base: BoardData
    if let online {
        base = online
    } else if let local, local.isLive(now), !local.journeys.isEmpty {
        base = local
    } else if let previous, !previous.journeys.isEmpty {
        base = retainedOfflineBoard(previous)
    } else if let local {
        base = local
    } else {
        guard let previous else { return nil }
        base = retainedOfflineBoard(previous)
    }

    let prior = previous.flatMap { board in
        board.from.id == base.from.id && board.to.id == base.to.id ? board : nil
    }
    var rows: [String: Journey] = [:]
    func recent(_ journey: Journey) -> Bool {
        journey.effectiveDeparture >= now - pastBoardRetention
    }
    func eligible(_ journey: Journey) -> Bool {
        recent(journey) && (online == nil || journey.effectiveDeparture < now)
    }

    local?.journeys.filter(eligible).forEach { rows[$0.key] = $0 }
    prior?.journeys.filter(eligible).forEach { journey in
        var retained = journey
        retained.retained = true
        rows[retained.key] = retained
    }
    if local?.isLive(now) == true {
        local?.journeys.filter { eligible($0) && $0.realtime }.forEach { rows[$0.key] = $0 }
    }
    online?.journeys.forEach { rows[$0.key] = $0 }

    var merged = base
    merged.journeys = rows.values.sorted { $0.effectiveDeparture < $1.effectiveDeparture }
    merged.homeJourneyKey = prior?.homeJourneyKey
    if online == nil, merged.recommendation == nil, var saved = prior?.recommendation {
        saved.journeys = saved.journeys.map { journey in
            var retained = journey
            retained.retained = true
            return retained
        }
        merged.recommendation = saved
    }
    merged.homeJourneyKey = nextHomeJourney(merged, now: now)?.key
    return merged
}

struct FocusUpdate: Equatable, Sendable {
    var journey: Journey
    var observedAt: Millis?
    var live: Bool
    var matchedLegIndices: Set<Int>
    var canJudgeClock: Bool { !matchedLegIndices.isEmpty }

    init(
        journey: Journey,
        observedAt: Millis? = nil,
        live: Bool = false,
        matchedLegIndices: Set<Int>? = nil
    ) {
        self.journey = journey
        self.observedAt = observedAt
        self.live = live
        self.matchedLegIndices = matchedLegIndices ?? (live ? Set(journey.legs.indices) : [])
    }
}

func focusAfterRefresh(_ focus: FocusedJourney, update: FocusUpdate, alternatives: BoardData?) -> FocusedJourney {
    guard update.journey.key == focus.journey.key,
          update.journey.legs.count == focus.journey.legs.count else {
        var retained = focus.lastKnown()
        retained.alternatives = alternatives ?? focus.alternatives
        return retained
    }
    var result = focus
    let merged = Journey(legs: focus.journey.legs.enumerated().map { index, leg in
        update.matchedLegIndices.contains(index) ? update.journey.legs[index] : leg
    })
    if update.live {
        result.journey = merged
        result.board.journeys = [merged]
        result.board.generatedAt = update.observedAt ?? focus.board.generatedAt
        result.board.source = "live"
        result.board.offline = false
        result.board.serverStale = false
    } else {
        var retained = merged
        retained.retained = true
        result.journey = retained
        result.board.journeys = [retained]
        result.board.generatedAt = min(focus.board.generatedAt, update.observedAt ?? focus.board.generatedAt)
        result.board.offline = true
    }
    if let alternatives { result.alternatives = alternatives }
    return result
}
