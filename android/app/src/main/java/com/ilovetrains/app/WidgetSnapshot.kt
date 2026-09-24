package com.ilovetrains.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

const val WidgetSnapshotFile = "widget-v1.json"
const val WidgetScheduleHours = 168
const val WidgetBoardLimit = 8
const val WidgetLiveRefresh = 15 * 60_000L
const val WidgetFollowingLimit = 4
// The chronometer counts below zero until a redraw runs, so a boundary this close is drawn as already passed.
const val WidgetRedrawLead = 15_000L
// JobScheduler holds a delayed job's alarm for up to three quarters of the delay (measured: 101 s late on a 136 s delay).
private const val JobLateness = 1.75
private const val RedrawMargin = 5_000L
private const val HourMillis = 3_600_000L

data class WidgetStop(val id: String, val name: String, val modes: List<String>) {
    val station get() = Station(id, name, modes = modes.toSet())
}
data class WidgetTrip(val id: String, val from: WidgetStop, val to: WidgetStop)
data class WidgetScheduleEntry(val at: Long, val tripId: String, val reverse: Boolean)
data class WidgetFocus(val tripId: String, val reverse: Boolean, val pinned: Boolean, val journey: Journey,
    val board: BoardData, val expiresAt: Long)

/** Everything the widget may know about the rider; only the app writes it. */
data class WidgetSnapshot(
    val writtenAt: Long,
    val trips: List<WidgetTrip>,
    val schedule: List<WidgetScheduleEntry>,
    val focus: WidgetFocus?,
    val modes: List<String>,
    val transferCap: Int?,
    val boards: List<BoardData>,
) {
    fun board(from: String, to: String) = boards.find { it.from.id == from && it.to.id == to }
    fun eligible(journey: Journey) =
        journey.legs.isNotEmpty() && journey.legs.all { it.mode in modes } && journey.withinTransferCap(transferCap)
}

data class WidgetAnswer(val trip: WidgetTrip, val reverse: Boolean, val focus: WidgetFocus? = null) {
    val from get() = if (reverse) trip.to else trip.from
    val to get() = if (reverse) trip.from else trip.to
}

data class WidgetRequest(
    val key: String,
    val from: Station,
    val to: Station,
    val modes: Set<String>,
    val at: Long?,
    val transferLimit: Int?,
    val focusJourneyKey: String? = null,
    val fallback: BoardData? = null,
)

/** [next] is the header's train; [cancelled] the struck service it replaced; [following] the board after it, in departure order. */
data class WidgetContent(
    val date: Long,
    val answer: WidgetAnswer?,
    val board: BoardData?,
    val next: Journey?,
    val following: List<Journey>,
    val provenance: String?,
    val cancelled: Journey? = null,
)

data class WidgetScheduleInputs(val trips: List<SavedTrip>, val history: List<ViewEvent>, val modes: Set<String>,
    val lastTripId: String?, val lastReverse: Boolean, val start: Long) {
    constructor(data: UserData, now: Long) : this(data.trips, data.history, data.modes, data.lastTripId, data.lastReverse,
        widgetHourStart(now))
}

fun canonicalWidgetModes(modes: Set<String>) = listOf("train", "metro", "ferry").filter { it in modes }

// Sydney's UTC offsets are whole hours, so its hour boundaries are UTC's.
fun widgetHourStart(t: Long) = Math.floorDiv(t, HourMillis) * HourMillis

fun widgetSchedule(from: Long, hours: Int = WidgetScheduleHours, predict: (Long) -> Pair<String, Boolean>?): List<WidgetScheduleEntry> {
    val start = widgetHourStart(from)
    return (0 until hours).mapNotNull { hour ->
        val at = start + hour * HourMillis
        predict(at)?.let { WidgetScheduleEntry(at, it.first, it.second) }
    }
}

fun widgetSchedule(data: UserData, stations: List<Station>, now: Long) =
    widgetSchedule(now) { at -> predict(data, stations, null, at)?.let { it.tripId to it.reverse } }

private fun weekHour(t: Long): Int = Instant.ofEpochMilli(t).atZone(Sydney).let { it.dayOfWeek.value * 24 + it.hour }

