import Foundation

struct ScheduledConnection: Equatable, Sendable {
    var source: String
    var tripId: String
    var serviceDate: String
    var fromSequence: Int
    var toSequence: Int
    var fromStopId: String
    var toStopId: String
    var fromStationId: String
    var toStationId: String
    var fromStation: Station?
    var toStation: Station?
    var departure: Millis
    var arrival: Millis
    var pickupType: Int
    var dropOffType: Int
    var fromPlatform: String?
    var toPlatform: String?
    var scheduledFromPlatform: String?
    var scheduledToPlatform: String?
    var line: String
    var mode: String
    var headsign: String
    var estimatedDeparture: Millis?
    var estimatedArrival: Millis?
    var cancelled: Bool

    init(
        source: String,
        tripId: String,
        serviceDate: String,
        fromSequence: Int,
        toSequence: Int,
        fromStopId: String,
        toStopId: String,
        fromStationId: String,
        toStationId: String,
        fromStation: Station? = nil,
        toStation: Station? = nil,
        departure: Millis,
        arrival: Millis,
        pickupType: Int,
        dropOffType: Int,
        fromPlatform: String? = nil,
        toPlatform: String? = nil,
        line: String,
        mode: String,
        headsign: String,
        estimatedDeparture: Millis? = nil,
        estimatedArrival: Millis? = nil,
        cancelled: Bool = false
    ) {
        self.source = source
        self.tripId = tripId
        self.serviceDate = serviceDate
        self.fromSequence = fromSequence
        self.toSequence = toSequence
        self.fromStopId = fromStopId
        self.toStopId = toStopId
        self.fromStationId = fromStationId
        self.toStationId = toStationId
        self.fromStation = fromStation
        self.toStation = toStation
        self.departure = departure
        self.arrival = arrival
        self.pickupType = pickupType
        self.dropOffType = dropOffType
        self.fromPlatform = fromPlatform
        self.toPlatform = toPlatform
        scheduledFromPlatform = fromPlatform
        scheduledToPlatform = toPlatform
        self.line = line
        self.mode = mode
        self.headsign = headsign
        self.estimatedDeparture = estimatedDeparture
        self.estimatedArrival = estimatedArrival
        self.cancelled = cancelled
    }

    var tripKey: String { "\(source)\0\(tripId)\0\(serviceDate)" }
    var effectiveDeparture: Millis { estimatedDeparture ?? departure }
    var effectiveArrival: Millis { estimatedArrival ?? arrival }
}

struct OfflineRouter: Sendable {
    private final class PathNode {
        let connection: ScheduledConnection
        let previous: PathNode?

        init(connection: ScheduledConnection, previous: PathNode?) {
            self.connection = connection
            self.previous = previous
        }
    }

    private struct StateKey: Hashable {
        var transfers: Int
        var value: String
    }

    private struct TripStateKey: Hashable {
        var transfers: Int
        var sequence: Int
    }

    private struct Label {
        var arrival: Millis
        var firstDeparture: Millis
        var transfers: Int
        var node: PathNode
    }

    var minimumTransferMillis: Millis
    var crossModeTransferMillis: Millis
    var maxTransfers: Int
    var maxOriginServices: Int

    init(
        minimumTransferMillis: Millis = 5 * 60_000,
        crossModeTransferMillis: Millis = 8 * 60_000,
        maxTransfers: Int = 2,
        maxOriginServices: Int = 72
    ) {
        self.minimumTransferMillis = minimumTransferMillis
        self.crossModeTransferMillis = crossModeTransferMillis
        self.maxTransfers = maxTransfers
        self.maxOriginServices = maxOriginServices
    }

