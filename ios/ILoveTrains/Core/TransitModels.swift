import Foundation

typealias Millis = Double

let allModes: Set<String> = ["train", "metro", "ferry"]

struct Station: Codable, Equatable, Sendable, Identifiable, Hashable {
    var id: String
    var name: String
    var lat: Double
    var lon: Double
    var modes: Set<String>

    init(
        id: String,
        name: String,
        lat: Double = 0,
        lon: Double = 0,
        modes: Set<String> = allModes
    ) {
        self.id = id
        self.name = name
        self.lat = lat
        self.lon = lon
        self.modes = modes
    }

    var shortName: String {
        name.removingSuffix(" Station").removingSuffix(" Railway Station")
    }
}

struct TripIdentity: Codable, Equatable, Sendable, Hashable {
    var source: String
    var tripId: String
    var serviceDate: String
    var fromStopId: String
    var toStopId: String
    var fromSequence: Int?
    var toSequence: Int?

    init(
        source: String,
        tripId: String,
        serviceDate: String,
        fromStopId: String,
        toStopId: String,
        fromSequence: Int? = nil,
        toSequence: Int? = nil
    ) {
        self.source = source
        self.tripId = tripId
        self.serviceDate = serviceDate
        self.fromStopId = fromStopId
        self.toStopId = toStopId
        self.fromSequence = fromSequence
        self.toSequence = toSequence
    }
}

struct Leg: Codable, Equatable, Sendable, Hashable {
    var line: String
    var mode: String
    var headsign: String
    var from: Station
    var to: Station
    var departure: Millis
    var arrival: Millis
    var estimatedDeparture: Millis?
    var estimatedArrival: Millis?
    var fromPlatform: String?
    var toPlatform: String?
    var scheduledFromPlatform: String?
    var scheduledToPlatform: String?
    var platformBaselineCaptured: Bool?
    var cancelled: Bool
    var identity: TripIdentity?

    init(
        line: String,
        mode: String,
        headsign: String,
        from: Station,
        to: Station,
        departure: Millis,
        arrival: Millis,
        estimatedDeparture: Millis? = nil,
        estimatedArrival: Millis? = nil,
        fromPlatform: String? = nil,
        toPlatform: String? = nil,
        scheduledFromPlatform: String? = nil,
        scheduledToPlatform: String? = nil,
        capturesPlatformBaseline: Bool = false,
        cancelled: Bool = false,
        identity: TripIdentity? = nil
    ) {
        self.line = line
        self.mode = mode
        self.headsign = headsign
        self.from = from
        self.to = to
        self.departure = departure
        self.arrival = arrival
        self.estimatedDeparture = estimatedDeparture
        self.estimatedArrival = estimatedArrival
        self.fromPlatform = fromPlatform
        self.toPlatform = toPlatform
        self.scheduledFromPlatform = capturesPlatformBaseline ? scheduledFromPlatform : fromPlatform
        self.scheduledToPlatform = capturesPlatformBaseline ? scheduledToPlatform : toPlatform
        platformBaselineCaptured = true
        self.cancelled = cancelled
        self.identity = identity
    }

    var effectiveDeparture: Millis { estimatedDeparture ?? departure }
    var effectiveArrival: Millis { estimatedArrival ?? arrival }

    func scheduledOnly() -> Leg {
        var copy = self
        copy.estimatedDeparture = nil
        copy.estimatedArrival = nil
        if platformBaselineCaptured == true {
            copy.fromPlatform = scheduledFromPlatform
            copy.toPlatform = scheduledToPlatform
        }
        copy.cancelled = false
        return copy
    }
}

struct Journey: Codable, Equatable, Sendable, Identifiable, Hashable {
    var legs: [Leg]
    var retained: Bool?

    init(legs: [Leg] = [], retained: Bool? = nil) {
        self.legs = legs
        self.retained = retained
    }

    var key: String {
        legs.map { "\($0.line):\(Self.keyMillis($0.departure))" }.joined(separator: "|")
    }

    var id: String { key }
    var departure: Millis { legs.first?.departure ?? 0 }
    var arrival: Millis { legs.last?.arrival ?? 0 }
    var effectiveDeparture: Millis { legs.first?.effectiveDeparture ?? 0 }
    var effectiveArrival: Millis { legs.last?.effectiveArrival ?? 0 }
    var cancelled: Bool { legs.contains { $0.cancelled } }
    var realtime: Bool { legs.contains { $0.estimatedDeparture != nil || $0.estimatedArrival != nil } }
    var mode: String { legs.first?.mode ?? "" }

    func scheduledOnly() -> Journey {
        Journey(legs: legs.map { $0.scheduledOnly() }, retained: retained)
    }

    private static func keyMillis(_ value: Millis) -> String {
        guard value.isFinite, abs(value) < 9_000_000_000_000_000_000 else { return value.description }
        return String(Int64(value.rounded()))
    }
}

struct BoardData: Codable, Equatable, Sendable {
    var from: Station
    var to: Station
    var journeys: [Journey]
    var generatedAt: Millis
    var source: String
    var offline: Bool
    var serverStale: Bool
    var coverage: String
    var error: String?
    var homeJourneyKey: String?

    init(
        from: Station,
        to: Station,
        journeys: [Journey] = [],
        generatedAt: Millis,
        source: String = "schedule",
        offline: Bool = false,
        serverStale: Bool = false,
        coverage: String = "",
        error: String? = nil,
        homeJourneyKey: String? = nil
    ) {
        self.from = from
        self.to = to
        self.journeys = journeys
        self.generatedAt = generatedAt
        self.source = source
        self.offline = offline
        self.serverStale = serverStale
        self.coverage = coverage
        self.error = error
        self.homeJourneyKey = homeJourneyKey
    }

    func isLive(_ now: Double) -> Bool {
        source == "live" && !offline && !serverStale && (0...90_000).contains(now - generatedAt)
    }

    func scheduledOnly() -> BoardData {
        var copy = self
        copy.journeys = journeys.map { $0.scheduledOnly() }
        copy.source = "schedule"
        copy.offline = true
        copy.serverStale = false
        return copy
    }
}

private let pastBoardRetention: Millis = 86_400_000

extension FocusedJourney {
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

func retainedOfflineBoard(_ board: BoardData) -> BoardData {
    var copy = board
    copy.offline = true
    copy.journeys = copy.journeys.map { journey in
        var retained = journey
        retained.retained = true
        return retained
    }
    return copy
}

/// An offline open keeps the answer the rider last saw without inferring a ride.
func retainedHomeJourney(_ board: BoardData?, now: Millis) -> Journey? {
    guard let board, board.offline, let key = board.homeJourneyKey else { return nil }
    return board.journeys.first { $0.key == key && now <= $0.effectiveArrival + 1_800_000 }
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
    merged.homeJourneyKey = nextHomeJourney(merged, now: now)?.key
    return merged
}

struct FocusUpdate: Equatable, Sendable {
    var journey: Journey
    var observedAt: Millis?
    var live: Bool

    init(journey: Journey, observedAt: Millis? = nil, live: Bool = false) {
        self.journey = journey
        self.observedAt = observedAt
        self.live = live
    }
}

private extension String {
    func removingSuffix(_ suffix: String) -> String {
        hasSuffix(suffix) ? String(dropLast(suffix.count)) : self
    }
}
