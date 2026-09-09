import Foundation

struct SavedTrip: Codable, Equatable, Sendable {
    var id: String
    var from: Station
    var to: Station
    var createdAt: Millis
    var lastViewed: Millis
    var lines: [String]

    init(
        id: String,
        from: Station,
        to: Station,
        createdAt: Millis = 0,
        lastViewed: Millis = 0,
        lines: [String] = []
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.createdAt = createdAt
        self.lastViewed = lastViewed
        self.lines = lines
    }

    private enum CodingKeys: String, CodingKey { case id, from, to, createdAt, lastViewed, lines }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        from = try container.decode(Station.self, forKey: .from)
        to = try container.decode(Station.self, forKey: .to)
        createdAt = (try? container.decodeIfPresent(Millis.self, forKey: .createdAt)) ?? 0
        lastViewed = (try? container.decodeIfPresent(Millis.self, forKey: .lastViewed)) ?? 0
        lines = (try? container.decodeIfPresent([String].self, forKey: .lines)) ?? []
    }
}

struct FocusedJourney: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var journey: Journey
    var board: BoardData
    var pinned: Bool
    var alternatives: BoardData?
    var arrivalGuard: ArrivalGuard?

    init(
        tripId: String,
        reverse: Bool,
        journey: Journey,
        board: BoardData,
        pinned: Bool = true,
        alternatives: BoardData? = nil,
        arrivalGuard: ArrivalGuard? = nil
    ) {
        self.tripId = tripId
        self.reverse = reverse
        self.journey = journey
        self.board = board
        self.pinned = pinned
        self.alternatives = alternatives
        self.arrivalGuard = arrivalGuard
    }

    private enum CodingKeys: String, CodingKey { case tripId, reverse, journey, board, pinned, alternatives, arrivalGuard }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tripId = try container.decode(String.self, forKey: .tripId)
        reverse = (try? container.decodeIfPresent(Bool.self, forKey: .reverse)) ?? false
        journey = try container.decode(Journey.self, forKey: .journey)
        board = try container.decode(BoardData.self, forKey: .board)
        pinned = (try? container.decodeIfPresent(Bool.self, forKey: .pinned)) ?? true
        alternatives = try? container.decodeIfPresent(BoardData.self, forKey: .alternatives)
        arrivalGuard = try? container.decodeIfPresent(ArrivalGuard.self, forKey: .arrivalGuard)
    }
}

struct ViewEvent: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var at: Millis

    init(tripId: String, reverse: Bool, at: Millis) {
        self.tripId = tripId
        self.reverse = reverse
        self.at = at
    }
}

struct Ride: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var departure: Millis
    var arrival: Millis
    var from: Station?
    var to: Station?

    init(
        tripId: String,
        reverse: Bool,
        departure: Millis,
        arrival: Millis,
        from: Station? = nil,
        to: Station? = nil
    ) {
        self.tripId = tripId
        self.reverse = reverse
        self.departure = departure
        self.arrival = arrival
        self.from = from
        self.to = to
    }
}

struct HomeVote: Codable, Equatable, Sendable {
    var day: String
    var station: Station

    init(day: String, station: Station) {
        self.day = day
        self.station = station
    }
}

struct LastAnswer: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var at: Millis
    var stationId: String?
    var board: BoardData
    var journey: Journey

    init(tripId: String, reverse: Bool, at: Millis, stationId: String?, board: BoardData, journey: Journey) {
        self.tripId = tripId
        self.reverse = reverse
        self.at = at
        self.stationId = stationId
        self.board = board
        self.journey = journey
    }
}

struct UserData: Codable, Equatable, Sendable {
    var trips: [SavedTrip]
    var history: [ViewEvent]
    var rides: [Ride]
    var votes: [HomeVote]
    var lastTripId: String?
    var lastReverse: Bool
    var focus: FocusedJourney?
    var lastAnswer: LastAnswer?
    var appearance: Appearance
    var modes: Set<String>
    var transferLimit: TransferLimit
    var flags: [String: Bool]
    var useLocation: Bool
    var home: Station?
    var recentFrom: [Station]
    var recentTo: [Station]

