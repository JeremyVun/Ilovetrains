import Foundation

enum TravelTrackerStage: String, Equatable, Sendable { case boarding, ride, transfer, final, missedTransfer }
enum TravelTrackerEventKind: String, Equatable, Sendable { case departure, arrival, cancellation, missedConnection }
enum TravelTrackerPlatformRole: String, Equatable, Sendable { case alight, board }
enum TravelTrackerFreshness: String, Equatable, Sendable { case live, retained, offline, stale, scheduled }
enum TravelTrackerSegmentKind: String, Equatable, Sendable { case ride, gap }

struct TravelTrackerIdentity: Codable, Equatable, Hashable, Sendable {
    var tripId: String
    var reverse: Bool
    var serviceKey: String
}

struct TravelTrackerRevision: Equatable, Sendable {
    var identity: TravelTrackerIdentity
    var generation: Int

    func canReplace(_ current: TravelTrackerRevision) -> Bool {
        identity == current.identity && generation >= current.generation
    }
}

struct TravelTrackerHeadline: Equatable, Sendable {
    var lead: String
    var emphasis: String?
    var tail: String

    init(lead: String, emphasis: String? = nil, tail: String = "") {
        self.lead = lead
        self.emphasis = emphasis
        self.tail = tail
    }

    var text: String { lead + (emphasis ?? "") + tail }
}

struct TravelTrackerEvent: Equatable, Sendable {
    var kind: TravelTrackerEventKind
    var name: String
    var deadline: Millis
    var countdownMinutes: Int?
}

struct TravelTrackerPlatform: Equatable, Sendable {
    var role: TravelTrackerPlatformRole
    var legIndex: Int
    var mode: String
    var stationId: String
    var stationName: String
    var label: String
}

struct TravelTrackerMissedConnection: Equatable, Sendable {
    var fromLegIndex: Int
    var toLegIndex: Int
    var line: String
    var arrival: Millis
    var departure: Millis
    var arrivalStationId: String
    var arrivalStationName: String
    var departureStationId: String
    var departureStationName: String
}

struct TravelTrackerSegment: Equatable, Sendable {
    var kind: TravelTrackerSegmentKind
    var legIndex: Int
    var line: String?
    var mode: String?
    var start: Millis
    var end: Millis
    var startFraction: Double
    var endFraction: Double

    var lengthFraction: Double { max(0, endFraction - startFraction) }
}

struct TravelTrackerState: Equatable, Sendable {
    var revision: TravelTrackerRevision
    var stage: TravelTrackerStage
    var activeLegIndex: Int
    var event: TravelTrackerEvent
    var headline: TravelTrackerHeadline
    var instruction: String
    var platforms: [TravelTrackerPlatform]
    var connection: String?
    var tightConnection: Bool
    var missedConnection: TravelTrackerMissedConnection?
    var destination: String
    var eta: Millis
    var etaText: String
    var segments: [TravelTrackerSegment]
    var progress: Double
    var freshness: TravelTrackerFreshness
    var provenance: String
    var retained: Bool
    var cancelled: Bool
    var arrivalCancelled: Bool
    var nextBoundary: Millis
    var freshUntil: Millis?