fun widgetScheduleEntry(schedule: List<WidgetScheduleEntry>, t: Long): WidgetScheduleEntry? {
    val first = schedule.firstOrNull() ?: return null
    val offset = Math.floorDiv(t - first.at, HourMillis)
    if (offset in schedule.indices) {
        val entry = schedule[offset.toInt()]
        if (t >= entry.at && t < entry.at + HourMillis) return entry
    }
    // Local weekday and hour, not elapsed weeks, so a daylight-saving change keeps 8am at 8am.
    for (back in 0 until 3) {
        val key = weekHour(t - back * HourMillis)
        schedule.lastOrNull { weekHour(it.at) == key }?.let { return it }
    }
    return null
}

fun widgetAnswer(snapshot: WidgetSnapshot, t: Long): WidgetAnswer? {
    snapshot.focus?.takeIf { t <= it.expiresAt }?.let { focus ->
        snapshot.trips.find { it.id == focus.tripId }?.let { return WidgetAnswer(it, focus.reverse, focus) }
    }
    val entry = widgetScheduleEntry(snapshot.schedule, t) ?: return null
    return snapshot.trips.find { it.id == entry.tripId }?.let { WidgetAnswer(it, entry.reverse) }
}

fun widgetRequest(answer: WidgetAnswer, snapshot: WidgetSnapshot, now: Long): WidgetRequest {
    val pair = "${answer.from.id}|${answer.to.id}"
    val focus = answer.focus
    if (focus != null) {
        // The followed service is asked for whole, as the app does: every mode, no cap, its own departure window once gone.
        val departed = focus.journey.departure < now
        return WidgetRequest("focus|$pair|${focus.journey.key}", answer.from.station, answer.to.station, AllModes,
            if (departed) maxOf(now - 86_400_000, focus.journey.departure) else null, null, focus.journey.key, focus.board)
    }
    return WidgetRequest("pair|$pair|${snapshot.modes.joinToString(",")}|${snapshot.transferCap ?: ""}",
        answer.from.station, answer.to.station, snapshot.modes.toSet(), null, snapshot.transferCap,
        fallback = snapshot.board(answer.from.id, answer.to.id))
}

fun widgetNextAnswerChange(snapshot: WidgetSnapshot, after: Long, until: Long): Long? {
    val focus = snapshot.focus
    if (focus != null && after <= focus.expiresAt && snapshot.trips.any { it.id == focus.tripId }) {
        return (focus.expiresAt + 1).takeIf { it <= until }
    }
    val current = widgetAnswer(snapshot, after)
    var boundary = widgetHourStart(after) + HourMillis
    while (boundary <= until) {
        if (widgetAnswer(snapshot, boundary) != current) return boundary
        boundary += HourMillis
    }
    return null
}

/** A failed or unmatched fetch shows the app's last board as the app shows a retained one. */
fun widgetSource(request: WidgetRequest, fetched: BoardData?): BoardData? {
    if (fetched != null) {
        val key = request.focusJourneyKey ?: return fetched
        if (fetched.journeys.any { it.key == key }) return fetched
    }
    return request.fallback?.lastKnown()
}

/** The tracker's wording, never LIVE: a widget's data is minutes old for nearly all of its life. */
fun widgetFreshness(board: BoardData): String = when {
    board.offline && board.source != "live" -> "Offline · timetable"
    board.offline -> "Offline · Last updated ${clockTime(board.generatedAt)}"
    else -> "Last updated ${clockTime(board.generatedAt)}"
}

internal fun widgetFocused(focus: WidgetFocus, board: BoardData?) = FocusedJourney(focus.tripId, focus.reverse,
    board?.journeys?.find { it.key == focus.journey.key } ?: focus.journey, board ?: focus.board, focus.pinned)