    init(
        trips: [SavedTrip] = [],
        history: [ViewEvent] = [],
        rides: [Ride] = [],
        votes: [HomeVote] = [],
        lastTripId: String? = nil,
        lastReverse: Bool = false,
        focus: FocusedJourney? = nil,
        lastAnswer: LastAnswer? = nil,
        appearance: Appearance = .system,
        modes: Set<String> = allModes,
        transferLimit: TransferLimit = .two,
        flags: [String: Bool] = [:],
        useLocation: Bool = true,
        home: Station? = nil,
        recentFrom: [Station] = [],
        recentTo: [Station] = []
    ) {
        self.trips = trips
        self.history = history
        self.rides = rides
        self.votes = votes
        self.lastTripId = lastTripId
        self.lastReverse = lastReverse
        self.focus = focus
        self.lastAnswer = lastAnswer
        self.appearance = appearance
        self.modes = modes
        self.transferLimit = transferLimit
        self.flags = flags
        self.useLocation = useLocation
        self.home = home
        self.recentFrom = recentFrom
        self.recentTo = recentTo
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, trips, history, rides, votes, lastTripId, lastReverse, focus, lastAnswer
        case appearance, modes, transferLimit, flags, useLocation, home, recentFrom, recentTo
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let version = try container.decodeIfPresent(Int.self, forKey: .schemaVersion), version != 1 {
            throw DecodingError.dataCorruptedError(forKey: .schemaVersion, in: container, debugDescription: "Unsupported personal-data schema")
        }
        trips = Self.lossyArray(container, forKey: .trips)
        history = Self.lossyArray(container, forKey: .history).suffix(500).map { $0 }
        rides = Self.lossyArray(container, forKey: .rides).suffix(100).map { $0 }
        votes = Self.uniqueVotes(Self.lossyArray(container, forKey: .votes)).suffix(7).map { $0 }
        lastTripId = try? container.decodeIfPresent(String.self, forKey: .lastTripId)
        lastReverse = (try? container.decodeIfPresent(Bool.self, forKey: .lastReverse)) ?? false
        focus = try? container.decodeIfPresent(FocusedJourney.self, forKey: .focus)
        lastAnswer = try? container.decodeIfPresent(LastAnswer.self, forKey: .lastAnswer)
        appearance = (try? container.decodeIfPresent(Appearance.self, forKey: .appearance)) ?? .system
        if let values = try? container.decodeIfPresent([String].self, forKey: .modes) {
            modes = Set(values.filter { allModes.contains($0) })
        } else {
            modes = allModes
        }
        transferLimit = (try? container.decodeIfPresent(TransferLimit.self, forKey: .transferLimit)) ?? .two
        flags = Self.lossyFlags(container)
        useLocation = (try? container.decodeIfPresent(Bool.self, forKey: .useLocation)) ?? true
        home = try? container.decodeIfPresent(Station.self, forKey: .home)
        recentFrom = Self.recent(Self.lossyArray(container, forKey: .recentFrom))
        recentTo = Self.recent(Self.lossyArray(container, forKey: .recentTo))
        self = normalized()
    }

    func encode(to encoder: Encoder) throws {
        let value = normalized()
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(1, forKey: .schemaVersion)
        try container.encode(value.trips, forKey: .trips)
        try container.encode(value.history, forKey: .history)
        try container.encode(value.rides, forKey: .rides)
        try container.encode(value.votes, forKey: .votes)
        try container.encodeIfPresent(value.lastTripId, forKey: .lastTripId)
        try container.encode(value.lastReverse, forKey: .lastReverse)
        try container.encodeIfPresent(value.focus, forKey: .focus)
        try container.encodeIfPresent(value.lastAnswer, forKey: .lastAnswer)
        try container.encode(value.appearance, forKey: .appearance)
        try container.encode(value.modes, forKey: .modes)
        try container.encode(value.transferLimit, forKey: .transferLimit)
        try container.encode(value.flags, forKey: .flags)
        try container.encode(value.useLocation, forKey: .useLocation)
        try container.encodeIfPresent(value.home, forKey: .home)
        try container.encode(value.recentFrom, forKey: .recentFrom)
        try container.encode(value.recentTo, forKey: .recentTo)
    }

    func normalized() -> UserData {
        var value = self
        value.history = Array(history.suffix(500))
        value.rides = Array(rides.suffix(100))
        value.votes = Array(Self.uniqueVotes(votes).suffix(7))
        value.recentFrom = Self.recent(recentFrom)
        value.recentTo = Self.recent(recentTo)
        value.modes = modes.intersection(allModes)

        var seenTrips = Set<String>()
        value.trips = value.trips.filter { seenTrips.insert($0.id).inserted }
        let retained = Set(value.trips.enumerated().sorted { lhs, rhs in
            let lhsUse = value.tripUseTime(lhs.element)
            let rhsUse = value.tripUseTime(rhs.element)
            return lhsUse == rhsUse ? lhs.offset < rhs.offset : lhsUse > rhsUse
        }.prefix(10).map(\.element.id))
        value.trips = value.trips.filter { retained.contains($0.id) }
        let tripIDs = Set(value.trips.map(\.id))
        value.history.removeAll { !tripIDs.contains($0.tripId) }
        if let lastTripId = value.lastTripId, !tripIDs.contains(lastTripId) { value.lastTripId = nil }
        if let focus = value.focus, !tripIDs.contains(focus.tripId) { value.focus = nil }
        if let answer = value.lastAnswer, !tripIDs.contains(answer.tripId) { value.lastAnswer = nil }
        return value
    }

