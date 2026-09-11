import Foundation

enum ConnectionState: String, Codable, Equatable, Sendable {
    case ordinary, tight, lost, broken
}

struct RecoverySource: Codable, Equatable, Sendable {
    var generatedAt: Millis
    var degraded: Bool

    init(generatedAt: Millis, degraded: Bool) {
        self.generatedAt = generatedAt
        self.degraded = degraded
    }
}

struct RecoveryRecord: Codable, Equatable, Sendable {
    var changeIndex: Int
    var journey: Journey
    var fetchedAt: Millis
    var source: RecoverySource

    init(changeIndex: Int, journey: Journey, fetchedAt: Millis, source: RecoverySource) {
        self.changeIndex = changeIndex
        self.journey = journey
        self.fetchedAt = fetchedAt
        self.source = source
    }
}

struct RecoverySearch: Equatable, Sendable {
    var anchor: Int
    var spliceIndex: Int
    var from: Station
    var at: Millis
}

struct RecoveryPlan: Equatable, Sendable {
    var composed: Journey
    var followedStates: [ConnectionState]
    var composedStates: [ConnectionState]
    var recoveryChangeIndex: Int?
    var search: RecoverySearch?
}

let recoveryConnectionFloor = 3

/// Printed clock minutes, so a window agrees with the two times printed beside it.
func connectionWindow(_ before: Leg, _ after: Leg) -> Int {
    minutesBetween(before.effectiveArrival, after.effectiveDeparture)
}

func connectionState(_ before: Leg, _ after: Leg, recovery: Bool = false) -> ConnectionState {
    if before.cancelled || after.cancelled { return .broken }
    let window = connectionWindow(before, after)
    if window <= 0 { return .lost }
    // A recovery pair was never printed together, so only the window decides it.
    let printed = recovery ? window : minutesBetween(before.arrival, after.departure)
    return window < 5 || window < printed ? .tight : .ordinary
}

func connectionStates(_ legs: [Leg], recoveryFrom changeIndex: Int? = nil) -> [ConnectionState] {
    legs.indices.dropLast().map { index in
        connectionState(legs[index], legs[index + 1], recovery: changeIndex.map { index >= $0 } ?? false)
    }
}

func recoveryCandidate(
    _ journeys: [Journey],
    arrival: Millis,
    modes: Set<String>,
    transferLimit: Int? = nil,
    boardingAt stop: String? = nil
) -> Journey? {
    journeys
        .filter { qualifiesAsRecovery($0, arrival: arrival, modes: modes, transferLimit: transferLimit, stop: stop) }
        .min { $0.effectiveDeparture < $1.effectiveDeparture }
}

private func qualifiesAsRecovery(
    _ journey: Journey, arrival: Millis, modes: Set<String>, transferLimit: Int?, stop: String?
) -> Bool {
    guard let boarding = journey.legs.first, !journey.cancelled, journeyAllowed(journey, modes: modes),
          stop.map({ boarding.from.id == $0 }) ?? true,
          transferLimit.map({ journey.legs.count - 1 <= $0 }) ?? true else { return false }
    return minutesBetween(arrival, journey.effectiveDeparture) >= recoveryConnectionFloor
}

func recoveryPlan(_ focus: FocusedJourney) -> RecoveryPlan {
    let followed = focus.journey.legs
    let followedStates = connectionStates(followed)
    let held = focus.recovery.flatMap { record -> RecoveryRecord? in
        guard followedStates.indices.contains(record.changeIndex), followedStates[record.changeIndex] == .lost,
              record.journey.legs.first?.from.id == followed[record.changeIndex].to.id else { return nil }
        return record
    }
    let composedLegs = held.map { Array(followed.prefix($0.changeIndex + 1)) + $0.journey.legs } ?? followed
    let composed = Journey(legs: composedLegs, retained: focus.journey.retained)
    let composedStates = connectionStates(composedLegs, recoveryFrom: held?.changeIndex)
    // A held record's newest tail boards at the last change: searching there re-matches that tail
    // instead of re-running the original search, which would offer the tail it already replaced.
    let anchor = composedStates.firstIndex(of: .lost) ?? held.map { _ in composedStates.count - 1 }
    let search = anchor.map { anchor in
        RecoverySearch(
            anchor: anchor,
            spliceIndex: min(anchor, held?.changeIndex ?? anchor),
            from: composedLegs[anchor].to,
            at: composedLegs[anchor].effectiveArrival
        )
    }
    return RecoveryPlan(
        composed: composed,
        followedStates: followedStates,
        composedStates: composedStates,
        recoveryChangeIndex: held?.changeIndex,
        search: search
    )
}

/// The record is a sibling of the focused journey: the tail is spliced for rendering, never written into it.
func recoveryRecord(
    plan: RecoveryPlan,
    held: RecoveryRecord?,
    journeys: [Journey],
    modes: Set<String>,
    fetchedAt: Millis,
    source: RecoverySource?,
    transferLimit: Int? = nil
) -> RecoveryRecord? {
    guard let search = plan.search else { return nil }
    let legs = plan.composed.legs
    let standing = plan.recoveryChangeIndex == nil ? nil : held
    let tail = Journey(legs: Array(legs[(search.anchor + 1)...])).key
    // The rider was already told this train: while its own change still connects it is re-matched, never swapped.
    let candidate: Journey? = standing == nil || plan.composedStates.contains(.lost)
        ? recoveryCandidate(journeys, arrival: search.at, modes: modes,
                            transferLimit: transferLimit, boardingAt: search.from.id)
        : journeys.first { $0.key == tail && $0.legs.first?.from.id == search.from.id }
    guard let candidate else { return standing }
    let carried = Array(legs[(search.spliceIndex + 1)..<(search.anchor + 1)])
    return RecoveryRecord(
        changeIndex: search.spliceIndex,
        journey: Journey(legs: carried + candidate.legs),
        fetchedAt: fetchedAt,
        source: source ?? standing?.source ?? RecoverySource(generatedAt: fetchedAt, degraded: true)
    )
}

extension FocusedJourney {
    var composedJourney: Journey { recoveryPlan(self).composed }
}
