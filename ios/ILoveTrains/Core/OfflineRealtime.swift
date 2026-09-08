import Foundation

struct RealtimeResult<Value> {
    var value: Value
    var observedAt: Millis?
    var matched: Bool
    var matchedLegIndices: Set<Int>

    init(value: Value, observedAt: Millis? = nil, matched: Bool = false, matchedLegIndices: Set<Int> = []) {
        self.value = value
        self.observedAt = observedAt
        self.matched = matched
        self.matchedLegIndices = matchedLegIndices
    }
}

struct StopAssignment: Equatable, Sendable {
    var platform: String?
    var stationId: String
}

struct OfflineRealtime {
    private struct StopUpdate: Decodable, Sendable {
        var stopId: String?
        var stopSequence: Int?
        var assignedStopId: String?
        var arrivalMs: Millis?
        var departureMs: Millis?
        var arrivalDelaySeconds: Int?
        var departureDelaySeconds: Int?
        var scheduleRelationship: String

        enum CodingKeys: String, CodingKey {
            case stopId, stopSequence, assignedStopId, arrivalMs, departureMs
            case arrivalDelaySeconds, departureDelaySeconds, scheduleRelationship
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            stopId = try values.decodeIfPresent(String.self, forKey: .stopId).flatMap { $0.isEmpty ? nil : $0 }
            stopSequence = try values.decodeIfPresent(Int.self, forKey: .stopSequence)
            assignedStopId = try values.decodeIfPresent(String.self, forKey: .assignedStopId).flatMap { $0.isEmpty ? nil : $0 }
            arrivalMs = try values.decodeIfPresent(FlexibleMillis.self, forKey: .arrivalMs)?.value
            departureMs = try values.decodeIfPresent(FlexibleMillis.self, forKey: .departureMs)?.value
            arrivalDelaySeconds = try values.decodeIfPresent(Int.self, forKey: .arrivalDelaySeconds)
            departureDelaySeconds = try values.decodeIfPresent(Int.self, forKey: .departureDelaySeconds)
            scheduleRelationship = try values.decodeIfPresent(String.self, forKey: .scheduleRelationship) ?? "scheduled"
            guard ["scheduled", "skipped", "noData", "unscheduled"].contains(scheduleRelationship) else {
                throw OfflineCoreError.invalidRealtime
            }
        }

        func matches(id: String, sequence: Int?) -> Bool {
            switch (stopId, stopSequence) {
            case let (.some(stopId), .some(stopSequence)):
                return stopId == id && stopSequence == sequence
            case let (.some(stopId), nil):
                return stopId == id
            case let (nil, .some(stopSequence)):
                return stopSequence == sequence
            case (nil, nil):
                return false
            }
        }
    }

    private struct TripUpdate: Decodable, Sendable {
        var tripId: String
        var serviceDate: String
        var status: String
        var delaySeconds: Int?
        var stopUpdates: [StopUpdate]