fun widgetContent(snapshot: WidgetSnapshot, sources: Map<String, BoardData>, t: Long): WidgetContent {
    val answer = widgetAnswer(snapshot, t) ?: return WidgetContent(t, null, null, null, emptyList(), null)
    val board = sources[widgetRequest(answer, snapshot, t).key]
    val provenance = board?.let(::widgetFreshness) ?: "Offline"
    // A service leaving at the redraw instant has gone for a view that cannot redraw each minute.
    val lead = homeAnswer(board, answer.focus?.let { widgetFocused(it, board) }, t + 1, snapshot.modes.toSet(), snapshot.transferCap)
        ?: return WidgetContent(t, answer, board, null, emptyList(), provenance)
    val following = board?.journeys.orEmpty().filter {
        snapshot.eligible(it) && it.key != lead.journey.key && it.key != lead.cancelledLead?.key &&
            it.effectiveDeparture > maxOf(t, lead.journey.effectiveDeparture - 1)
    }.sortedBy { it.effectiveDeparture }.take(WidgetFollowingLimit)
    return WidgetContent(t, answer, board, lead.journey, following, provenance, lead.cancelledLead)
}

data class WidgetDraw(val at: Long, val redraw: Long?)

/**
 * The next boundary is approached in redraws that each land before it however late the job runs, and one within
 * [WidgetRedrawLead] draws the widget as it stands after the boundary, so a countdown never passes zero.
 */
fun widgetDraw(snapshot: WidgetSnapshot, sources: Map<String, BoardData>, now: Long, until: Long): WidgetDraw {
    var at = now
    while (true) {
        val next = widgetNextBoundary(snapshot, sources, at, until) ?: return WidgetDraw(at, null)
        if (next - now > WidgetRedrawLead) return WidgetDraw(at, now + ((next - now - RedrawMargin) / JobLateness).toLong())
        at = next
    }
}

fun widgetNextBoundary(snapshot: WidgetSnapshot, sources: Map<String, BoardData>, after: Long, until: Long): Long? {
    val candidates = mutableListOf<Long>()
    widgetNextAnswerChange(snapshot, after, until)?.let(candidates::add)
    val answer = widgetAnswer(snapshot, after)
    val board = answer?.let { sources[widgetRequest(it, snapshot, after).key] }
    if (answer != null && board != null) {
        val times = answer.focus?.let { focus -> widgetFocused(focus, board).journey.legs.flatMap { listOf(it.effectiveDeparture, it.effectiveArrival) } }
            ?: board.journeys.filter(snapshot::eligible).map { it.effectiveDeparture }
        times.filter { it > after }.minOrNull()?.let(candidates::add)
        if (board.isLive(after)) candidates.add(board.generatedAt + 90_001)
    }
    return candidates.filter { it in (after + 1)..until }.minOrNull()
}

/** Board freshness alone never asks the launcher to redraw; the widget keeps its own refresh budget. */
fun widgetAnswerChanged(old: WidgetSnapshot?, new: WidgetSnapshot): Boolean {
    if (old == null) return true
    fun identity(focus: WidgetFocus?) = focus?.let { listOf(it.tripId, it.reverse, it.pinned, it.journey.key, it.expiresAt) }
    return old.trips != new.trips || old.schedule != new.schedule || old.modes != new.modes ||
        old.transferCap != new.transferCap || identity(old.focus) != identity(new.focus)
}

fun widgetBoardPairs(data: UserData, schedule: List<WidgetScheduleEntry>): List<Pair<Station, Station>> =
    schedule.mapNotNull { entry ->
        data.trips.find { it.id == entry.tripId }?.let { if (entry.reverse) it.to to it.from else it.from to it.to }
    }.distinctBy { "${it.first.id}|${it.second.id}" }

fun widgetSnapshot(data: UserData, schedule: List<WidgetScheduleEntry>, boards: List<BoardData>, now: Long): WidgetSnapshot {
    fun stop(station: Station) = WidgetStop(station.id, station.name, canonicalWidgetModes(station.modes))
    fun slim(board: BoardData, journeys: List<Journey>) = BoardData(board.from, board.to, journeys, board.generatedAt,
        board.source, board.offline, board.serverStale)
    val trips = data.trips.filter { compatible(it, data.modes) }.map { WidgetTrip(it.id, stop(it.from), stop(it.to)) }
    val pairs = widgetBoardPairs(data, schedule).map { "${it.first.id}|${it.second.id}" }.toSet()
    val published = boards.filter { "${it.from.id}|${it.to.id}" in pairs }.distinctBy { "${it.from.id}|${it.to.id}" }
        .map { board ->
            slim(board, board.journeys.filter {
                it.legs.all { leg -> leg.mode in data.modes } && it.withinTransferCap(data.maxTransfers) && it.effectiveDeparture >= now
            }.take(WidgetBoardLimit))
        }
    val focus = visibleFocus(data, now)?.takeIf { it.journey.withinTransferCap(data.maxTransfers) }?.let {
        WidgetFocus(it.tripId, it.reverse, it.pinned, it.journey, slim(it.board, listOf(it.journey)), focusExpiry(it))
    }
    return WidgetSnapshot(now, trips, if (trips.isEmpty()) emptyList() else schedule, focus,
        canonicalWidgetModes(data.modes), data.maxTransfers, published)
}

