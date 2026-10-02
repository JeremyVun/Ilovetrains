import Foundation

let travelSeen: Millis = 900_000
let travelLate: Millis = 1_800_000
let travelMovedMetres = 1_000.0
let travelSpeedMovedMetres = 200.0
// A train pulling out stays within 300 m of the platform for its first 20-30 s.
let holdSightingAfter: Millis = 60_000
// By then a departed train is kilometres out: a fix reads train speed or finds the rider still waiting.
let shownDepartureFixWindow: Millis = 300_000
let movingFixFresh: Millis = 120_000
// Rhodes → Redfern and Town Hall → Rhodes bend to 1.27 and 1.2 of the straight line.
let corridorRatio = 1.5
let headingWindowDegrees = 90.0
let closingMetres = 200.0
let onBoardCandidates = 3
let onBoardLimit = 10
let onBoardLookbackMargin: Millis = 600_000
let onBoardDefaultRide: Millis = 3_600_000
// Eight-minute headways on a 25-minute ride put neighbouring services 0.32 apart.
let progressWindow = 0.25
// A car following the line would otherwise match the next train along one fix later.
let declineHold: Millis = 3_600_000
let newOpenAfter: Millis = 600_000
let timetablePageLimit = 30
let firstPastPageLookback: Millis = 1_800_000
let firstPastPageLimit = 10
let pastPageStep: Millis = 3_600_000
let pastPageBound: Millis = 86_400_000

extension Journey {
    /// The first service leg's line and scheduled departure: the web's `departureKey`.
    var departureKey: String { legs.first.map { Journey(legs: [$0]).key } ?? "" }
}

func rideRecorded(_ data: UserData, tripId: String, reverse: Bool, journey: Journey) -> Bool {
    data.rides.contains { $0.tripId == tripId && $0.reverse == reverse && $0.departure == journey.departure }
}

private func origin(_ trip: SavedTrip, reverse: Bool) -> Station { reverse ? trip.to : trip.from }
private func destination(_ trip: SavedTrip, reverse: Bool) -> Station { reverse ? trip.from : trip.to }
private func located(_ station: Station) -> Bool { station.lat != 0 || station.lon != 0 }

func lastAnswerInferable(_ record: LastAnswer?, data: UserData, now: Millis) -> Bool {
    guard let record, let trip = data.trips.first(where: { $0.id == record.tripId }),
          record.stationId == origin(trip, reverse: record.reverse).id else { return false }
    let departure = record.journey.effectiveDeparture
    return (0...travelSeen).contains(departure - record.at) && now <= record.journey.effectiveArrival + travelLate
}

// A record unsighted or sighted anywhere but the held origin proves nothing, so it cannot erase evidence.
func replacesLastAnswer(data: UserData, incoming: LastAnswer, now: Millis, sightingAt: Millis?) -> Bool {
    guard let stored = data.lastAnswer, lastAnswerInferable(stored, data: data, now: now),
          let trip = data.trips.first(where: { $0.id == stored.tripId }) else { return true }
    guard incoming.stationId == origin(trip, reverse: stored.reverse).id else { return false }
    let departure = stored.journey.effectiveDeparture
    return now < departure || (sightingAt.map { $0 >= departure + holdSightingAfter } ?? false)
}

func tickNeedsFix(data: UserData, now: Millis, shownDepartures: [Millis], fix: Fix?, previousFix: Fix?) -> Bool {
    if shownDepartures.contains(where: { now >= $0 && now - $0 <= shownDepartureFixWindow }) { return true }
    if let stored = data.lastAnswer, lastAnswerInferable(stored, data: data, now: now),
       stored.journey.effectiveDeparture <= now { return true }
    guard let fix else { return false }
    return now - fix.at <= movingFixFresh && trainSpeed(fix, previous: previousFix)
}

func inferenceDeclined(_ data: UserData, tripId: String, now: Millis, journey: Journey? = nil) -> Bool {
    guard let decline = data.inferenceDeclined, decline.tripId == tripId else { return false }
    if let journey, journey.departureKey == decline.departure { return true }
    return now < max(decline.at + declineHold, decline.arrival + travelLate)
}

func inferenceDecline(of focus: FocusedJourney, at now: Millis) -> InferenceDecline {
    InferenceDecline(tripId: focus.tripId, reverse: focus.reverse, at: now,
                     departure: focus.journey.departureKey, arrival: focus.composedJourney.effectiveArrival)
}

