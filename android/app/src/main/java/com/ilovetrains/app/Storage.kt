package com.ilovetrains.app

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

data class LastAnswer(val tripId: String, val reverse: Boolean, val at: Long, val stationId: String?, val board: BoardData, val journey: Journey)
data class UserData(
    val trips: List<SavedTrip> = emptyList(), val history: List<ViewEvent> = emptyList(),
    val rides: List<Ride> = emptyList(), val votes: List<HomeVote> = emptyList(),
    val lastTripId: String? = null, val lastReverse: Boolean = false,
    val focus: FocusedJourney? = null, val lastAnswer: LastAnswer? = null,
    val appearance: Appearance = Appearance.System, val modes: Set<String> = AllModes,
    val useLocation: Boolean = true, val home: Station? = null,
    val recentFrom: List<Station> = emptyList(), val recentTo: List<Station> = emptyList()
)

internal fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
internal fun JSONObject.longOrNull(key: String): Long? = if (isNull(key)) null else optLong(key).takeIf { it > 0 }
internal fun <T> JSONArray?.readEach(read: (JSONObject) -> T): List<T> = if (this == null) emptyList() else (0 until length()).mapNotNull { i -> runCatching { read(getJSONObject(i)) }.getOrNull() }
internal fun <T> List<T>.jsonEach(write: (T) -> JSONObject) = JSONArray(map(write))

object Wire {
    fun station(s: Station) = JSONObject().put("id", s.id).put("name", s.name)
        .put("location", JSONObject().put("lat", s.lat).put("lon", s.lon)).put("modes", JSONArray(s.modes.toList()))
    fun station(o: JSONObject): Station {
        val loc = o.optJSONObject("location")
        val modes = o.optJSONArray("modes")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: AllModes
        return Station(o.getString("id"), o.getString("name"), loc?.optDouble("lat", 0.0) ?: 0.0, loc?.optDouble("lon", 0.0) ?: 0.0, modes)
    }
    private fun epoch(o: JSONObject, key: String) = o.opt(key)?.let { if (it is Number) it.toLong() else runCatching { Instant.parse(it.toString()).toEpochMilli() }.getOrNull() }
    fun journey(j: Journey): JSONObject = JSONObject().put("legDetail", j.legs.jsonEach { l ->
        JSONObject().put("line", JSONObject().put("name", l.line).put("mode", l.mode)).put("headsign", l.headsign)
            .put("from", station(l.from).put("platform", l.fromPlatform)).put("to", station(l.to).put("platform", l.toPlatform))
            .put("departure", JSONObject().put("scheduled", l.departure).put("estimated", l.estimatedDeparture))
            .put("arrival", JSONObject().put("scheduled", l.arrival).put("estimated", l.estimatedArrival)).put("cancelled", l.cancelled)
            .put("identity", l.identity?.let { i -> JSONObject().put("source", i.source).put("tripId", i.tripId).put("serviceDate", i.serviceDate)
                .put("fromStopId", i.fromStopId).put("toStopId", i.toStopId).put("fromSequence", i.fromSequence).put("toSequence", i.toSequence) })
    })
    fun journey(o: JSONObject): Journey {
        val legs = o.getJSONArray("legDetail").readEach { l ->
            val d = l.getJSONObject("departure"); val a = l.getJSONObject("arrival")
            val f = l.getJSONObject("from"); val t = l.getJSONObject("to"); val line = l.getJSONObject("line")
            val identity = l.optJSONObject("identity")?.let { TripIdentity(
                it.getString("source"), it.getString("tripId"), it.getString("serviceDate"), it.getString("fromStopId"), it.getString("toStopId"),
                if (it.has("fromSequence") && !it.isNull("fromSequence")) it.getInt("fromSequence") else null,
                if (it.has("toSequence") && !it.isNull("toSequence")) it.getInt("toSequence") else null,
            ) }
            Leg(line.getString("name"), line.getString("mode"), l.optString("headsign"), station(f), station(t),
                requireNotNull(epoch(d, "scheduled")), requireNotNull(epoch(a, "scheduled")), epoch(d, "estimated"), epoch(a, "estimated"),
                f.stringOrNull("platform"), t.stringOrNull("platform"), l.optBoolean("cancelled"), identity)
        }
        require(legs.isNotEmpty() && legs.size == o.getJSONArray("legDetail").length())
        require(legs.all { it.arrival >= it.departure })
        return Journey(legs)
    }
    fun board(b: BoardData) = JSONObject().put("from", station(b.from)).put("to", station(b.to))
        .put("journeys", b.journeys.jsonEach(::journey)).put("generatedAt", b.generatedAt).put("source", b.source)
        .put("offline", b.offline).put("serverStale", b.serverStale).put("coverage", b.coverage).put("error", b.error)
    fun board(o: JSONObject, api: Boolean = false) = BoardData(station(o.getJSONObject("from")), station(o.getJSONObject("to")),
        o.optJSONArray("journeys").readEach(::journey), epoch(o, "generatedAt") ?: 0,
        if (api) "live" else o.optString("source", "schedule"), o.optBoolean("offline"), o.optBoolean("serverStale"), o.optString("coverage"), o.stringOrNull("error"))
    private fun trip(t: SavedTrip) = JSONObject().put("id", t.id).put("from", station(t.from)).put("to", station(t.to))
        .put("createdAt", t.createdAt).put("lastViewed", t.lastViewed).put("lines", JSONArray(t.lines))
    private fun trip(o: JSONObject) = SavedTrip(o.getString("id"), station(o.getJSONObject("from")), station(o.getJSONObject("to")), o.optLong("createdAt"), o.optLong("lastViewed"),
        o.optJSONArray("lines")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList())
    private fun focus(f: FocusedJourney) = JSONObject().put("tripId", f.tripId).put("reverse", f.reverse)
        .put("journey", journey(f.journey)).put("board", board(f.board)).put("pinned", f.pinned)
    private fun focus(o: JSONObject) = FocusedJourney(o.getString("tripId"), o.optBoolean("reverse"), journey(o.getJSONObject("journey")), board(o.getJSONObject("board")), o.optBoolean("pinned", true))
    fun user(d: UserData) = JSONObject().put("schemaVersion", 1).put("trips", d.trips.jsonEach(::trip))
        .put("history", d.history.jsonEach { JSONObject().put("tripId", it.tripId).put("reverse", it.reverse).put("at", it.at) })
        .put("rides", d.rides.jsonEach { ride -> JSONObject().put("tripId", ride.tripId).put("reverse", ride.reverse)
            .put("departure", ride.departure).put("arrival", ride.arrival).put("from", ride.from?.let(::station)).put("to", ride.to?.let(::station)) })
        .put("votes", d.votes.jsonEach { JSONObject().put("day", it.day).put("station", station(it.station)) })
        .put("lastTripId", d.lastTripId).put("lastReverse", d.lastReverse).put("focus", d.focus?.let(::focus))
        .put("appearance", d.appearance.name).put("modes", JSONArray(d.modes.toList())).put("useLocation", d.useLocation)
        .put("home", d.home?.let(::station)).put("recentFrom", d.recentFrom.jsonEach(::station)).put("recentTo", d.recentTo.jsonEach(::station))
        .put("lastAnswer", d.lastAnswer?.let { JSONObject().put("tripId", it.tripId).put("reverse", it.reverse).put("at", it.at).put("stationId", it.stationId).put("board", board(it.board)).put("journey", journey(it.journey)) })
    fun user(o: JSONObject): UserData {
        require(o.optInt("schemaVersion", 1) == 1)
        return UserData(o.optJSONArray("trips").readEach(::trip),
            o.optJSONArray("history").readEach { ViewEvent(it.getString("tripId"), it.optBoolean("reverse"), it.getLong("at")) }.takeLast(500),
            o.optJSONArray("rides").readEach { Ride(it.getString("tripId"), it.optBoolean("reverse"), it.getLong("departure"), it.getLong("arrival"),
                it.optJSONObject("from")?.let(::station), it.optJSONObject("to")?.let(::station)) }.takeLast(100),
            o.optJSONArray("votes").readEach { HomeVote(it.getString("day"), station(it.getJSONObject("station"))) }.takeLast(7),
            o.stringOrNull("lastTripId"), o.optBoolean("lastReverse"), o.optJSONObject("focus")?.let { runCatching { focus(it) }.getOrNull() },
            o.optJSONObject("lastAnswer")?.let { runCatching { LastAnswer(it.getString("tripId"), it.optBoolean("reverse"), it.getLong("at"), it.stringOrNull("stationId"), board(it.getJSONObject("board")), journey(it.getJSONObject("journey"))) }.getOrNull() },
            runCatching { Appearance.valueOf(o.optString("appearance")) }.getOrDefault(Appearance.System),
            o.optJSONArray("modes")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it in AllModes }.toSet() } ?: AllModes,
            o.optBoolean("useLocation", true), o.optJSONObject("home")?.let { runCatching { station(it) }.getOrNull() },
            o.optJSONArray("recentFrom").readEach(::station).take(3), o.optJSONArray("recentTo").readEach(::station).take(3))
    }
}

