package com.ilovetrains.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

internal data class RealtimeResult<T>(val value: T, val observedAt: Long? = null, val matched: Boolean = false)
internal data class StopAssignment(val platform: String?, val stationId: String)

internal class OfflineRealtime {
    private data class StopUpdate(
        val stopId: String?,
        val sequence: Int?,
        val assignedStopId: String?,
        val arrival: Long?,
        val departure: Long?,
        val arrivalDelaySeconds: Int?,
        val departureDelaySeconds: Int?,
        val relationship: String,
    ) {
        fun matches(id: String, stopSequence: Int?): Boolean = when {
            stopId != null && sequence != null -> stopId == id && sequence == stopSequence
            stopId != null -> stopId == id
            sequence != null -> sequence == stopSequence
            else -> false
        }
    }

    private data class TripUpdate(
        val tripId: String,
        val serviceDate: String,
        val status: String,
        val delaySeconds: Int?,
        val stops: List<StopUpdate>,
    )

    private data class Snapshot(
        val source: String,
        val headerTimestamp: Long,
        val expiresAt: Long,
        val updates: Map<String, TripUpdate>,
    )

    private val sourceNames = listOf("sydneytrains", "nswtrains", "metro", "ferries", "mff")
    private val snapshots = ConcurrentHashMap<String, Snapshot>()
    private val etags = ConcurrentHashMap<String, String>()

    suspend fun refresh(baseUrl: String) = coroutineScope {
        sourceNames.map { source -> async(Dispatchers.IO) { runCatching { fetch(baseUrl, source) } } }.awaitAll()
    }

    fun hasFreshData(): Boolean = snapshots.values.any { it.expiresAt > System.currentTimeMillis() }

    fun overlay(connections: List<ScheduledConnection>, assignment: (String, String) -> StopAssignment?): List<ScheduledConnection> {
        if (!hasFreshData()) return connections
        val result = connections.toMutableList()
        connections.indices.groupBy { connections[it].tripKey }.values.forEach { indices ->
            val first = connections[indices.first()]
            val snapshot = freshSnapshot(first.source) ?: return@forEach
            val update = snapshot.updates[key(first.tripId, first.serviceDate)] ?: return@forEach
            var carriedDelay = update.delaySeconds?.times(1_000L)
            for (index in indices.sortedBy { connections[it].fromSequence }) {
                val connection = connections[index]
                val from = update.stops.firstOrNull { it.matches(connection.fromStopId, connection.fromSequence) }
                val to = update.stops.firstOrNull { it.matches(connection.toStopId, connection.toSequence) }
                val departure = estimate(from, connection.departure, departure = true, carriedDelay)
                if (from != null && from.relationship != "noData" && departure != null) carriedDelay = departure - connection.departure
                val arrival = estimate(to, connection.arrival, departure = false, carriedDelay)
                if (to != null && to.relationship != "noData" && arrival != null) carriedDelay = arrival - connection.arrival
                val replacementMissingStop = update.status == "replacement" && (from == null || to == null)
                val fromAssignment = from?.assignedStopId?.let { assignment(connection.source, it) }
                val toAssignment = to?.assignedStopId?.let { assignment(connection.source, it) }
                val crossHubAssignment = fromAssignment?.stationId?.let { it != connection.fromStationId } == true ||
                    toAssignment?.stationId?.let { it != connection.toStationId } == true
                result[index] = connection.copy(
                    estimatedDeparture = departure,
                    estimatedArrival = arrival,
                    pickupType = if (from?.relationship == "skipped") 1 else connection.pickupType,
                    dropOffType = if (to?.relationship == "skipped") 1 else connection.dropOffType,
                    fromPlatform = fromAssignment?.platform ?: connection.fromPlatform,
                    toPlatform = toAssignment?.platform ?: connection.toPlatform,
                    cancelled = update.status == "cancelled" || replacementMissingStop || crossHubAssignment || from?.relationship == "skipped" || to?.relationship == "skipped",
                )
            }
        }
        return result
    }

    fun observation(journey: Journey): RealtimeResult<Journey> {
        var observedAt: Long? = null
        var matched = false
        for (identity in journey.legs.mapNotNull(Leg::identity)) {
            val snapshot = freshSnapshot(identity.source) ?: continue
            if (snapshot.updates[key(identity.tripId, identity.serviceDate)] == null) continue
            matched = true
            observedAt = minOf(observedAt ?: Long.MAX_VALUE, snapshot.headerTimestamp)
        }
        return RealtimeResult(journey, observedAt, matched)
    }