// Moving toward the destination is what stops a walk home for a forgotten laptop reading as a ride.
func inferredFocus(data: UserData, record: LastAnswer?, fix: Fix, now: Millis) -> FocusedJourney? {
    guard data.useLocation,
          data.focus == nil,
          isCurrent(fix, now: now),
          let last = record,
          let trip = data.trips.first(where: { $0.id == last.tripId }),
          compatible(trip, modes: data.modes),
          journeyAllowed(last.journey, modes: data.modes),
          data.withinTransferLimit(last.journey),
          !rideRecorded(data, tripId: trip.id, reverse: last.reverse, journey: last.journey),
          !inferenceDeclined(data, tripId: trip.id, now: now, journey: last.journey) else { return nil }

    let from = origin(trip, reverse: last.reverse)
    let to = destination(trip, reverse: last.reverse)
    let journey = last.journey
    guard now >= journey.effectiveDeparture, now <= journey.effectiveArrival + travelLate,
          last.stationId == from.id,
          journey.effectiveDeparture - last.at <= travelSeen else { return nil }

    let left = distanceMetres(fix, from)
    let tripDistance = distanceMetres(Fix(lat: from.lat, lon: from.lon, at: now), to)
    let toward = left >= travelMovedMetres && distanceMetres(fix, to) <= tripDistance - travelMovedMetres
    let fast = (fix.speed ?? 0) >= trainSpeedMetresPerSecond && left >= travelSpeedMovedMetres
    guard left.isFinite, tripDistance.isFinite, toward || fast else { return nil }
    return FocusedJourney(tripId: trip.id, reverse: last.reverse, journey: journey, board: last.board, pinned: false)
}

/// Home's Start trip: the window auto-start uses for "seen at the platform".
func startable(_ journey: Journey, now: Millis) -> Bool {
    !journey.cancelled && (0...travelSeen).contains(journey.effectiveDeparture - now)
}

extension AppState {
    /// What Home's Start trip would start: the header's lead journey, only while no trip mode is on.
    var startableLead: Journey? {
        guard focus == nil, let lead = displayedHomeLead(self), startable(lead, now: now) else { return nil }
        return lead
    }
}

/// A board row on its way starts trip mode at once instead of opening detail.
func onItsWay(_ journey: Journey, now: Millis, data: UserData) -> Bool {
    journey.effectiveDeparture <= now && now < journey.effectiveArrival && !journey.cancelled
        && journeyAllowed(journey, modes: data.modes) && data.withinTransferLimit(journey)
}

// Owner ruling 13: the open's snapshot, unchanged, and then the stored record may each enter.
func inferFromRecords(data: UserData, snapshot: LastAnswer?, fix: Fix, now: Millis) -> FocusedJourney? {
    for record in [snapshot, data.lastAnswer] {
        if let entered = inferredFocus(data: data, record: record, fix: fix, now: now) { return entered }
    }
    return nil
}

struct OnBoardRequest: Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var from: Station
    var to: Station
    var at: Millis
    var limit: Int
    var key: String { onBoardKey(tripId: tripId, reverse: reverse) }
}

func onBoardKey(tripId: String, reverse: Bool) -> String { "\(tripId)|\(reverse ? "reverse" : "forward")" }

private func bearingDegrees(_ from: Fix, _ to: Station) -> Double {
    let radians = Double.pi / 180
    let longitude = (to.lon - from.lon) * radians
    let y = sin(longitude) * cos(to.lat * radians)
    let x = cos(from.lat * radians) * sin(to.lat * radians) - sin(from.lat * radians) * cos(to.lat * radians) * cos(longitude)
    return (atan2(y, x) / radians + 360).truncatingRemainder(dividingBy: 360)
}