    static func derive(
        focus: FocusedJourney,
        now: Millis,
        generation: Int,
        arrivalState: ArrivalState? = nil,
        arrivalMoving: Bool = false
    ) -> TravelTrackerState? {
        let legs = focus.journey.legs
        guard !legs.isEmpty else { return nil }
        let projectionEnd = legs.map(\.effectiveArrival).max()!
        let unresolved = arrivalState == .checkingArrival || arrivalState == .arrivalUnconfirmed
        let cancellationPending = arrivalState == .travelling && focus.journey.cancelled
        guard now < projectionEnd || unresolved || cancellationPending else { return nil }

        let identity = TravelTrackerIdentity(tripId: focus.tripId, reverse: focus.reverse, serviceKey: focus.journey.key)
        let revision = TravelTrackerRevision(identity: identity, generation: generation)
        let missedIndex = legs.indices.dropLast().first {
            legs[$0].effectiveArrival > legs[$0 + 1].effectiveDeparture
        }
        let missed = missedIndex.map { trackerMissedConnection(legs, index: $0) }
        let position = trackerPosition(legs, now: now, missedIndex: missedIndex, projectionEnd: projectionEnd)
        let last = legs[legs.count - 1]
        let destination = last.to.shortName
        let cancelledLeg = legs.first(where: \.cancelled)
        let event: TravelTrackerEvent
        let headline: TravelTrackerHeadline
        let instruction: String
        let connection: String?
        let tight: Bool

        if let cancelledLeg {
            let name = cancelledLeg.line.isEmpty ? trackerVehicle(cancelledLeg.mode) : cancelledLeg.line
            event = TravelTrackerEvent(kind: .cancellation, name: name,
                                       deadline: cancelledLeg.effectiveDeparture, countdownMinutes: nil)
            headline = TravelTrackerHeadline(lead: "\(name) cancelled")
            instruction = "\(trackerClock(cancelledLeg.effectiveDeparture)) from \(cancelledLeg.from.shortName) cancelled."
            connection = nil
            tight = false
        } else if unresolved && now >= projectionEnd {
            event = TravelTrackerEvent(
                kind: .arrival,
                name: destination,
                deadline: projectionEnd,
                countdownMinutes: nil
            )
            if arrivalState == .checkingArrival {
                headline = TravelTrackerHeadline(lead: "Checking arrival")
                instruction = "Checking arrival at \(destination)."
            } else if arrivalMoving {
                headline = TravelTrackerHeadline(lead: "Arrival uncertain")
                instruction = "Still on the way to \(destination)."
            } else {
                headline = TravelTrackerHeadline(lead: "Arrival unconfirmed")
                instruction = "Arrival time needs an update."
            }
            connection = "Last estimate \(trackerClock(last.effectiveArrival))"
            tight = false
        } else {
            let built = trackerCopy(legs, position: position, now: now, missed: missed)
            event = built.event
            headline = built.headline
            instruction = built.instruction
            connection = built.connection
            tight = built.tight
        }

        let source = trackerFreshness(focus, now: now)
        return TravelTrackerState(
            revision: revision,
            stage: position.stage,
            activeLegIndex: position.legIndex,
            event: event,
            headline: headline,
            instruction: instruction,
            platforms: trackerPlatforms(legs, position: position, missedIndex: missedIndex),
            connection: connection,
            tightConnection: tight,
            missedConnection: missed,
            destination: destination,
            eta: last.effectiveArrival,
            etaText: unresolved && now >= projectionEnd
                ? "Last estimate \(trackerClock(last.effectiveArrival))"
                : (missed == nil ? "about " : "Planned ") + trackerClock(last.effectiveArrival),
            segments: trackerSegments(legs, projectionEnd: projectionEnd),
            progress: unresolved ? min(0.98, trackerProgress(legs, now: now, projectionEnd: projectionEnd)) : trackerProgress(legs, now: now, projectionEnd: projectionEnd),
            freshness: source.0,
            provenance: trackerProvenance(focus, freshness: source.0),
            retained: focus.journey.retained == true,
            cancelled: cancelledLeg != nil,
            arrivalCancelled: last.cancelled,
            nextBoundary: position.boundary,
            freshUntil: source.1
        )
    }
}

private struct TrackerPosition {
    var stage: TravelTrackerStage
    var legIndex: Int
    var boundary: Millis
}

private func trackerPosition(
    _ legs: [Leg],
    now: Millis,
    missedIndex: Int?,
    projectionEnd: Millis
) -> TrackerPosition {
    if now < legs[0].effectiveDeparture {
        return TrackerPosition(stage: .boarding, legIndex: 0, boundary: legs[0].effectiveDeparture)
    }
    for (index, leg) in legs.enumerated() {
        if now < leg.effectiveArrival {
            return TrackerPosition(stage: index == legs.count - 1 ? .final : .ride,
                                   legIndex: index, boundary: leg.effectiveArrival)
        }
        if index == missedIndex {
            return TrackerPosition(stage: .missedTransfer, legIndex: index, boundary: projectionEnd)
        }
        if index + 1 < legs.count, now < legs[index + 1].effectiveDeparture {
            return TrackerPosition(stage: .transfer, legIndex: index + 1,
                                   boundary: legs[index + 1].effectiveDeparture)
        }
    }
    return TrackerPosition(stage: .final, legIndex: legs.count - 1, boundary: legs[legs.count - 1].effectiveArrival)
}