    func route(
        from: Station,
        to: Station,
        at: Millis,
        connections: [ScheduledConnection],
        limit: Int
    ) -> [Journey] {
        guard from.id != to.id, limit > 0 else { return [] }

        var seenTrips = Set<String>()
        var seeds: [Int] = []
        let denseOriginServices = max(0, maxOriginServices - 24)
        var lastReservedHour = -Double.greatestFiniteMagnitude
        for index in connections.indices {
            let connection = connections[index]
            guard !connection.cancelled,
                  connection.fromStationId == from.id,
                  connection.pickupType == 0,
                  connection.effectiveDeparture >= at,
                  seenTrips.insert(connection.tripKey).inserted else { continue }
            if seeds.count < denseOriginServices {
                seeds.append(index)
            } else {
                let hour = floor(connection.effectiveDeparture / 3_600_000)
                if hour != lastReservedHour {
                    seeds.append(index)
                    lastReservedHour = hour
                }
            }
            if seeds.count == maxOriginServices { break }
        }

        var candidates: [Label] = []
        for (seedPosition, index) in seeds.enumerated() {
            if let result = routeSeed(destination: to.id, startIndex: index, seed: connections[index], connections: connections) {
                candidates.append(result)
            }
            let eligible = filterConditionalLongWaits(candidates)
            if eligible.count < limit { continue }
            let nextDeparture = seedPosition + 1 < seeds.count
                ? connections[seeds[seedPosition + 1]].effectiveDeparture
                : .greatestFiniteMagnitude
            let unresolvedUntil = candidates.prefix(limit).flatMap(longWaitEnds).max()
            if unresolvedUntil == nil || nextDeparture >= unresolvedUntil! { break }
        }

        let ordered = filterConditionalLongWaits(candidates).sorted {
            if $0.firstDeparture != $1.firstDeparture { return $0.firstDeparture < $1.firstDeparture }
            if $0.arrival != $1.arrival { return $0.arrival < $1.arrival }
            return $0.transfers < $1.transfers
        }
        var keys = Set<String>()
        return ordered.compactMap(journey).filter { keys.insert($0.key).inserted }.prefix(limit).map { $0 }
    }

    private func routeSeed(
        destination: String,
        startIndex: Int,
        seed: ScheduledConnection,
        connections: [ScheduledConnection]
    ) -> Label? {
        guard seed.effectiveArrival >= seed.effectiveDeparture else { return nil }
        let seedLabel = Label(
            arrival: seed.effectiveArrival,
            firstDeparture: seed.effectiveDeparture,
            transfers: 0,
            node: PathNode(connection: seed, previous: nil)
        )
        var stationLabels: [String: [StateKey: Label]] = [:]
        var tripLabels: [String: [TripStateKey: Label]] = [
            seed.tripKey: [TripStateKey(transfers: 0, sequence: seed.toSequence): seedLabel]
        ]
        if seed.dropOffType == 0 {
            addStationLabel(&stationLabels, station: seed.toStationId, candidate: seedLabel)
        }
        var best = seed.toStationId == destination && seed.dropOffType == 0 ? seedLabel : nil

        guard startIndex + 1 < connections.count else { return best }
        for index in (startIndex + 1)..<connections.count {
            let connection = connections[index]
            if connection.cancelled || connection.effectiveArrival < connection.effectiveDeparture { continue }
            if let best, connection.effectiveDeparture > best.arrival { break }
            let onboard = tripLabels[connection.tripKey]
            let waiting = stationLabels[connection.fromStationId]
            if onboard == nil && waiting == nil { continue }

            var nextLabels: [(Label, Bool)] = []
            onboard?.values.forEach { label in
                if label.node.connection.toSequence == connection.fromSequence,
                   label.arrival <= connection.effectiveDeparture {
                    nextLabels.append((label, false))
                }
            }
            waiting?.values.forEach { label in
                let wait = connection.effectiveDeparture - label.arrival
                if label.node.connection.tripKey != connection.tripKey,
                   label.transfers < maxTransfers,
                   connection.pickupType == 0,
                   wait >= transferMillis(previous: label.node.connection, next: connection, stationId: connection.fromStationId),
                   !visited(label.node, stationId: connection.toStationId) {
                    nextLabels.append((label, true))
                }
            }

            for (prior, transferring) in nextLabels {
                let next = Label(
                    arrival: connection.effectiveArrival,
                    firstDeparture: prior.firstDeparture,
                    transfers: prior.transfers + (transferring ? 1 : 0),
                    node: PathNode(connection: connection, previous: prior.node)
                )
                let tripState = TripStateKey(transfers: next.transfers, sequence: connection.toSequence)
                if let arrival = tripLabels[connection.tripKey]?[tripState]?.arrival, arrival <= next.arrival { continue }
                tripLabels[connection.tripKey, default: [:]][tripState] = next
                if connection.dropOffType == 0 {
                    addStationLabel(&stationLabels, station: connection.toStationId, candidate: next)
                    if connection.toStationId == destination,
                       best == nil || next.arrival < best!.arrival ||
                        (next.arrival == best!.arrival && next.transfers < best!.transfers) {
                        best = next
                    }
                }
            }
        }
        return best
    }