class DeviceStore(private val context: Context) {
    private val stateFile = AtomicFile(File(context.filesDir, "personal-v1.json"))
    private val cacheDir = File(context.cacheDir, "boards").apply { mkdirs() }
    suspend fun load(): UserData = withContext(Dispatchers.IO) {
        runCatching { Wire.user(JSONObject(stateFile.openRead().bufferedReader().use { it.readText() })) }.getOrDefault(UserData())
    }
    suspend fun save(data: UserData) = withContext(Dispatchers.IO) { write(stateFile, Wire.user(data).toString()) }
    private fun write(file: AtomicFile, text: String) {
        val stream = file.startWrite()
        try { stream.write(text.toByteArray()); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
    private fun cacheFile(from: Station, to: Station, modes: Set<String>) = AtomicFile(File(cacheDir, "${from.id}-${to.id}-${modes.sorted().joinToString("_")}.json"))
    suspend fun cached(from: Station, to: Station, modes: Set<String>): BoardData? = withContext(Dispatchers.IO) {
        runCatching { Wire.board(JSONObject(cacheFile(from, to, modes).openRead().bufferedReader().use { it.readText() })) }.getOrNull()
            ?.takeIf { it.from.id == from.id && it.to.id == to.id }
    }
    suspend fun cache(board: BoardData, modes: Set<String>) = withContext(Dispatchers.IO) { write(cacheFile(board.from, board.to, modes), Wire.board(board).toString()) }
    suspend fun removeCache(trip: SavedTrip) = withContext(Dispatchers.IO) {
        cacheDir.listFiles()?.filter { it.name.startsWith("${trip.from.id}-${trip.to.id}-") || it.name.startsWith("${trip.to.id}-${trip.from.id}-") }?.forEach { it.delete() }
    }
    suspend fun stations(): List<Station> = withContext(Dispatchers.IO) { context.assets.open("stations.json").bufferedReader().use { JSONArray(it.readText()).readEach(Wire::station) } }
}