private struct TrackerCopy {
    var event: TravelTrackerEvent
    var headline: TravelTrackerHeadline
    var instruction: String
    var connection: String?
    var tight: Bool
}

private func trackerCopy(
    _ legs: [Leg],
    position: TrackerPosition,
    now: Millis,
    missed: TravelTrackerMissedConnection?
) -> TrackerCopy {
    let leg = legs[position.legIndex]
    let countdown = max(0, trackerMinutes(now, position.boundary))
    let emphasis = trackerCountdownText(countdown)
    switch position.stage {
    case .boarding:
        let name = leg.line.isEmpty ? trackerVehicle(leg.mode) : leg.line
        return TrackerCopy(
            event: TravelTrackerEvent(kind: .departure, name: name,
                                      deadline: position.boundary, countdownMinutes: countdown),
            headline: TravelTrackerHeadline(lead: "\(name) leaves in ", emphasis: emphasis),
            instruction: trackerBoardInstruction(leg),
            connection: "Departs \(trackerClock(leg.effectiveDeparture))",
            tight: false
        )
    case .ride:
        let next = legs[position.legIndex + 1]
        let changeMinutes = trackerMinutes(leg.effectiveArrival, next.effectiveDeparture)
        if let missed, missed.fromLegIndex == position.legIndex {
            return TrackerCopy(
                event: TravelTrackerEvent(kind: .arrival, name: leg.to.shortName,
                                          deadline: position.boundary, countdownMinutes: countdown),
                headline: TravelTrackerHeadline(lead: "\(leg.to.shortName) in ", emphasis: emphasis),
                instruction: trackerAlightInstruction(leg),
                connection: "\(missed.line) departs \(trackerClock(missed.departure)) before arrival",
                tight: false
            )
        }
        return TrackerCopy(
            event: TravelTrackerEvent(kind: .arrival, name: leg.to.shortName,
                                      deadline: position.boundary, countdownMinutes: countdown),
            headline: TravelTrackerHeadline(lead: "\(leg.to.shortName) in ", emphasis: emphasis),
            instruction: trackerRideInstruction(leg, next: next),
            connection: changeMinutes < 0
                ? "\(next.line.isEmpty ? trackerVehicle(next.mode) : next.line) departs \(trackerClock(next.effectiveDeparture)) before arrival"
                : changeMinutes < 5
                    ? "Tight change · \(next.line.isEmpty ? trackerVehicle(next.mode) : next.line) departs \(trackerClock(next.effectiveDeparture))"
                    : "\(changeMinutes) min to change",
            tight: changeMinutes < 5
        )
    case .transfer:
        let name = leg.line.isEmpty ? trackerVehicle(leg.mode) : leg.line
        let prior = legs[position.legIndex - 1]
        let changeMinutes = trackerMinutes(prior.effectiveArrival, leg.effectiveDeparture)
        let tight = changeMinutes < 5
        return TrackerCopy(
            event: TravelTrackerEvent(kind: .departure, name: name,
                                      deadline: position.boundary, countdownMinutes: countdown),
            headline: TravelTrackerHeadline(lead: "\(name) leaves in ", emphasis: emphasis),
            instruction: trackerBoardInstruction(leg),
            connection: (tight ? "Tight change · departs " : "Departs ") + trackerClock(leg.effectiveDeparture),
            tight: tight
        )
    case .final:
        return TrackerCopy(
            event: TravelTrackerEvent(kind: .arrival, name: leg.to.shortName,
                                      deadline: position.boundary, countdownMinutes: countdown),
            headline: TravelTrackerHeadline(lead: "\(leg.to.shortName) in ", emphasis: emphasis),
            instruction: trackerFinalInstruction(leg),
            connection: nil,
            tight: false
        )
    case .missedTransfer:
        guard let missed else { preconditionFailure("Missed stage requires its connection") }
        return TrackerCopy(
            event: TravelTrackerEvent(kind: .missedConnection, name: missed.line,
                                      deadline: missed.departure, countdownMinutes: nil),
            headline: TravelTrackerHeadline(lead: "\(missed.line) connection unavailable"),
            instruction: "\(missed.line) departure \(trackerClock(missed.departure)) is before the \(trackerClock(missed.arrival)) arrival.",
            connection: nil,
            tight: false
        )
    }
}

