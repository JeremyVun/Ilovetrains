import Foundation

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
    /// The composed change this tail was searched from; `changeIndex` until a later search moved it.
    var anchor: Int

    init(changeIndex: Int, journey: Journey, fetchedAt: Millis, source: RecoverySource, anchor: Int? = nil) {
        self.changeIndex = changeIndex
        self.journey = journey
        self.fetchedAt = fetchedAt
        self.source = source
        self.anchor = anchor ?? changeIndex
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        changeIndex = try container.decode(Int.self, forKey: .changeIndex)
        journey = try container.decode(Journey.self, forKey: .journey)
        fetchedAt = try container.decode(Millis.self, forKey: .fetchedAt)
        source = try container.decode(RecoverySource.self, forKey: .source)
        anchor = (try? container.decode(Int.self, forKey: .anchor)) ?? changeIndex
    }

    /// A record written before `anchor` existed, or carrying one its own legs cannot reach, searches from its change.
    var searchAnchor: Int {
        anchor > changeIndex && anchor <= changeIndex + journey.legs.count - 1 ? anchor : changeIndex
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
    // The record's own anchor, so a held tail is re-matched from where it was searched and cannot oscillate.
    let anchor = composedStates.firstIndex(of: .lost) ?? held.map { $0.searchAnchor }
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
        source: source ?? standing?.source ?? RecoverySource(generatedAt: fetchedAt, degraded: true),
        anchor: search.anchor
    )
}

extension FocusedJourney {
    var composedJourney: Journey { recoveryPlan(self).composed }
}