        enum CodingKeys: CodingKey { case tripId, serviceDate, status, delaySeconds, stopUpdates }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            tripId = try values.decode(String.self, forKey: .tripId)
            serviceDate = try values.decode(String.self, forKey: .serviceDate)
            status = try values.decode(String.self, forKey: .status)
            delaySeconds = try values.decodeIfPresent(Int.self, forKey: .delaySeconds)
            stopUpdates = try values.decode([StopUpdate].self, forKey: .stopUpdates)
            guard serviceDate.count == 8,
                  serviceDate.allSatisfy(\.isNumber),
                  ["scheduled", "added", "unscheduled", "cancelled", "replacement"].contains(status) else {
                throw OfflineCoreError.invalidRealtime
            }
        }
    }

    private struct WireSnapshot: Decodable, Sendable {
        var schemaVersion: Int
        var source: String
        var headerTimestamp: FlexibleMillis
        var expiresAt: FlexibleMillis
        var updates: [TripUpdate]
    }

    private struct Snapshot: Sendable {
        var source: String
        var headerTimestamp: Millis
        var expiresAt: Millis
        var updates: [String: TripUpdate]
    }

    private struct FetchResult: Sendable {
        var source: String
        var data: Data?
        var etag: String?
    }

    private let sourceNames = ["sydneytrains", "nswtrains", "metro", "ferries", "mff"]
    private var snapshots: [String: Snapshot] = [:]
    private var etags: [String: String] = [:]

    mutating func refresh(baseURL: String) async {
        let existingETags = etags
        let sources = sourceNames
        await withTaskGroup(of: FetchResult?.self) { group in
            for source in sources {
                group.addTask {
                    try? await Self.fetch(baseURL: baseURL, source: source, etag: existingETags[source])
                }
            }
            for await result in group {
                guard let result, let data = result.data,
                      (try? accept(data: data, expectedSource: result.source)) == true else { continue }
                if let etag = result.etag { etags[result.source] = etag }
            }
        }
    }

    func hasFreshData(now: Millis = Date().timeIntervalSince1970 * 1_000) -> Bool {
        snapshots.values.contains { $0.expiresAt > now }
    }

    func overlay(
        _ connections: [ScheduledConnection],
        now: Millis = Date().timeIntervalSince1970 * 1_000,
        assignment: (String, String) -> StopAssignment?
    ) -> [ScheduledConnection] {
        guard hasFreshData(now: now) else { return connections }
        var result = connections
        let grouped = Dictionary(grouping: connections.indices) { connections[$0].tripKey }
        for indices in grouped.values {
            guard let firstIndex = indices.first else { continue }
            let first = connections[firstIndex]
            guard let snapshot = freshSnapshot(first.source, now: now),
                  let update = snapshot.updates[Self.key(first.tripId, first.serviceDate)] else { continue }
            var carriedDelay = update.delaySeconds.map { Millis($0) * 1_000 }
            for index in indices.sorted(by: { connections[$0].fromSequence < connections[$1].fromSequence }) {
                let connection = connections[index]
                let from = update.stopUpdates.first { $0.matches(id: connection.fromStopId, sequence: connection.fromSequence) }
                let to = update.stopUpdates.first { $0.matches(id: connection.toStopId, sequence: connection.toSequence) }
                let departure = estimate(from, scheduled: connection.departure, departure: true, inheritedDelay: carriedDelay)
                if let from, from.scheduleRelationship != "noData", let departure {
                    carriedDelay = departure - connection.departure
                }
                let arrival = estimate(to, scheduled: connection.arrival, departure: false, inheritedDelay: carriedDelay)
                if let to, to.scheduleRelationship != "noData", let arrival {
                    carriedDelay = arrival - connection.arrival
                }
                let fromAssignment = from?.assignedStopId.flatMap { assignment(connection.source, $0) }
                let toAssignment = to?.assignedStopId.flatMap { assignment(connection.source, $0) }
                var value = connection
                value.estimatedDeparture = departure
                value.estimatedArrival = arrival
                if from?.scheduleRelationship == "skipped" { value.pickupType = 1 }
                if to?.scheduleRelationship == "skipped" { value.dropOffType = 1 }
                value.fromPlatform = fromAssignment?.platform ?? connection.fromPlatform
                value.toPlatform = toAssignment?.platform ?? connection.toPlatform
                value.cancelled = update.status == "cancelled"
                    || (update.status == "replacement" && (from == nil || to == nil))
                    || fromAssignment.map { $0.stationId != connection.fromStationId } == true
                    || toAssignment.map { $0.stationId != connection.toStationId } == true
                result[index] = value
            }
        }
        return result
    }

    func observation(_ journey: Journey, now: Millis = Date().timeIntervalSince1970 * 1_000) -> RealtimeResult<Journey> {
        var observedAt: Millis?
        var matched = false
        for identity in journey.legs.compactMap(\.identity) {
            guard let snapshot = freshSnapshot(identity.source, now: now),
                  snapshot.updates[Self.key(identity.tripId, identity.serviceDate)] != nil else { continue }
            matched = true
            observedAt = min(observedAt ?? .greatestFiniteMagnitude, snapshot.headerTimestamp)
        }
        return RealtimeResult(value: journey, observedAt: observedAt, matched: matched)
    }

    func overlay(
        _ journey: Journey,
        now: Millis = Date().timeIntervalSince1970 * 1_000,
        assignment: (String, String) -> StopAssignment?
    ) -> RealtimeResult<Journey> {
        var observedAt: Millis?
        var matched = false
        var matchedLegIndices = Set<Int>()
        let legs = journey.legs.enumerated().map { index, leg -> Leg in
            guard let identity = leg.identity,
                  let snapshot = freshSnapshot(identity.source, now: now),
                  let update = snapshot.updates[Self.key(identity.tripId, identity.serviceDate)] else {
                return leg.scheduledOnly()
            }
            matched = true
            matchedLegIndices.insert(index)
            observedAt = min(observedAt ?? .greatestFiniteMagnitude, snapshot.headerTimestamp)
            let from = update.stopUpdates.first { $0.matches(id: identity.fromStopId, sequence: identity.fromSequence) }
            let to = update.stopUpdates.first { $0.matches(id: identity.toStopId, sequence: identity.toSequence) }
            let delay = update.delaySeconds.map { Millis($0) * 1_000 }
            let fromAssignment = from?.assignedStopId.flatMap { assignment(identity.source, $0) }
            let toAssignment = to?.assignedStopId.flatMap { assignment(identity.source, $0) }
            var value = leg
            value.estimatedDeparture = from?.scheduleRelationship == "noData" ? nil
                : from?.departureMs
                    ?? from?.departureDelaySeconds.map { leg.departure + Millis($0) * 1_000 }
                    ?? delay.map { leg.departure + $0 }
            value.estimatedArrival = to?.scheduleRelationship == "noData" ? nil
                : to?.arrivalMs
                    ?? to?.arrivalDelaySeconds.map { leg.arrival + Millis($0) * 1_000 }
                    ?? delay.map { leg.arrival + $0 }
            value.fromPlatform = fromAssignment?.platform ?? leg.fromPlatform
            value.toPlatform = toAssignment?.platform ?? leg.toPlatform
            value.cancelled = update.status == "cancelled"
                || (update.status == "replacement" && (from == nil || to == nil))
                || fromAssignment.map { $0.stationId != leg.from.id } == true
                || toAssignment.map { $0.stationId != leg.to.id } == true
                || from?.scheduleRelationship == "skipped"
                || to?.scheduleRelationship == "skipped"
            return value
        }
        return RealtimeResult(
            value: Journey(legs: legs),
            observedAt: observedAt,
            matched: matched,
            matchedLegIndices: matchedLegIndices
        )
    }

    @discardableResult
    mutating func accept(
        json: String,
        expectedSource: String,
        now: Millis = Date().timeIntervalSince1970 * 1_000
    ) throws -> Bool {
        try accept(data: Data(json.utf8), expectedSource: expectedSource, now: now)
    }

    @discardableResult
    private mutating func accept(
        data: Data,
        expectedSource: String,
        now: Millis = Date().timeIntervalSince1970 * 1_000
    ) throws -> Bool {
        let wire = try JSONDecoder().decode(WireSnapshot.self, from: data)
        guard wire.schemaVersion == 1, wire.source == expectedSource else { throw OfflineCoreError.invalidRealtime }
        var updates: [String: TripUpdate] = [:]
        for update in wire.updates {
            let key = Self.key(update.tripId, update.serviceDate)
            guard updates[key] == nil else { throw OfflineCoreError.invalidRealtime }
            updates[key] = update
        }
        let headerTimestamp = wire.headerTimestamp.value
        let snapshot = Snapshot(
            source: wire.source,
            headerTimestamp: headerTimestamp,
            expiresAt: min(wire.expiresAt.value, headerTimestamp + Self.maximumSnapshotAge),
            updates: updates
        )
        guard snapshot.headerTimestamp <= now + Self.maximumFutureHeaderAge,
              snapshot.expiresAt > now else { return false }
        if let current = snapshots[expectedSource], current.headerTimestamp > snapshot.headerTimestamp { return false }
        snapshots[expectedSource] = snapshot
        return true
    }

    private func freshSnapshot(_ source: String, now: Millis) -> Snapshot? {
        snapshots[source].flatMap { $0.expiresAt > now ? $0 : nil }
    }

    private func estimate(
        _ stop: StopUpdate?,
        scheduled: Millis,
        departure: Bool,
        inheritedDelay: Millis?
    ) -> Millis? {
        if stop?.scheduleRelationship == "noData" { return nil }
        let exact = departure ? stop?.departureMs : stop?.arrivalMs
        let delay = departure
            ? stop?.departureDelaySeconds ?? stop?.arrivalDelaySeconds
            : stop?.arrivalDelaySeconds ?? stop?.departureDelaySeconds
        return exact ?? delay.map { scheduled + Millis($0) * 1_000 } ?? inheritedDelay.map { scheduled + $0 }
    }

    private static func key(_ tripId: String, _ serviceDate: String) -> String {
        "\(tripId)\0\(serviceDate)"
    }

    private static let maximumSnapshotAge: Millis = 90_000
    private static let maximumFutureHeaderAge: Millis = 5 * 60_000

    private static func fetch(baseURL: String, source: String, etag: String?) async throws -> FetchResult {
        guard var components = URLComponents(string: baseURL) else { throw OfflineCoreError.insecureURL }
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = (basePath.isEmpty ? "" : "/\(basePath)") + "/api/v1/realtime/\(source)"
        guard let url = components.url, secure(url) else { throw OfflineCoreError.insecureURL }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (temporary, response) = try await URLSession.shared.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse else { throw OfflineCoreError.invalidResponse }
        if http.statusCode == 304 { return FetchResult(source: source, data: nil, etag: nil) }
        let attributes = try FileManager.default.attributesOfItem(atPath: temporary.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 5_000_000 else {
            throw OfflineCoreError.invalidResponse
        }
        let data = try Data(contentsOf: temporary)
        guard http.statusCode == 200,
              http.value(forHTTPHeaderField: "X-Data-Stale")?.lowercased() != "true" else {
            throw OfflineCoreError.invalidResponse
        }
        return FetchResult(source: source, data: data, etag: http.value(forHTTPHeaderField: "ETag"))
    }
}

struct FlexibleMillis: Decodable, Sendable {
    var value: Millis

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            guard validTransitMillis(number) else { throw OfflineCoreError.invalidTimestamp }
            value = number
            return
        }
        let text = try container.decode(String.self)
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let basic = ISO8601DateFormatter()
        guard let date = fractional.date(from: text) ?? basic.date(from: text) else {
            throw OfflineCoreError.invalidTimestamp
        }
        let timestamp = date.timeIntervalSince1970 * 1_000
        guard validTransitMillis(timestamp) else { throw OfflineCoreError.invalidTimestamp }
        value = timestamp
    }
}

enum OfflineCoreError: Error, Equatable {
    case notInitialized
    case invalidManifest
    case invalidPackage
    case invalidDatabase
    case invalidRealtime
    case invalidTimestamp
    case invalidResponse
    case insecureURL
    case missingBundledResource(String)
    case sqlite(String)
    case updateInProgress
}

private func secure(_ url: URL) -> Bool {
    url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host))
}