private func trackerPlatforms(_ legs: [Leg], position: TrackerPosition, missedIndex: Int?) -> [TravelTrackerPlatform] {
    var roles: [TravelTrackerPlatform] = []
    func append(_ raw: String?, legIndex: Int, role: TravelTrackerPlatformRole) {
        let leg = legs[legIndex]
        guard let label = trackerPlatform(raw, mode: leg.mode) else { return }
        let station = role == .board ? leg.from : leg.to
        roles.append(TravelTrackerPlatform(role: role, legIndex: legIndex, mode: leg.mode,
                                           stationId: station.id, stationName: station.shortName, label: label))
    }
    switch position.stage {
    case .boarding, .transfer:
        append(legs[position.legIndex].fromPlatform, legIndex: position.legIndex, role: .board)
    case .ride:
        append(legs[position.legIndex].toPlatform, legIndex: position.legIndex, role: .alight)
        if position.legIndex != missedIndex {
            append(legs[position.legIndex + 1].fromPlatform, legIndex: position.legIndex + 1, role: .board)
        }
    case .final:
        append(legs[position.legIndex].toPlatform, legIndex: position.legIndex, role: .alight)
    case .missedTransfer:
        break
    }
    return roles
}

private func trackerBoardInstruction(_ leg: Leg) -> String {
    let destination = leg.headsign.isEmpty ? leg.to.shortName : leg.headsign
    guard let place = trackerPlatform(leg.fromPlatform, mode: leg.mode) else {
        return "Go to \(leg.from.shortName) for \(destination)."
    }
    return "Go to \(place) for \(destination)."
}

private func trackerRideInstruction(_ leg: Leg, next: Leg) -> String {
    let first = trackerPlatform(leg.toPlatform, mode: leg.mode).map {
        "Get off \(trackerPlacePreposition(leg.mode)) \($0)"
    } ?? "Get off at \(leg.to.shortName)"
    let service = next.line.isEmpty ? trackerVehicle(next.mode) : next.line
    let crossHub = leg.to.id != next.from.id
    let second = trackerPlatform(next.fromPlatform, mode: next.mode).map {
        crossHub ? "then take \(service) from \($0) at \(next.from.shortName)" : "then take \(service) from \($0)"
    } ?? "then take \(service) from \(next.from.shortName)"
    return "\(first), \(second)."
}

private func trackerFinalInstruction(_ leg: Leg) -> String {
    if let place = trackerPlatform(leg.toPlatform, mode: leg.mode) {
        return "Get off \(trackerPlacePreposition(leg.mode)) \(place)."
    }
    return "Get off at \(leg.to.shortName)."
}

private func trackerAlightInstruction(_ leg: Leg) -> String {
    guard let place = trackerPlatform(leg.toPlatform, mode: leg.mode) else {
        return "Get off at \(leg.to.shortName)."
    }
    return "Get off \(trackerPlacePreposition(leg.mode)) \(place)."
}

private func trackerMissedConnection(_ legs: [Leg], index: Int) -> TravelTrackerMissedConnection {
    let before = legs[index]
    let after = legs[index + 1]
    return TravelTrackerMissedConnection(
        fromLegIndex: index,
        toLegIndex: index + 1,
        line: after.line.isEmpty ? trackerVehicle(after.mode) : after.line,
        arrival: before.effectiveArrival,
        departure: after.effectiveDeparture,
        arrivalStationId: before.to.id,
        arrivalStationName: before.to.shortName,
        departureStationId: after.from.id,
        departureStationName: after.from.shortName
    )
}