    fun overlay(connection: ScheduledConnection, assignment: (String, String) -> StopAssignment?): RealtimeResult<ScheduledConnection> {
        val snapshot = freshSnapshot(connection.source) ?: return RealtimeResult(connection)
        val update = snapshot.updates[key(connection.tripId, connection.serviceDate)] ?: return RealtimeResult(connection)
        val from = update.stops.firstOrNull { it.matches(connection.fromStopId, connection.fromSequence) }
        val to = update.stops.firstOrNull { it.matches(connection.toStopId, connection.toSequence) }
        val defaultDelay = update.delaySeconds?.times(1_000L)
        val departure = if (from?.relationship == "noData") null else from?.departure
            ?: from?.departureDelaySeconds?.let { connection.departure + it * 1_000L }
            ?: defaultDelay?.let { connection.departure + it }
        val arrival = if (to?.relationship == "noData") null else to?.arrival
            ?: to?.arrivalDelaySeconds?.let { connection.arrival + it * 1_000L }
            ?: defaultDelay?.let { connection.arrival + it }
        val replacementMissingStop = update.status == "replacement" && (from == null || to == null)
        val fromAssignment = from?.assignedStopId?.let { assignment(connection.source, it) }
        val toAssignment = to?.assignedStopId?.let { assignment(connection.source, it) }
        val crossHubAssignment = fromAssignment?.stationId?.let { it != connection.fromStationId } == true ||
            toAssignment?.stationId?.let { it != connection.toStationId } == true
        val cancelled = update.status == "cancelled" || replacementMissingStop || crossHubAssignment || from?.relationship == "skipped" || to?.relationship == "skipped"
        val value = connection.copy(
            estimatedDeparture = departure,
            estimatedArrival = arrival,
            pickupType = if (from?.relationship == "skipped") 1 else connection.pickupType,
            dropOffType = if (to?.relationship == "skipped") 1 else connection.dropOffType,
            fromPlatform = fromAssignment?.platform ?: connection.fromPlatform,
            toPlatform = toAssignment?.platform ?: connection.toPlatform,
            cancelled = cancelled,
        )
        return RealtimeResult(value, snapshot.headerTimestamp, true)
    }

    private fun estimate(stop: StopUpdate?, scheduled: Long, departure: Boolean, inheritedDelay: Long?): Long? {
        if (stop?.relationship == "noData") return null
        val exact = if (departure) stop?.departure else stop?.arrival
        val delay = if (departure) stop?.departureDelaySeconds ?: stop?.arrivalDelaySeconds else stop?.arrivalDelaySeconds ?: stop?.departureDelaySeconds
        return exact ?: delay?.let { scheduled + it * 1_000L } ?: inheritedDelay?.let { scheduled + it }
    }

    fun overlay(journey: Journey, assignment: (String, String) -> StopAssignment?): RealtimeResult<Journey> {
        var observedAt: Long? = null
        var matched = false
        val legs = journey.legs.map { leg ->
            val identity = leg.identity ?: return@map leg
            val snapshot = freshSnapshot(identity.source)
                ?: return@map leg.copy(estimatedDeparture = null, estimatedArrival = null, cancelled = false)
            val update = snapshot.updates[key(identity.tripId, identity.serviceDate)]
                ?: return@map leg.copy(estimatedDeparture = null, estimatedArrival = null, cancelled = false)
            matched = true
            observedAt = minOf(observedAt ?: Long.MAX_VALUE, snapshot.headerTimestamp)
            val from = update.stops.firstOrNull { it.matches(identity.fromStopId, identity.fromSequence) }
            val to = update.stops.firstOrNull { it.matches(identity.toStopId, identity.toSequence) }
            val delay = update.delaySeconds?.times(1_000L)
            val replacementMissingStop = update.status == "replacement" && (from == null || to == null)
            val fromAssignment = from?.assignedStopId?.let { assignment(identity.source, it) }
            val toAssignment = to?.assignedStopId?.let { assignment(identity.source, it) }
            val crossHubAssignment = fromAssignment?.stationId?.let { it != leg.from.id } == true ||
                toAssignment?.stationId?.let { it != leg.to.id } == true
            leg.copy(
                estimatedDeparture = if (from?.relationship == "noData") null else from?.departure ?: from?.departureDelaySeconds?.let { leg.departure + it * 1_000L } ?: delay?.let { leg.departure + it },
                estimatedArrival = if (to?.relationship == "noData") null else to?.arrival ?: to?.arrivalDelaySeconds?.let { leg.arrival + it * 1_000L } ?: delay?.let { leg.arrival + it },
                fromPlatform = fromAssignment?.platform ?: leg.fromPlatform,
                toPlatform = toAssignment?.platform ?: leg.toPlatform,
                cancelled = update.status == "cancelled" || replacementMissingStop || crossHubAssignment || from?.relationship == "skipped" || to?.relationship == "skipped",
            )
        }
        return RealtimeResult(Journey(legs), observedAt, matched)
    }