    var requestTransferLimit: Int? {
        guard flags[transferLimitFlagKey] == true else { return nil }
        return switch transferLimit {
        case .direct: 0
        case .two: 2
        case .any: nil
        }
    }
    var capped: Bool { requestTransferLimit != nil }
    var offlineTransferBound: Int {
        guard flags[transferLimitFlagKey] == true else { return 2 }
        return switch transferLimit {
        case .direct: 0
        case .two: 2
        case .any: 4
        }
    }
    func withinTransferLimit(_ journey: Journey) -> Bool {
        requestTransferLimit.map { journey.legs.count - 1 <= $0 } ?? true
    }
    func withinTransferLimit(_ board: BoardData) -> BoardData {
        var value = board
        value.journeys = board.journeys.filter { withinTransferLimit($0) && journeyAllowed($0, modes: modes) }
        return value
    }

    func tripUseTime(_ trip: SavedTrip) -> Millis {
        history.lazy.filter { $0.tripId == trip.id }.map(\.at).max() ?? trip.createdAt
    }

    func leastRecentlyUsedTrip() -> SavedTrip? {
        trips.enumerated().min { lhs, rhs in
            let lhsUse = tripUseTime(lhs.element)
            let rhsUse = tripUseTime(rhs.element)
            return lhsUse == rhsUse ? lhs.offset < rhs.offset : lhsUse < rhsUse
        }?.element
    }

    private static func lossyFlags(_ container: KeyedDecodingContainer<CodingKeys>) -> [String: Bool] {
        guard let raw = try? container.decodeIfPresent([String: JSONValue].self, forKey: .flags) else { return [:] }
        return raw.compactMapValues { value in
            guard case let .bool(flag) = value else { return nil }
            return flag
        }
    }

    private static func lossyArray<T: Decodable>(
        _ container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> [T] {
        guard let raw = try? container.decodeIfPresent([JSONValue].self, forKey: key) else { return [] }
        return raw.compactMap { value in
            guard let data = try? JSONEncoder().encode(value) else { return nil }
            return try? JSONDecoder().decode(T.self, from: data)
        }
    }

    private static func uniqueVotes(_ votes: [HomeVote]) -> [HomeVote] {
        var days = Set<String>()
        return votes.filter { days.insert($0.day).inserted }
    }

    private static func recent(_ stations: [Station]) -> [Station] {
        var ids = Set<String>()
        return stations.filter { ids.insert($0.id).inserted }.prefix(3).map { $0 }
    }
}

actor DeviceStore {
    private let directory: URL
    private let stateURL: URL
    private let backupURL: URL
    private let cacheDirectory: URL
    private let bundle: Bundle
    private let fileManager = FileManager.default

    init(directory: URL? = nil, bundle: Bundle = .main) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ILoveTrains", isDirectory: true)
        self.directory = base
        stateURL = base.appendingPathComponent("personal-v1.json")
        backupURL = base.appendingPathComponent("personal-v1.backup.json")
        cacheDirectory = base.appendingPathComponent("boards", isDirectory: true)
        self.bundle = bundle
    }

    func load() async -> UserData {
        try? createDirectories()
        for url in [stateURL, backupURL] {
            guard let data = try? Data(contentsOf: url),
                  let value = try? decoder.decode(UserData.self, from: data) else { continue }
            return value.normalized()
        }
        return UserData()
    }

    func save(_ data: UserData) async throws {
        try createDirectories()
        let payload = try encoder.encode(data.normalized())
        if (try? Data(contentsOf: stateURL)) == payload { return }
        if fileManager.fileExists(atPath: stateURL.path) {
            try? fileManager.removeItem(at: backupURL)
            try fileManager.copyItem(at: stateURL, to: backupURL)
            protect(backupURL)
        }
        try write(payload, to: stateURL)
    }

    func stations() async throws -> [Station] {
        guard let url = bundle.url(forResource: "stations", withExtension: "json") else {
            throw DeviceStoreError.missingStations
        }
        let values = try decoder.decode([JSONValue].self, from: Data(contentsOf: url))
        return values.compactMap { value in
            guard let data = try? JSONEncoder().encode(value),
                  let entry = try? decoder.decode(StationIndexEntry.self, from: data),
                  !entry.id.isEmpty, !entry.name.isEmpty else { return nil }
            let modes = entry.modes.map { Set($0.filter { allModes.contains($0) }) } ?? allModes
            return Station(
                id: entry.id,
                name: entry.name,
                lat: entry.location?.lat ?? entry.lat ?? 0,
                lon: entry.location?.lon ?? entry.lon ?? 0,
                modes: modes
            )
        }
    }