private func trackerPlacePreposition(_ mode: String) -> String {
    mode.lowercased() == "ferry" ? "at" : "on"
}

private func trackerPlatform(_ raw: String?, mode: String) -> String? {
    guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    let place = mode.lowercased() == "ferry" ? "Wharf" : "Platform"
    if value.range(of: "\\b\(place)\\b", options: [.regularExpression, .caseInsensitive]) != nil { return value }
    if place == "Wharf", value.lowercased().hasPrefix("side") { return value }
    return "\(place) \(value)"
}

private func trackerVehicle(_ mode: String) -> String {
    switch mode.lowercased() {
    case "ferry": "Ferry"
    case "metro": "Metro"
    default: "Train"
    }
}

private func trackerSegments(_ legs: [Leg], projectionEnd: Millis) -> [TravelTrackerSegment] {
    let start = legs[0].effectiveDeparture
    let duration = max(1, projectionEnd - start)
    func fraction(_ time: Millis) -> Double { min(1, max(0, (time - start) / duration)) }
    var result: [TravelTrackerSegment] = []
    for (index, leg) in legs.enumerated() {
        result.append(TravelTrackerSegment(
            kind: .ride, legIndex: index, line: leg.line, mode: leg.mode,
            start: leg.effectiveDeparture, end: leg.effectiveArrival,
            startFraction: fraction(leg.effectiveDeparture), endFraction: fraction(leg.effectiveArrival)
        ))
        if index + 1 < legs.count {
            let next = legs[index + 1]
            result.append(TravelTrackerSegment(
                kind: .gap, legIndex: index, line: nil, mode: nil,
                start: leg.effectiveArrival, end: next.effectiveDeparture,
                startFraction: fraction(leg.effectiveArrival), endFraction: fraction(next.effectiveDeparture)
            ))
        }
    }
    return result
}

private func trackerProgress(_ legs: [Leg], now: Millis, projectionEnd: Millis) -> Double {
    let start = legs[0].effectiveDeparture
    let duration = max(1, projectionEnd - start)
    return min(1, max(0, (now - start) / duration))
}

private func trackerFreshness(_ focus: FocusedJourney, now: Millis) -> (TravelTrackerFreshness, Millis?) {
    let board = focus.board
    let retained = focus.journey.retained == true
    let eligible = board.source == "live" && !board.offline && !board.serverStale && !retained && board.generatedAt <= now
    let freshUntil = eligible && (0...90_000).contains(now - board.generatedAt) ? board.generatedAt + 90_000 : nil
    let freshness: TravelTrackerFreshness
    if board.offline { freshness = .offline }
    else if retained { freshness = .retained }
    else if board.source != "live" { freshness = .scheduled }
    else if board.serverStale || board.generatedAt > now || now - board.generatedAt > 90_000 { freshness = .stale }
    else { freshness = .live }
    return (freshness, freshUntil)
}

private func trackerProvenance(_ focus: FocusedJourney, freshness: TravelTrackerFreshness) -> String {
    switch freshness {
    case .live: "Live"
    case .offline:
        focus.board.source == "live"
            ? "Offline · Last updated \(trackerClock(focus.board.generatedAt))"
            : "Offline · timetable"
    case .retained: "Last known · Last updated \(trackerClock(focus.board.generatedAt))"
    case .stale: "Last updated \(trackerClock(focus.board.generatedAt))"
    case .scheduled: "Scheduled"
    }
}

private func trackerMinutes(_ from: Millis, _ to: Millis) -> Int {
    Int(to / 60_000) - Int(from / 60_000)
}

private func trackerCountdownText(_ minutes: Int) -> String {
    minutes > 99 ? "\(Int((Double(minutes) / 60).rounded())) hr." : "\(minutes) min."
}

private func trackerClock(_ time: Millis) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
    let parts = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: time / 1_000))
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
}