object WidgetWire {
    private fun stop(s: WidgetStop) = JSONObject().put("id", s.id).put("name", s.name).put("modes", JSONArray(s.modes))
    private fun stop(o: JSONObject) = WidgetStop(o.getString("id"), o.getString("name"),
        o.getJSONArray("modes").let { a -> (0 until a.length()).map { a.getString(it) } })
    private fun trip(t: WidgetTrip) = JSONObject().put("id", t.id).put("from", stop(t.from)).put("to", stop(t.to))
    private fun trip(o: JSONObject) = WidgetTrip(o.getString("id"), stop(o.getJSONObject("from")), stop(o.getJSONObject("to")))
    private fun focus(f: WidgetFocus) = JSONObject().put("tripId", f.tripId).put("reverse", f.reverse).put("pinned", f.pinned)
        .put("journey", Wire.journey(f.journey)).put("board", Wire.board(f.board)).put("expiresAt", f.expiresAt)
    private fun focus(o: JSONObject) = WidgetFocus(o.getString("tripId"), o.getBoolean("reverse"), o.getBoolean("pinned"),
        Wire.journey(o.getJSONObject("journey")), Wire.board(o.getJSONObject("board")), o.getLong("expiresAt"))

    fun snapshot(s: WidgetSnapshot): JSONObject = JSONObject().put("schemaVersion", 1).put("writtenAt", s.writtenAt)
        .put("trips", s.trips.jsonEach(::trip))
        .put("schedule", s.schedule.jsonEach { JSONObject().put("at", it.at).put("tripId", it.tripId).put("reverse", it.reverse) })
        .put("focus", s.focus?.let(::focus)).put("modes", JSONArray(s.modes)).put("transferCap", s.transferCap)
        .put("boards", s.boards.jsonEach(Wire::board))

    fun snapshot(o: JSONObject): WidgetSnapshot {
        require(o.getInt("schemaVersion") == 1)
        return WidgetSnapshot(o.getLong("writtenAt"), o.getJSONArray("trips").readEach(::trip),
            o.getJSONArray("schedule").readEach { WidgetScheduleEntry(it.getLong("at"), it.getString("tripId"), it.getBoolean("reverse")) },
            o.optJSONObject("focus")?.let { runCatching { focus(it) }.getOrNull() },
            o.getJSONArray("modes").let { a -> (0 until a.length()).map { a.getString(it) } },
            if (o.has("transferCap")) o.getInt("transferCap") else null,
            o.getJSONArray("boards").readEach(Wire::board))
    }

    fun content(c: WidgetContent): JSONObject = JSONObject().put("date", c.date)
        .put("answer", c.answer?.let { a -> JSONObject().put("trip", trip(a.trip)).put("reverse", a.reverse).put("focus", a.focus?.let(::focus)) })
        .put("board", c.board?.let(Wire::board)).put("next", c.next?.let(Wire::journey))
        .put("following", c.following.jsonEach(Wire::journey)).put("provenance", c.provenance)
        .put("cancelled", c.cancelled?.let(Wire::journey))

    fun content(o: JSONObject) = WidgetContent(o.getLong("date"),
        o.optJSONObject("answer")?.let { a -> WidgetAnswer(trip(a.getJSONObject("trip")), a.getBoolean("reverse"),
            a.optJSONObject("focus")?.let(::focus)) },
        o.optJSONObject("board")?.let(Wire::board), o.optJSONObject("next")?.let(Wire::journey),
        o.getJSONArray("following").readEach(Wire::journey), o.stringOrNull("provenance"),
        o.optJSONObject("cancelled")?.let(Wire::journey))
}
