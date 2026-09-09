package com.ilovetrains.app

import kotlinx.coroutines.CancellationException

internal data class ScheduledConnection(
    val source: String,
    val tripId: String,
    val serviceDate: String,
    val fromSequence: Int,
    val toSequence: Int,
    val fromStopId: String,
    val toStopId: String,
    val fromStationId: String,
    val toStationId: String,
    val fromStation: Station?,
    val toStation: Station?,
    val departure: Long,
    val arrival: Long,
    val pickupType: Int,
    val dropOffType: Int,
    val fromPlatform: String?,
    val toPlatform: String?,
    val line: String,
    val mode: String,
    val headsign: String,
    val estimatedDeparture: Long? = null,
    val estimatedArrival: Long? = null,
    val cancelled: Boolean = false,
) {
    val tripKey = "$source\u0000$tripId\u0000$serviceDate"
    val effectiveDeparture get() = estimatedDeparture ?: departure
    val effectiveArrival get() = estimatedArrival ?: arrival
}

internal class OfflineRouter(
    private val minimumTransferMillis: Long = 5 * 60_000L,
    private val crossModeTransferMillis: Long = 8 * 60_000L,
    private val maxTransfers: Int = 2,
    private val maxOriginServices: Int = 72,
) {
    private data class PathNode(val connection: ScheduledConnection, val previous: PathNode?)

    private data class Label(
        val arrival: Long,
        val firstDeparture: Long,
        val transfers: Int,
        val node: PathNode,
        val visited: StationSet,
        val tripCode: Int,
        val longWaits: Set<Long>,
        val identity: List<Pair<String, Long>>,
    )

    private data class Feasibility(val transfers: Int, val mode: String, val trip: Int, val sequence: Int)
    private data class TripFeasibility(val transfers: Int, val sequence: Int)

    private class StationSet(private val words: LongArray) {
        fun contains(station: Int) = words[station ushr 6] and (1L shl (station and 63)) != 0L
        fun adding(station: Int): StationSet {
            if (contains(station)) return this
            val next = words.copyOf()
            next[station ushr 6] = next[station ushr 6] or (1L shl (station and 63))
            return StationSet(next)
        }
        fun isSubsetOf(other: StationSet): Boolean {
            for (index in words.indices) if (words[index] and other.words[index].inv() != 0L) return false
            return true
        }
    }

    private data class RoutingIndex(
        val trips: IntArray, val fromStations: IntArray, val toStations: IntArray,
        val remainingTransfers: IntArray, val stationCount: Int,
    )

    fun route(from: Station, to: Station, at: Long, connections: List<ScheduledConnection>, limit: Int, maxTransfers: Int = this.maxTransfers, cancelled: () -> Boolean = { false }): List<Journey> {
        if (from.id == to.id || limit <= 0) return emptyList()
        if (connections.none { it.toStationId == to.id && it.dropOffType == 0 && !it.cancelled && it.effectiveArrival >= at }) return emptyList()
        val routing = routingIndex(to.id, connections, cancelled)
        val seenTrips = HashSet<String>(maxOriginServices)
        val seeds = ArrayList<Int>(maxOriginServices)
        val denseOriginServices = maxOriginServices - 24
        var lastReservedHour = Long.MIN_VALUE
        for (index in connections.indices) {
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            val connection = connections[index]
            if (!connection.cancelled && connection.fromStationId == from.id && connection.pickupType == 0 &&
                connection.effectiveDeparture >= at && seenTrips.add(connection.tripKey)
            ) {
                if (seeds.size < denseOriginServices) {
                    seeds += index
                } else {
                    val hour = connection.effectiveDeparture / (60 * 60_000L)
                    if (hour != lastReservedHour) {
                        seeds += index
                        lastReservedHour = hour
                    }
                }
                if (seeds.size == maxOriginServices) break
            }
        }
        val candidates = ArrayList<Label>(seeds.size)
        for (seedPosition in seeds.indices) {
            val index = seeds[seedPosition]
            routeSeed(to.id, index, connections[index], connections, maxTransfers, weighted = false, cancelled = cancelled, routing = routing)
                .minWithOrNull(compareBy<Label> { it.arrival }.thenBy { it.transfers })?.let(candidates::add)
            val eligible = filterConditionalLongWaits(candidates)
            if (eligible.size < limit) continue
            val nextDeparture = seeds.getOrNull(seedPosition + 1)?.let { connections[it].effectiveDeparture } ?: Long.MAX_VALUE
            val unresolvedUntil = candidates.take(limit).flatMap(::longWaitEnds).maxOrNull()
            if (unresolvedUntil == null || nextDeparture >= unresolvedUntil) break
        }
        return filterConditionalLongWaits(candidates)
            .sortedWith(compareBy<Label> { it.firstDeparture }.thenBy { it.arrival }.thenBy { it.transfers })
            .mapNotNull(::journey)
            .distinctBy { it.key }
            .take(limit)
    }

    fun recommend(from: Station, to: Station, at: Long, connections: List<ScheduledConnection>, maxTransfers: Int = this.maxTransfers,
                  cancelled: () -> Boolean = { false }): Journey? {
        if (from.id == to.id) return null
        if (connections.none { it.toStationId == to.id && it.dropOffType == 0 && !it.cancelled && it.effectiveArrival >= at }) return null
        val routing = routingIndex(to.id, connections, cancelled)
        val seenTrips = HashSet<String>(maxOriginServices)
        val candidates = ArrayList<Label>(maxOriginServices)
        var bestUnconditionalCost: Long? = null
        for (index in connections.indices) {
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            val connection = connections[index]
            if (bestUnconditionalCost?.let { connection.effectiveDeparture > it } == true) break
            if (connection.cancelled || connection.fromStationId != from.id || connection.pickupType != 0 ||
                connection.effectiveDeparture < at || connection.effectiveArrival < connection.effectiveDeparture ||
                connection.fromStation == null || connection.toStation == null || connection.tripKey in seenTrips) continue
            seenTrips += connection.tripKey
            val found = routeSeed(to.id, index, connection, connections, maxTransfers, weighted = true, cancelled, bestUnconditionalCost, routing)
            candidates += found
            found.filter { it.longWaits.isEmpty() }.mapNotNull { journey(it)?.let(::recommendationCost) }.minOrNull()?.let {
                bestUnconditionalCost = minOf(bestUnconditionalCost ?: Long.MAX_VALUE, it)
            }
            if (seenTrips.size == maxOriginServices) break
        }
        if (cancelled()) throw CancellationException()
        return filterConditionalLongWaits(candidates).mapNotNull(::journey).distinctBy(Journey::key)
            .minWithOrNull(::compareRecommendations)
    }

    private fun routeSeed(destination: String, startIndex: Int, seed: ScheduledConnection, connections: List<ScheduledConnection>, maxTransfers: Int,
                          weighted: Boolean, cancelled: () -> Boolean = { false }, latestDeparture: Long? = null, routing: RoutingIndex): List<Label> {
        if (seed.effectiveArrival < seed.effectiveDeparture || routing.remainingTransfers[startIndex] > maxTransfers) return emptyList()
        val seedLabel = Label(seed.effectiveArrival, seed.effectiveDeparture, 0, PathNode(seed, null),
            StationSet(LongArray((routing.stationCount + 63) / 64)).adding(routing.fromStations[startIndex])
                .adding(routing.toStations[startIndex]), routing.trips[startIndex], emptySet(), listOf(seed.line to seed.departure))
        val stationLabels = mutableMapOf<Int, MutableMap<Feasibility, MutableList<Label>>>()
        val tripLabels = mutableMapOf<Int, MutableMap<TripFeasibility, MutableList<Label>>>()
        tripLabels.getOrPut(routing.trips[startIndex]) { mutableMapOf() }[
            TripFeasibility(0, seed.toSequence)] = mutableListOf(seedLabel)
        if (seed.dropOffType == 0 && maxTransfers > 0) addStationLabel(stationLabels, routing.toStations[startIndex], seedLabel)
        val destinations = mutableListOf<Label>()
        var cutoff = latestDeparture
        fun recordDestination(label: Label) {
            destinations += label
            if (weighted && label.longWaits.isEmpty()) journey(label)?.let(::recommendationCost)?.let {
                cutoff = minOf(cutoff ?: Long.MAX_VALUE, it)
            }
        }
        if (seed.toStationId == destination && seed.dropOffType == 0) recordDestination(seedLabel)
        for (index in startIndex + 1 until connections.size) {
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            val connection = connections[index]
            if (weighted && cutoff?.let { connection.effectiveDeparture > it } == true) break
            if (connection.cancelled || connection.effectiveArrival < connection.effectiveDeparture) continue
            if (!weighted && destinations.isNotEmpty() && connection.effectiveDeparture > destinations.minOf(Label::arrival)) break
            val transfersNeeded = routing.remainingTransfers[index]
            if (transfersNeeded > maxTransfers) continue
            val tripCode = routing.trips[index]
            val toStation = routing.toStations[index]
            val onboard = tripLabels[tripCode]
            val waiting = stationLabels[routing.fromStations[index]]
            if (onboard == null && waiting == null) continue
            val nextLabels = ArrayList<Pair<Label, Boolean>>(8)
            if (onboard != null) for (transfers in 0..maxTransfers) {
                onboard[TripFeasibility(transfers, connection.fromSequence)]?.forEach { label ->
                    if (label.arrival <= connection.effectiveDeparture && label.transfers + transfersNeeded <= maxTransfers) {
                        nextLabels += label to false
                    }
                }
            }
            waiting?.values?.forEach { bucket -> bucket.forEach { label ->
                val wait = connection.effectiveDeparture - label.arrival
                if (label.tripCode != tripCode && label.transfers + 1 + transfersNeeded <= maxTransfers && connection.pickupType == 0 &&
                    wait >= transferMillis(label.node.connection, connection, connection.fromStationId) &&
                    !label.visited.contains(toStation)
                ) nextLabels += label to true
            } }
            for ((prior, transferring) in nextLabels) {
                val next = Label(
                    connection.effectiveArrival,
                    prior.firstDeparture,
                    prior.transfers + if (transferring) 1 else 0,
                    PathNode(connection, prior.node),
                    prior.visited.adding(toStation),
                    tripCode,
                    if (transferring && connection.effectiveDeparture - prior.arrival > 60 * 60_000L)
                        prior.longWaits + connection.effectiveDeparture else prior.longWaits,
                    if (transferring) prior.identity + (connection.line to connection.departure) else prior.identity,
                )
                val tripStates = tripLabels.getOrPut(tripCode) { mutableMapOf() }
                val tripState = TripFeasibility(next.transfers, connection.toSequence)
                val priorTripState = tripStates.getOrPut(tripState) { mutableListOf() }
                if (priorTripState.any { dominates(it, next) }) continue
                priorTripState.removeAll { dominates(next, it) }
                priorTripState += next
                if (connection.dropOffType == 0) {
                    if (next.transfers < maxTransfers) addStationLabel(stationLabels, toStation, next)
                    if (connection.toStationId == destination) recordDestination(next)
                }
            }
        }
        return destinations
    }

    private fun addStationLabel(labels: MutableMap<Int, MutableMap<Feasibility, MutableList<Label>>>, station: Int, candidate: Label) {
        val key = Feasibility(candidate.transfers, candidate.node.connection.mode, candidate.tripCode,
            candidate.node.connection.toSequence)
        val existing = labels.getOrPut(station) { mutableMapOf() }.getOrPut(key) { mutableListOf() }
        if (existing.any { dominates(it, candidate) }) return
        existing.removeAll { dominates(candidate, it) }
        existing += candidate
    }

    private fun dominates(existing: Label, candidate: Label): Boolean {
        if (existing.arrival > candidate.arrival || !existing.visited.isSubsetOf(candidate.visited) ||
            !candidate.longWaits.containsAll(existing.longWaits)) return false
        if (existing.arrival != candidate.arrival) return true
        if (existing.firstDeparture != candidate.firstDeparture) return existing.firstDeparture < candidate.firstDeparture
        for ((left, right) in existing.identity.zip(candidate.identity)) {
            val line = compareCodePoints(left.first, right.first)
            if (line != 0) return line < 0
            if (left.second != right.second) return left.second < right.second
        }
        return existing.identity.size <= candidate.identity.size
    }

    private fun routingIndex(destination: String, connections: List<ScheduledConnection>, cancelled: () -> Boolean): RoutingIndex {
        val distances = transferDistances(destination, connections, cancelled)
        val trips = mutableMapOf<String, Int>()
        val stations = mutableMapOf<String, Int>()
        val tripCodes = IntArray(connections.size)
        val fromStations = IntArray(connections.size)
        val toStations = IntArray(connections.size)
        val remaining = IntArray(connections.size)
        connections.forEachIndexed { index, connection ->
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            tripCodes[index] = trips.getOrPut(connection.tripKey) { trips.size }
            fromStations[index] = stations.getOrPut(connection.fromStationId) { stations.size }
            toStations[index] = stations.getOrPut(connection.toStationId) { stations.size }
            remaining[index] = distances[connection.tripKey] ?: Int.MAX_VALUE
        }
        return RoutingIndex(tripCodes, fromStations, toStations, remaining, stations.size)
    }

    // Ignoring clocks makes this an optimistic lower bound: it can only retain extra paths.
    private fun transferDistances(destination: String, connections: List<ScheduledConnection>, cancelled: () -> Boolean): Map<String, Int> {
        val stations = mutableMapOf<String, MutableSet<String>>()
        val trips = mutableMapOf<String, MutableSet<String>>()
        val distances = mutableMapOf<String, Int>()
        val queue = ArrayList<String>()
        connections.forEachIndexed { index, connection ->
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            if (!connection.cancelled) {
                for (station in listOf(connection.fromStationId, connection.toStationId)) {
                    stations.getOrPut(station) { mutableSetOf() } += connection.tripKey
                    trips.getOrPut(connection.tripKey) { mutableSetOf() } += station
                }
                if (connection.toStationId == destination && connection.dropOffType == 0 && connection.tripKey !in distances) {
                    distances[connection.tripKey] = 0
                    queue += connection.tripKey
                }
            }
        }
        val visited = mutableSetOf<String>()
        var index = 0
        while (index < queue.size) {
            if (index % 256 == 0 && cancelled()) throw CancellationException()
            val trip = queue[index++]
            val distance = distances.getValue(trip) + 1
            for (station in trips[trip].orEmpty()) if (visited.add(station)) {
                for (next in stations[station].orEmpty()) if (next !in distances) {
                    distances[next] = distance
                    queue += next
                }
            }
        }
        return distances
    }

    private fun filterConditionalLongWaits(candidates: Collection<Label>): List<Label> = candidates.filter { candidate ->
        candidate.longWaits.none { waitEnd ->
            candidates.any { other -> other.firstDeparture > candidate.firstDeparture && other.arrival < waitEnd }
        }
    }

    private fun longWaitEnds(label: Label): List<Long> = label.longWaits.toList()

    private fun transferMillis(previous: ScheduledConnection, next: ScheduledConnection, stationId: String): Long {
        if (previous.mode == next.mode) return minimumTransferMillis
        if (stationId == "200020") return 10 * 60_000L
        return crossModeTransferMillis
    }

    private fun journey(label: Label): Journey? {
        val path = path(label.node)
        val groups = mutableListOf<MutableList<ScheduledConnection>>()
        for (connection in path) {
            if (groups.lastOrNull()?.lastOrNull()?.tripKey == connection.tripKey) groups.last() += connection
            else groups += mutableListOf(connection)
        }
        val legs = groups.mapNotNull { group ->
            val first = group.first()
            val last = group.last()
            val legFrom = first.fromStation ?: return@mapNotNull null
            val legTo = last.toStation ?: return@mapNotNull null
            Leg(
                line = first.line,
                mode = first.mode,
                headsign = first.headsign,
                from = legFrom,
                to = legTo,
                departure = first.departure,
                arrival = last.arrival,
                estimatedDeparture = first.estimatedDeparture,
                estimatedArrival = last.estimatedArrival,
                fromPlatform = first.fromPlatform,
                toPlatform = last.toPlatform,
                cancelled = group.any { it.cancelled },
                identity = TripIdentity(first.source, first.tripId, first.serviceDate, first.fromStopId, last.toStopId, first.fromSequence, last.toSequence),
            )
        }
        return legs.takeIf { it.size == groups.size && it.isNotEmpty() }?.let(::Journey)
    }

    private fun path(node: PathNode): List<ScheduledConnection> {
        val reversed = ArrayList<ScheduledConnection>()
        var current: PathNode? = node
        while (current != null) {
            reversed += current.connection
            current = current.previous
        }
        reversed.reverse()
        return reversed
    }
}
