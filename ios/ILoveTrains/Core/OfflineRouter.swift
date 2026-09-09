import Foundation

struct ScheduledConnection: Equatable, Sendable {
    let source: String
    let tripId: String
    let serviceDate: String
    let tripKey: String
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
        tripKey = "\(source)\0\(tripId)\0\(serviceDate)"
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

    private struct ServiceOrder {
        var line: String
        var departure: Millis
    }

    private struct Label {
        var arrival: Millis
        var firstDeparture: Millis
        var transfers: Int
        var node: PathNode
        var visitedStations: Set<String>
        var longWaitEnds: Set<Millis>
        var identity: [ServiceOrder]
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
        limit: Int,
        maxTransfers: Int? = nil,
        isCancelled: () -> Bool = { false }
    ) -> [Journey] {
        guard from.id != to.id, limit > 0,
              connections.contains(where: { $0.toStationId == to.id && $0.dropOffType == 0 && !$0.cancelled }) else { return [] }
        let bound = maxTransfers ?? self.maxTransfers
        let remainingTransfers = transferDistances(to: to.id, connections: connections, isCancelled: isCancelled)

        var seenTrips = Set<String>()
        var seeds: [Int] = []
        let denseOriginServices = max(0, maxOriginServices - 24)
        var lastReservedHour = -Double.greatestFiniteMagnitude
        for index in connections.indices {
            if index.isMultiple(of: 256), isCancelled() { return [] }
            let connection = connections[index]
            guard !connection.cancelled,
                  connection.effectiveArrival >= connection.effectiveDeparture,
                  connection.fromStationId == from.id,
                  connection.pickupType == 0,
                  connection.fromStation != nil, connection.toStation != nil,
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
            if let result = routeSeed(
                destination: to.id,
                startIndex: index,
                seed: connections[index],
                connections: connections,
                maxTransfers: bound,
                remainingTransfers: remainingTransfers,
                isCancelled: isCancelled
            ) {
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

    func recommendation(
        from: Station,
        to: Station,
        at: Millis,
        connections: [ScheduledConnection],
        maxTransfers: Int? = nil,
        isCancelled: () -> Bool = { false }
    ) -> Journey? {
        guard from.id != to.id,
              connections.contains(where: { $0.toStationId == to.id && $0.dropOffType == 0 && !$0.cancelled }) else { return nil }
        let bound = maxTransfers ?? self.maxTransfers
        let remainingTransfers = transferDistances(to: to.id, connections: connections, isCancelled: isCancelled)
        var seenTrips = Set<String>()
        var candidates: [Label] = []
        var bestCost = Millis.infinity
        for index in connections.indices {
            if index.isMultiple(of: 256), isCancelled() { return nil }
            let connection = connections[index]
            guard !connection.cancelled,
                  connection.effectiveArrival >= connection.effectiveDeparture,
                  connection.fromStationId == from.id,
                  connection.pickupType == 0,
                  connection.fromStation != nil, connection.toStation != nil,
                  connection.effectiveDeparture >= at,
                  seenTrips.insert(connection.tripKey).inserted else { continue }
            if connection.effectiveDeparture > bestCost { break }
            if isCancelled() { return nil }
            let results = routeSeedCandidates(
                destination: to.id,
                startIndex: index,
                seed: connection,
                connections: connections,
                maxTransfers: bound,
                stopAfterEarliest: false,
                remainingTransfers: remainingTransfers,
                searchEnd: bestCost,
                isCancelled: isCancelled
            )
            if isCancelled() { return nil }
            candidates.append(contentsOf: results)
            for result in results where result.longWaitEnds.isEmpty {
                bestCost = min(bestCost, objective(result, weighted: true))
            }
            if seenTrips.count == maxOriginServices { break }
        }
        var keys = Set<String>()
        let journeys = filterConditionalLongWaits(candidates).compactMap(journey).filter { keys.insert($0.key).inserted }
        return selectRecommendation(journeys, now: at, maxTransfers: bound)
    }

    private func routeSeed(
        destination: String,
        startIndex: Int,
        seed: ScheduledConnection,
        connections: [ScheduledConnection],
        maxTransfers: Int,
        remainingTransfers: [String: Int],
        isCancelled: () -> Bool
    ) -> Label? {
        routeSeedCandidates(
            destination: destination,
            startIndex: startIndex,
            seed: seed,
            connections: connections,
            maxTransfers: maxTransfers,
            stopAfterEarliest: true,
            remainingTransfers: remainingTransfers,
            isCancelled: isCancelled
        ).min { betterDestination($0, than: $1, weighted: false) }
    }

    private func routeSeedCandidates(
        destination: String,
        startIndex: Int,
        seed: ScheduledConnection,
        connections: [ScheduledConnection],
        maxTransfers: Int,
        stopAfterEarliest: Bool,
        remainingTransfers: [String: Int],
        searchEnd: Millis = .infinity,
        isCancelled: () -> Bool
    ) -> [Label] {
        guard seed.effectiveArrival >= seed.effectiveDeparture,
              let seedRemaining = remainingTransfers[seed.tripKey], seedRemaining <= maxTransfers else { return [] }
        let seedLabel = Label(
            arrival: seed.effectiveArrival,
            firstDeparture: seed.effectiveDeparture,
            transfers: 0,
            node: PathNode(connection: seed, previous: nil),
            visitedStations: [seed.fromStationId, seed.toStationId],
            longWaitEnds: [],
            identity: [ServiceOrder(line: seed.line, departure: seed.departure)]
        )
        var stationLabels: [String: [StateKey: [Label]]] = [:]
        var tripLabels: [String: [TripStateKey: [Label]]] = [
            seed.tripKey: [TripStateKey(transfers: 0, sequence: seed.toSequence): [seedLabel]]
        ]
        if seed.dropOffType == 0, maxTransfers > 0 {
            addStationLabel(&stationLabels, station: seed.toStationId, candidate: seedLabel)
        }
        var destinations = seed.toStationId == destination && seed.dropOffType == 0 ? [seedLabel] : []

        var scanEnd = searchEnd
        if !stopAfterEarliest {
            for result in destinations where result.longWaitEnds.isEmpty {
                scanEnd = min(scanEnd, objective(result, weighted: true))
            }
        }
        guard startIndex + 1 < connections.count else { return destinations }
        for index in (startIndex + 1)..<connections.count {
            if index.isMultiple(of: 256), isCancelled() { return [] }
            let connection = connections[index]
            if connection.effectiveDeparture > scanEnd { break }
            if connection.cancelled || connection.effectiveArrival < connection.effectiveDeparture { continue }
            if stopAfterEarliest,
               let best = destinations.min(by: { betterDestination($0, than: $1, weighted: false) }),
               connection.effectiveDeparture > best.arrival { break }
            guard let transfersNeeded = remainingTransfers[connection.tripKey] else { continue }
            let onboard = tripLabels[connection.tripKey]
            let waiting = stationLabels[connection.fromStationId]
            if onboard == nil && waiting == nil { continue }

            var nextLabels: [(Label, Bool)] = []
            onboard?.filter { $0.key.sequence == connection.fromSequence }.values.joined().forEach { label in
                if label.node.connection.toSequence == connection.fromSequence,
                   label.arrival <= connection.effectiveDeparture,
                   label.transfers + transfersNeeded <= maxTransfers {
                    nextLabels.append((label, false))
                }
            }
            waiting?.values.joined().forEach { label in
                let wait = connection.effectiveDeparture - label.arrival
                if label.node.connection.tripKey != connection.tripKey,
                   label.transfers + 1 + transfersNeeded <= maxTransfers,
                   connection.pickupType == 0,
                   wait >= transferMillis(previous: label.node.connection, next: connection, stationId: connection.fromStationId),
                   !label.visitedStations.contains(connection.toStationId) {
                    nextLabels.append((label, true))
                }
            }

            for (prior, transferring) in nextLabels {
                var waits = prior.longWaitEnds
                if transferring, connection.effectiveDeparture - prior.arrival > 3_600_000 {
                    waits.insert(connection.effectiveDeparture)
                }
                let next = Label(
                    arrival: connection.effectiveArrival,
                    firstDeparture: prior.firstDeparture,
                    transfers: prior.transfers + (transferring ? 1 : 0),
                    node: PathNode(connection: connection, previous: prior.node),
                    visitedStations: prior.visitedStations.union([connection.fromStationId, connection.toStationId]),
                    longWaitEnds: waits,
                    identity: transferring ? prior.identity + [ServiceOrder(line: connection.line, departure: connection.departure)] : prior.identity
                )
                let tripState = TripStateKey(transfers: next.transfers, sequence: connection.toSequence)
                let existingTripLabels = tripLabels[connection.tripKey]?[tripState] ?? []
                if existingTripLabels.contains(where: { dominates($0, next) }) { continue }
                tripLabels[connection.tripKey, default: [:]][tripState] =
                    existingTripLabels.filter { !dominates(next, $0) } + [next]
                if connection.dropOffType == 0 {
                    if next.transfers < maxTransfers {
                        addStationLabel(&stationLabels, station: connection.toStationId, candidate: next)
                    }
                    if connection.toStationId == destination {
                        destinations.append(next)
                        if !stopAfterEarliest, next.longWaitEnds.isEmpty {
                            scanEnd = min(scanEnd, objective(next, weighted: true))
                        }
                    }
                }
            }
        }
        return destinations
    }

    private func transferDistances(to destination: String, connections: [ScheduledConnection], isCancelled: () -> Bool) -> [String: Int] {
        var stations: [String: Set<String>] = [:]
        var trips: [String: Set<String>] = [:]
        var distances: [String: Int] = [:]
        var queue: [String] = []
        for (index, connection) in connections.enumerated() {
            if index.isMultiple(of: 256), isCancelled() { return [:] }
            if connection.cancelled { continue }
            let trip = connection.tripKey
            for station in [connection.fromStationId, connection.toStationId] {
                stations[station, default: []].insert(trip)
                trips[trip, default: []].insert(station)
            }
            if connection.toStationId == destination, connection.dropOffType == 0, distances[trip] == nil {
                distances[trip] = 0
                queue.append(trip)
            }
        }
        var visited = Set<String>()
        var index = 0
        while index < queue.count {
            if index.isMultiple(of: 256), isCancelled() { return [:] }
            let trip = queue[index]
            index += 1
            let distance = distances[trip]! + 1
            for station in trips[trip] ?? [] where visited.insert(station).inserted {
                for next in stations[station] ?? [] where distances[next] == nil {
                    distances[next] = distance
                    queue.append(next)
                }
            }
        }
        return distances
    }

    private func objective(_ label: Label, weighted: Bool) -> Millis {
        label.arrival + (weighted ? Millis(label.transfers) * transferPenaltyMillis : 0)
    }

    private func betterDestination(_ candidate: Label, than current: Label, weighted: Bool) -> Bool {
        let candidateObjective = objective(candidate, weighted: weighted)
        let currentObjective = objective(current, weighted: weighted)
        if candidateObjective != currentObjective { return candidateObjective < currentObjective }
        if candidate.transfers != current.transfers { return candidate.transfers < current.transfers }
        if candidate.arrival != current.arrival { return candidate.arrival < current.arrival }
        guard let left = journey(candidate), let right = journey(current) else { return false }
        return compareRecommendations(left, right) == .orderedAscending
    }

    private func addStationLabel(
        _ labels: inout [String: [StateKey: [Label]]],
        station: String,
        candidate: Label
    ) {
        let key = StateKey(transfers: candidate.transfers, value: candidate.node.connection.mode + "\0" + candidate.node.connection.tripKey + "\0" + String(candidate.node.connection.toSequence))
        let existing = labels[station]?[key] ?? []
        if existing.contains(where: { dominates($0, candidate) }) { return }
        labels[station, default: [:]][key] = existing.filter { !dominates(candidate, $0) } + [candidate]
    }

    private func dominates(_ existing: Label, _ candidate: Label) -> Bool {
        guard existing.arrival <= candidate.arrival,
              existing.visitedStations.isSubset(of: candidate.visitedStations),
              existing.longWaitEnds.isSubset(of: candidate.longWaitEnds) else { return false }
        if existing.arrival != candidate.arrival { return true }
        if existing.firstDeparture != candidate.firstDeparture { return existing.firstDeparture < candidate.firstDeparture }
        for (left, right) in zip(existing.identity, candidate.identity) {
            if left.line != right.line { return left.line.unicodeScalars.lexicographicallyPrecedes(right.line.unicodeScalars) }
            if left.departure != right.departure { return left.departure < right.departure }
        }
        return existing.identity.count <= candidate.identity.count
    }

    private func filterConditionalLongWaits(_ candidates: [Label]) -> [Label] {
        candidates.filter { candidate in
            !longWaitEnds(candidate).contains { waitEnd in
                candidates.contains { $0.firstDeparture > candidate.firstDeparture && $0.arrival < waitEnd }
            }
        }
    }

    private func longWaitEnds(_ label: Label) -> [Millis] {
        Array(label.longWaitEnds)
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