private func turn(_ a: Double, _ b: Double) -> Double {
    abs(((a - b).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180)
}

/// True when the rider rides toward the trip's origin; nil until exactly one direction passes a test.
private func onBoardReverse(_ trip: SavedTrip, fix: Fix, previousFix: Fix?) -> Bool? {
    func pick(_ test: (Station) -> Bool) -> Bool? {
        let chosen = [false, true].filter { test(destination(trip, reverse: $0)) }
        return chosen.count == 1 ? chosen[0] : nil
    }
    if let course = fix.course, course.isFinite, course >= 0,
       let reverse = pick({ turn(course, bearingDegrees(fix, $0)) <= headingWindowDegrees }) { return reverse }
    guard previousFixUsable(fix, previousFix), let previousFix else { return nil }
    return pick { distanceMetres(previousFix, $0) - distanceMetres(fix, $0) >= closingMetres }
}

private func rideDuration(_ journey: Journey) -> Millis? {
    let duration = journey.effectiveArrival - journey.effectiveDeparture
    return duration >= 0 ? duration : nil
}

func onBoardRequests(data: UserData, now: Millis, fix: Fix, previousFix: Fix?, cached: [String: [Journey]] = [:]) -> [OnBoardRequest] {
    guard trainSpeed(fix, previous: previousFix) else { return [] }
    let candidates = data.trips.enumerated().compactMap { index, trip -> (trip: SavedTrip, index: Int, reverse: Bool, ratio: Double)? in
        guard compatible(trip, modes: data.modes), located(trip.from), located(trip.to) else { return nil }
        let span = distanceMetres(Fix(lat: trip.from.lat, lon: trip.from.lon, at: now), trip.to)
        let fromOrigin = distanceMetres(fix, trip.from)
        let toDestination = distanceMetres(fix, trip.to)
        guard span > 0, fromOrigin >= travelMovedMetres, toDestination >= travelMovedMetres else { return nil }
        let ratio = (fromOrigin + toDestination) / span
        guard ratio <= corridorRatio, !inferenceDeclined(data, tripId: trip.id, now: now),
              let reverse = onBoardReverse(trip, fix: fix, previousFix: previousFix) else { return nil }
        return (trip, index, reverse, ratio)
    }
    return candidates.sorted { $0.ratio != $1.ratio ? $0.ratio < $1.ratio : $0.index < $1.index }
        .prefix(onBoardCandidates)
        .map { candidate in
            let key = onBoardKey(tripId: candidate.trip.id, reverse: candidate.reverse)
            let ride = (cached[key] ?? []).compactMap(rideDuration).max() ?? onBoardDefaultRide
            return OnBoardRequest(
                tripId: candidate.trip.id, reverse: candidate.reverse,
                from: origin(candidate.trip, reverse: candidate.reverse),
                to: destination(candidate.trip, reverse: candidate.reverse),
                at: now - (ride + onBoardLookbackMargin), limit: onBoardLimit
            )
        }
}

func inferOnBoard(
    data: UserData,
    now: Millis,
    fix: Fix,
    previousFix: Fix?,
    boards: [String: BoardData],
    cached: [String: [Journey]] = [:]
) -> FocusedJourney? {
    guard data.focus == nil else { return nil }
    struct Match {
        var focus: FocusedJourney
        var score: Double
        var gap: Double
        var order: Int
    }
    var matches: [Match] = []
    for request in onBoardRequests(data: data, now: now, fix: fix, previousFix: previousFix, cached: cached) {
        guard let order = data.trips.firstIndex(where: { $0.id == request.tripId }), let board = boards[request.key] else { continue }
        let fromOrigin = distanceMetres(fix, request.from)
        let position = fromOrigin / (fromOrigin + distanceMetres(fix, request.to))
        let score = historyScore(events: data.history, tripId: request.tripId, reverse: request.reverse, now: now)
        for journey in board.journeys {
            let departure = journey.effectiveDeparture
            let arrival = journey.effectiveArrival
            guard departure <= now, now <= arrival, departure < arrival, !journey.cancelled,
                  journeyAllowed(journey, modes: data.modes), data.withinTransferLimit(journey),
                  !rideRecorded(data, tripId: request.tripId, reverse: request.reverse, journey: journey),
                  !inferenceDeclined(data, tripId: request.tripId, now: now, journey: journey) else { continue }
            let gap = abs((now - departure) / (arrival - departure) - position)
            guard gap <= progressWindow else { continue }
            let focus = FocusedJourney(tripId: request.tripId, reverse: request.reverse, journey: journey, board: board, pinned: false)
            matches.append(Match(focus: focus, score: score, gap: gap, order: order))
        }
    }
    // History separates saved trips that share a train.
    return matches.min { a, b in
        if a.score != b.score { return a.score > b.score }
        if a.gap != b.gap { return a.gap < b.gap }
        let identity = compareJourneyIdentity(a.focus.journey, b.focus.journey)
        if identity != .orderedSame { return identity == .orderedAscending }
        if a.order != b.order { return a.order < b.order }
        return !a.focus.reverse && b.focus.reverse
    }?.focus
}

func mergedPage(online: BoardData?, timetable: BoardData?) -> BoardData? {
    guard var merged = online ?? timetable else { return nil }
    var rows: [String: Journey] = [:]
    timetable?.journeys.forEach { rows[$0.key] = $0 }
    online?.journeys.forEach { rows[$0.key] = $0 }
    merged.journeys = rows.values.sorted {
        $0.effectiveDeparture != $1.effectiveDeparture ? $0.effectiveDeparture < $1.effectiveDeparture : $0.key < $1.key
    }
    return merged
}