    func cached(from: Station, to: Station, modes: Set<String>) async -> BoardData? {
        let url = cacheURL(from: from, to: to, modes: modes)
        guard let data = try? Data(contentsOf: url),
              let entry = try? decoder.decode(CacheEntry.self, from: data),
              entry.board.from.id == from.id,
              entry.board.to.id == to.id,
              entry.modes == canonicalModes(modes) else { return nil }
        return entry.board
    }

    func cache(_ board: BoardData, modes: Set<String>) async throws {
        try createDirectories()
        let entry = CacheEntry(board: board, modes: canonicalModes(modes))
        try write(encoder.encode(entry), to: cacheURL(from: board.from, to: board.to, modes: modes))
        try trimCache()
    }

    func purgeCache(for trip: SavedTrip) async throws {
        for entry in cacheEntries() where
            (entry.board.from.id == trip.from.id && entry.board.to.id == trip.to.id)
                || (entry.board.from.id == trip.to.id && entry.board.to.id == trip.from.id) {
            try fileManager.removeItem(at: entry.url)
        }
    }

    func removeCache(_ trip: SavedTrip) async throws {
        try await purgeCache(for: trip)
    }

    private func createDirectories() throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        protect(directory)
        protect(cacheDirectory)
    }

    private func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        protect(url)
    }

    private func protect(_ source: URL) {
        var url = source
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        #if os(iOS) || os(tvOS) || os(watchOS)
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }

    private func cacheURL(from: Station, to: Station, modes: Set<String>) -> URL {
        let raw = "\(from.id)\u{1F}\(to.id)\u{1F}\(canonicalModes(modes).sorted().joined(separator: ","))"
        let name = Data(raw.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return cacheDirectory.appendingPathComponent(name).appendingPathExtension("json")
    }

    private func canonicalModes(_ modes: Set<String>) -> Set<String> {
        modes.intersection(allModes)
    }

    private func cacheEntries() -> [CacheFile] {
        guard let urls = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        return urls.compactMap { url in
            guard let data = try? Data(contentsOf: url),
                  let entry = try? decoder.decode(CacheEntry.self, from: data) else { return nil }
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return CacheFile(url: url, board: entry.board, modes: entry.modes, modifiedAt: date)
        }
    }

    private func trimCache() throws {
        var entries = cacheEntries()
        let pairs = Dictionary(grouping: entries, by: { "\($0.board.from.id)\u{1F}\($0.board.to.id)" })
        let newestPairs = pairs.values.sorted { lhs, rhs in
            (lhs.map(\.modifiedAt).max() ?? .distantPast) > (rhs.map(\.modifiedAt).max() ?? .distantPast)
        }
        for pair in newestPairs.dropFirst(10) {
            for entry in pair { try fileManager.removeItem(at: entry.url) }
            let removed = Set(pair.map(\.url))
            entries.removeAll { removed.contains($0.url) }
        }
        for pair in Dictionary(grouping: entries, by: { "\($0.board.from.id)\u{1F}\($0.board.to.id)" }).values {
            let extras = Array(pair.sorted(by: { $0.modifiedAt > $1.modifiedAt }).dropFirst(8))
            for entry in extras {
                try fileManager.removeItem(at: entry.url)
            }
            let removed = Set(extras.map(\.url))
            entries.removeAll { removed.contains($0.url) }
        }
        for entry in entries.sorted(by: { $0.modifiedAt > $1.modifiedAt }).dropFirst(64) {
            try fileManager.removeItem(at: entry.url)
        }
    }

    private var encoder: JSONEncoder {
        let value = JSONEncoder()
        value.outputFormatting = [.sortedKeys]
        return value
    }

    private var decoder: JSONDecoder { JSONDecoder() }
}

enum DeviceStoreError: Error {
    case missingStations
}

private struct CacheEntry: Codable {
    var board: BoardData
    var modes: Set<String>
}

private struct CacheFile {
    var url: URL
    var board: BoardData
    var modes: Set<String>
    var modifiedAt: Date
}

private struct StationIndexEntry: Decodable {
    struct Location: Decodable {
        var lat: Double
        var lon: Double
    }

    var id: String
    var name: String
    var modes: [String]?
    var location: Location?
    var lat: Double?
    var lon: Double?
}

private indirect enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }
}
