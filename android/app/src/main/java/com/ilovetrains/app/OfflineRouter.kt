package com.ilovetrains.app

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
    )

    fun route(from: Station, to: Station, at: Long, connections: List<ScheduledConnection>, limit: Int): List<Journey> {
        if (from.id == to.id || limit <= 0) return emptyList()
        val seenTrips = HashSet<String>(maxOriginServices)
        val seeds = ArrayList<Int>(maxOriginServices)
        val denseOriginServices = maxOriginServices - 24
        var lastReservedHour = Long.MIN_VALUE
        for (index in connections.indices) {
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
            routeSeed(to.id, index, connections[index], connections)?.let(candidates::add)
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

    private fun routeSeed(destination: String, startIndex: Int, seed: ScheduledConnection, connections: List<ScheduledConnection>): Label? {
        if (seed.effectiveArrival < seed.effectiveDeparture) return null
        val seedLabel = Label(seed.effectiveArrival, seed.effectiveDeparture, 0, PathNode(seed, null))
        val stationLabels = mutableMapOf<String, MutableMap<Pair<Int, String>, Label>>()
        val tripLabels = mutableMapOf<String, MutableMap<Pair<Int, Int>, Label>>()
        tripLabels.getOrPut(seed.tripKey) { mutableMapOf() }[0 to seed.toSequence] = seedLabel
        if (seed.dropOffType == 0) addStationLabel(stationLabels, seed.toStationId, seedLabel)
        var best = seedLabel.takeIf { seed.toStationId == destination && seed.dropOffType == 0 }
        for (index in startIndex + 1 until connections.size) {
            val connection = connections[index]
            if (connection.cancelled || connection.effectiveArrival < connection.effectiveDeparture) continue
            if (best != null && connection.effectiveDeparture > best.arrival) break
            val onboard = tripLabels[connection.tripKey]
            val waiting = stationLabels[connection.fromStationId]
            if (onboard == null && waiting == null) continue
            val nextLabels = ArrayList<Pair<Label, Boolean>>(8)
            onboard?.values?.forEach { label ->
                if (label.node.connection.toSequence == connection.fromSequence && label.arrival <= connection.effectiveDeparture) {
                    nextLabels += label to false
                }
            }
            waiting?.values?.forEach { label ->
                val wait = connection.effectiveDeparture - label.arrival
                if (label.node.connection.tripKey != connection.tripKey && label.transfers < maxTransfers && connection.pickupType == 0 &&
                    wait >= transferMillis(label.node.connection, connection, connection.fromStationId) &&
                    !visited(label.node, connection.toStationId)
                ) nextLabels += label to true
            }
            for ((prior, transferring) in nextLabels) {
                val next = Label(
                    connection.effectiveArrival,
                    prior.firstDeparture,
                    prior.transfers + if (transferring) 1 else 0,
                    PathNode(connection, prior.node),
                )
                val tripStates = tripLabels.getOrPut(connection.tripKey) { mutableMapOf() }
                val tripState = next.transfers to connection.toSequence
                if (tripStates[tripState]?.arrival?.let { it <= next.arrival } == true) continue
                tripStates[tripState] = next
                if (connection.dropOffType == 0) {
                    addStationLabel(stationLabels, connection.toStationId, next)
                    if (connection.toStationId == destination && (best == null || next.arrival < best.arrival ||
                            next.arrival == best.arrival && next.transfers < best.transfers)) best = next
                }
            }
        }
        return best
    }

    private fun addStationLabel(labels: MutableMap<String, MutableMap<Pair<Int, String>, Label>>, station: String, candidate: Label) {
        val key = candidate.transfers to candidate.node.connection.mode
        val byState = labels.getOrPut(station) { mutableMapOf() }
        if (byState[key]?.arrival?.let { it <= candidate.arrival } != true) byState[key] = candidate
    }

    private fun filterConditionalLongWaits(candidates: Collection<Label>): List<Label> = candidates.filter { candidate ->
        longWaitEnds(candidate).none { waitEnd ->
            candidates.any { other -> other.firstDeparture > candidate.firstDeparture && other.arrival < waitEnd }
        }
    }

    private fun longWaitEnds(label: Label): List<Long> = path(label.node).zipWithNext().mapNotNull { (first, second) ->
        second.effectiveDeparture.takeIf { first.tripKey != second.tripKey && it - first.effectiveArrival > 60 * 60_000L }
    }

    private fun visited(node: PathNode, stationId: String): Boolean {
        var current: PathNode? = node
        while (current != null) {
            if (current.connection.fromStationId == stationId || current.connection.toStationId == stationId) return true
            current = current.previous
        }
        return false
    }

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