    private fun freshSnapshot(source: String): Snapshot? {
        val snapshot = snapshots[source] ?: return null
        return snapshot.takeIf { it.expiresAt > System.currentTimeMillis() }
    }

    private fun fetch(baseUrl: String, source: String) {
        val url = URL("${baseUrl.trimEnd('/')}/api/v1/realtime/$source")
        require(url.protocol == "https" || url.host in setOf("localhost", "127.0.0.1")) { "Realtime updates require HTTPS" }
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 8_000
        connection.setRequestProperty("Accept", "application/json")
        etags[source]?.let { connection.setRequestProperty("If-None-Match", it) }
        try {
            if (connection.responseCode == HttpURLConnection.HTTP_NOT_MODIFIED) return
            if (connection.responseCode != HttpURLConnection.HTTP_OK || connection.getHeaderField("X-Data-Stale").equals("true", true)) return
            val bytes = connection.inputStream.use { readLimited(it, 5_000_000) }
            if (!accept(bytes.toString(Charsets.UTF_8), source)) return
            connection.getHeaderField("ETag")?.let { etags[source] = it }
        } finally {
            connection.disconnect()
        }
    }

    internal fun accept(json: String, expectedSource: String, now: Long = System.currentTimeMillis()): Boolean {
        val snapshot = parseSnapshot(JSONObject(json), expectedSource)
        if (snapshot.expiresAt <= now) return false
        snapshots[expectedSource] = snapshot
        return true
    }

    private fun parseSnapshot(json: JSONObject, expectedSource: String): Snapshot {
        require(json.getInt("schemaVersion") == 1)
        val source = json.getString("source")
        require(source == expectedSource)
        val updates = linkedMapOf<String, TripUpdate>()
        val values = json.getJSONArray("updates")
        for (index in 0 until values.length()) {
            val item = values.getJSONObject(index)
            val tripId = item.getString("tripId")
            val serviceDate = item.getString("serviceDate")
            require(serviceDate.matches(Regex("\\d{8}")))
            val status = item.getString("status")
            require(status in setOf("scheduled", "added", "unscheduled", "cancelled", "replacement"))
            val stops = item.getJSONArray("stopUpdates").let { array ->
                List(array.length()) { stopIndex ->
                    val stop = array.getJSONObject(stopIndex)
                    StopUpdate(
                        stopId = stop.optionalString("stopId"),
                        sequence = stop.optionalInt("stopSequence"),
                        assignedStopId = stop.optionalString("assignedStopId"),
                        arrival = stop.optionalTime("arrivalMs"),
                        departure = stop.optionalTime("departureMs"),
                        arrivalDelaySeconds = stop.optionalInt("arrivalDelaySeconds"),
                        departureDelaySeconds = stop.optionalInt("departureDelaySeconds"),
                        relationship = stop.optString("scheduleRelationship", "scheduled"),
                    )
                }
            }
            val key = key(tripId, serviceDate)
            require(key !in updates)
            updates[key] = TripUpdate(tripId, serviceDate, status, item.optionalInt("delaySeconds"), stops)
        }
        return Snapshot(source, json.requiredTime("headerTimestamp"), json.requiredTime("expiresAt"), updates)
    }

    private fun key(tripId: String, serviceDate: String) = "$tripId\u0000$serviceDate"

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            require(output.size() + read <= limit)
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun JSONObject.optionalString(name: String): String? = if (has(name) && !isNull(name)) getString(name).takeIf(String::isNotBlank) else null
    private fun JSONObject.optionalInt(name: String): Int? = if (has(name) && !isNull(name)) getInt(name) else null
    private fun JSONObject.optionalTime(name: String): Long? = if (has(name) && !isNull(name)) parseTime(get(name)) else null
    private fun JSONObject.requiredTime(name: String): Long = parseTime(get(name))
    private fun parseTime(value: Any): Long = when (value) {
        is Number -> value.toLong()
        is String -> Instant.parse(value).toEpochMilli()
        else -> error("invalid timestamp")
    }
}