    private func addStationLabel(
        _ labels: inout [String: [StateKey: Label]],
        station: String,
        candidate: Label
    ) {
        let key = StateKey(transfers: candidate.transfers, value: candidate.node.connection.mode)
        if let arrival = labels[station]?[key]?.arrival, arrival <= candidate.arrival { return }
        labels[station, default: [:]][key] = candidate
    }

    private func filterConditionalLongWaits(_ candidates: [Label]) -> [Label] {
        candidates.filter { candidate in
            !longWaitEnds(candidate).contains { waitEnd in
                candidates.contains { $0.firstDeparture > candidate.firstDeparture && $0.arrival < waitEnd }
            }
        }
    }

    private func longWaitEnds(_ label: Label) -> [Millis] {
        let connections = path(label.node)
        guard connections.count > 1 else { return [] }
        return zip(connections, connections.dropFirst()).compactMap { first, second in
            first.tripKey != second.tripKey && second.effectiveDeparture - first.effectiveArrival > 3_600_000
                ? second.effectiveDeparture
                : nil
        }
    }

    private func visited(_ node: PathNode, stationId: String) -> Bool {
        var current: PathNode? = node
        while let value = current {
            if value.connection.fromStationId == stationId || value.connection.toStationId == stationId { return true }
            current = value.previous
        }
        return false
    }

    private func transferMillis(previous: ScheduledConnection, next: ScheduledConnection, stationId: String) -> Millis {
        if previous.mode == next.mode { return minimumTransferMillis }
        if stationId == "200020" { return 10 * 60_000 }
        return crossModeTransferMillis
    }

    private func journey(_ label: Label) -> Journey? {
        var groups: [[ScheduledConnection]] = []
        for connection in path(label.node) {
            if groups.last?.last?.tripKey == connection.tripKey {
                groups[groups.count - 1].append(connection)
            } else {
                groups.append([connection])
            }
        }
        var legs: [Leg] = []
        for group in groups {
            guard let first = group.first,
                  let last = group.last,
                  let legFrom = first.fromStation,
                  let legTo = last.toStation else { return nil }
            legs.append(Leg(
                line: first.line,
                mode: first.mode,
                headsign: first.headsign,
                from: legFrom,
                to: legTo,
                departure: first.departure,
                arrival: last.arrival,
                estimatedDeparture: first.estimatedDeparture,
                estimatedArrival: last.estimatedArrival,
                fromPlatform: first.fromPlatform,
                toPlatform: last.toPlatform,
                scheduledFromPlatform: first.scheduledFromPlatform,
                scheduledToPlatform: last.scheduledToPlatform,
                capturesPlatformBaseline: true,
                cancelled: group.contains { $0.cancelled },
                identity: TripIdentity(
                    source: first.source,
                    tripId: first.tripId,
                    serviceDate: first.serviceDate,
                    fromStopId: first.fromStopId,
                    toStopId: last.toStopId,
                    fromSequence: first.fromSequence,
                    toSequence: last.toSequence
                )
            ))
        }
        return legs.isEmpty ? nil : Journey(legs: legs)
    }

    private func path(_ node: PathNode) -> [ScheduledConnection] {
        var reversed: [ScheduledConnection] = []
        var current: PathNode? = node
        while let value = current {
            reversed.append(value.connection)
            current = value.previous
        }
        return reversed.reversed()
    }
}
