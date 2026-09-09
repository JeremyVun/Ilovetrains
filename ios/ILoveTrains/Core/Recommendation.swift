import Foundation

let transferPenaltyMillis: Millis = 300_000

private struct RecommendationTuple {
    var cost: Millis
    var changes: Int
    var arrival: Millis
    var departure: Millis
    var identity: [(String, Millis)]
}

func recommendationCost(_ journey: Journey) -> Millis? {
    recommendationTuple(journey)?.cost
}

func compareRecommendations(_ left: Journey, _ right: Journey) -> ComparisonResult {
    guard let lhs = recommendationTuple(left), let rhs = recommendationTuple(right) else {
        return recommendationTuple(left) != nil ? .orderedAscending
            : recommendationTuple(right) != nil ? .orderedDescending : .orderedSame
    }
    for (a, b) in [(lhs.cost, rhs.cost), (Millis(lhs.changes), Millis(rhs.changes)),
                   (lhs.arrival, rhs.arrival), (lhs.departure, rhs.departure)] {
        if a != b { return a < b ? .orderedAscending : .orderedDescending }
    }
    for (a, b) in zip(lhs.identity, rhs.identity) {
        let name = compareCodePoints(a.0, b.0)
        if name != .orderedSame { return name }
        if a.1 != b.1 { return a.1 < b.1 ? .orderedAscending : .orderedDescending }
    }
    if lhs.identity.count == rhs.identity.count { return .orderedSame }
    return lhs.identity.count < rhs.identity.count ? .orderedAscending : .orderedDescending
}

func selectRecommendation(
    _ journeys: [Journey],
    now: Millis,
    modes: Set<String> = allModes,
    maxTransfers: Int? = nil
) -> Journey? {
    journeys
        .filter { recommendationEligible($0, now: now, modes: modes, maxTransfers: maxTransfers) }
        .min { compareRecommendations($0, $1) == .orderedAscending }
}

func recommendationIsFresh(_ value: JourneyRecommendation, now: Millis, maxTransfers: Int?) -> Bool {
    value.board.requestMaxTransfers == maxTransfers && value.board.isLive(now) && value.journey.retained != true
}

func selectRecommendation(
    _ candidates: [JourneyRecommendation],
    now: Millis,
    modes: Set<String>,
    maxTransfers: Int?
) -> JourneyRecommendation? {
    let allowed = candidates.filter {
        recommendationEligible($0.journey, now: now, modes: modes, maxTransfers: maxTransfers)
    }
    let fresh = allowed.filter {
        $0.board.requestMaxTransfers == maxTransfers && $0.board.isLive(now) && $0.journey.retained != true
    }
    return (fresh.isEmpty ? allowed : fresh).min {
        compareRecommendations($0.journey, $1.journey) == .orderedAscending
    }
}

func recommendationCandidates(_ board: BoardData) -> [JourneyRecommendation] {
    var values: [String: JourneyRecommendation] = [:]
    func add(_ source: BoardData) {
        for journey in source.journeys {
            let candidate = JourneyRecommendation(journey: journey, board: source)
            if let existing = values[journey.key], existing.board.generatedAt >= source.generatedAt { continue }
            values[journey.key] = candidate
        }
    }
    add(board)
    for page in board.recommendationPages ?? [] { add(page.board(from: board.from, to: board.to)) }
    if let recommendation = board.recommendation { add(recommendation.board(from: board.from, to: board.to)) }
    return Array(values.values)
}

func earliestAlternative(
    _ candidates: [JourneyRecommendation],
    recommended: Journey,
    now: Millis,
    modes: Set<String>,
    maxTransfers: Int?
) -> JourneyRecommendation? {
    guard let firstIdentity = recommended.legs.first.map({ ($0.line, $0.departure) }) else { return nil }
    return candidates.filter {
        guard recommendationEligible($0.journey, now: now, modes: modes, maxTransfers: maxTransfers),
              let leg = $0.journey.legs.first else { return false }
        return leg.line != firstIdentity.0 || leg.departure != firstIdentity.1
    }.min {
        if $0.journey.effectiveDeparture != $1.journey.effectiveDeparture {
            return $0.journey.effectiveDeparture < $1.journey.effectiveDeparture
        }
        return compareRecommendations($0.journey, $1.journey) == .orderedAscending
    }
}

func nextRecommendationCursor(
    page: BoardData,
    previousAt: Millis,
    now: Millis,
    best: Journey?
) -> Millis? {
    guard let greatest = page.journeys.map(\.effectiveDeparture).filter(\.isFinite).max() else { return nil }
    let cursor = (floor(greatest / 600_000) + 1) * 600_000
    if cursor <= previousAt || cursor > now + 7_200_000 { return nil }
    if let bestCost = best.flatMap(recommendationCost), cursor > bestCost { return nil }
    return cursor
}

private func recommendationEligible(
    _ journey: Journey,
    now: Millis,
    modes: Set<String>,
    maxTransfers: Int?
) -> Bool {
    guard recommendationTuple(journey) != nil,
          journey.effectiveDeparture >= now,
          journeyAllowed(journey, modes: modes) else { return false }
    return maxTransfers.map { journey.legs.count - 1 <= $0 } ?? true
}

private func recommendationTuple(_ journey: Journey) -> RecommendationTuple? {
    guard !journey.legs.isEmpty, !journey.cancelled else { return nil }
    for leg in journey.legs {
        guard validTransitMillis(leg.departure), validTransitMillis(leg.arrival),
              validTransitMillis(leg.effectiveDeparture), validTransitMillis(leg.effectiveArrival),
              leg.effectiveArrival >= leg.effectiveDeparture else { return nil }
    }
    for index in 1..<journey.legs.count where
        journey.legs[index].effectiveDeparture < journey.legs[index - 1].effectiveArrival {
        return nil
    }
    let departure = journey.effectiveDeparture
    let arrival = journey.effectiveArrival
    guard arrival >= departure else { return nil }
    let changes = journey.legs.count - 1
    return RecommendationTuple(
        cost: arrival + Millis(changes) * transferPenaltyMillis,
        changes: changes,
        arrival: arrival,
        departure: departure,
        identity: journey.legs.map { ($0.line, $0.departure) }
    )
}

private func compareCodePoints(_ left: String, _ right: String) -> ComparisonResult {
    let lhs = left.unicodeScalars.map(\.value)
    let rhs = right.unicodeScalars.map(\.value)
    for (a, b) in zip(lhs, rhs) where a != b {
        return a < b ? .orderedAscending : .orderedDescending
    }
    if lhs.count == rhs.count { return .orderedSame }
    return lhs.count < rhs.count ? .orderedAscending : .orderedDescending
}
