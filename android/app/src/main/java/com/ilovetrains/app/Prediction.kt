package com.ilovetrains.app

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.*

data class Fix(val lat: Double, val lon: Double, val at: Long, val speed: Double? = null)
data class Selection(val tripId: String, val reverse: Boolean, val receipt: String? = null)
fun distanceMetres(a: Fix, b: Station): Double {
    if (b.lat == 0.0 && b.lon == 0.0) return Double.POSITIVE_INFINITY
    val p = Math.PI / 180; val dLat = (b.lat - a.lat) * p; val dLon = (b.lon - a.lon) * p
    val h = sin(dLat / 2).pow(2) + cos(a.lat * p) * cos(b.lat * p) * sin(dLon / 2).pow(2)
    return 6_371_000 * 2 * atan2(sqrt(h.coerceIn(0.0, 1.0)), sqrt((1 - h).coerceIn(0.0, 1.0)))
}
fun compatible(trip: SavedTrip, modes: Set<String>) = modes.isNotEmpty() && listOf(trip.from, trip.to).all { s -> s.modes.any { it in modes } }
fun visibleFocus(data: UserData, now: Long): FocusedJourney? = data.focus?.takeIf { focus ->
    now <= focus.journey.effectiveArrival + 1_800_000 &&
        data.trips.find { it.id == focus.tripId }?.let { compatible(it, data.modes) } == true &&
        focus.journey.legs.all { it.mode in data.modes }
}
fun automaticHome(data: UserData): Station? = data.votes.groupBy { it.station.id }.values
    .filter { it.size >= 3 }.maxWithOrNull(compareBy<List<HomeVote>> { it.size }.thenBy { it.last().day })?.last()?.station ?: data.trips.firstOrNull()?.from
fun historyScore(events: List<ViewEvent>, tripId: String, reverse: Boolean, now: Long): Double {
    val current = Instant.ofEpochMilli(now).atZone(Sydney)
    return events.filter { it.tripId == tripId && it.reverse == reverse }.sumOf {
        val event = Instant.ofEpochMilli(it.at).atZone(Sydney)
        val delta = abs(current.hour - event.hour).let { d -> min(d, 24 - d) }
        val hour = when { delta <= 1 -> 1.0; delta <= 2 -> .5; else -> 0.0 }
        val day = if ((current.dayOfWeek.value >= 6) == (event.dayOfWeek.value >= 6)) 1.0 else .2
        hour * day * .97.pow(max(0.0, (now - it.at) / 86_400_000.0))
    }
}
fun stationHere(data: UserData, stations: List<Station>, fix: Fix?, now: Long): Station? {
    if (!data.useLocation || fix == null || now - fix.at !in 0..300_000) return null
    val saved = data.trips.flatMap { listOf(it.from, it.to) }.map { s -> stations.find { it.id == s.id } ?: s }.distinctBy { it.id }
        .filter { s -> s.modes.any { it in data.modes } }
    val eligible = stations.filter { s -> s.modes.any { it in data.modes } }
    fun nearest(list: List<Station>, within: Double) = list.filter { distanceMetres(fix, it) <= within }.minByOrNull { distanceMetres(fix, it) }
    return nearest(saved, 200.0) ?: nearest(eligible, 200.0) ?: nearest(saved, 2000.0) ?: nearest(eligible, 2000.0)
}
fun predict(data: UserData, stations: List<Station>, fix: Fix?, now: Long): Selection? {
    val trips = data.trips.filter { compatible(it, data.modes) }
    if (trips.isEmpty()) return null
    val hasCurrentFix = data.useLocation && fix != null && now - fix.at in 0..300_000
    val here = stationHere(data, stations, fix, now)
    data class Candidate(val trip: SavedTrip, val reverse: Boolean, val score: Double) { val from get() = if (reverse) trip.to else trip.from; val to get() = if (reverse) trip.from else trip.to }
    val candidates = trips.flatMap { trip -> listOf(false, true).map { reverse ->
        val origin = if (reverse) trip.to else trip.from
        val metres = if (data.useLocation && fix != null && now - fix.at in 0..300_000) distanceMetres(fix, origin) else Double.POSITIVE_INFINITY
        val factor = when { !metres.isFinite() -> 1.0; metres <= 2000 -> 2.5; metres <= 10_000 -> 1.0; else -> .3 }
        Candidate(trip, reverse, historyScore(data.history, trip.id, reverse, now).let { if (here != null) it else (it + .01) * factor })
    } }
    val local = candidates.filter { it.from.id == here?.id }
    val pool = local.ifEmpty { candidates }
    val best = pool.maxOf { it.score }; val leaders = pool.filter { it.score == best }
    val home = data.home ?: automaticHome(data)
    val homeward = if (local.isNotEmpty() && here?.id != home?.id) local.find { it.to.id == home?.id } else null
    val selected = if (best > 0 && leaders.size == 1) leaders.first() else homeward
        ?: pool.find { it.trip.id == data.lastTripId && it.reverse == data.lastReverse } ?: pool.first()
    val receipt = if (selected == homeward && !(best > 0 && leaders.size == 1)) {
        if (data.votes.count { it.station.id == home?.id } >= 3) "Your days usually start at ${home?.shortName}." else "You usually travel from ${home?.shortName}."
    } else if (here == null && !hasCurrentFix && trips.size >= 2) historyReceipt(data.history, selected.trip.id, selected.reverse, now) else null
    return Selection(selected.trip.id, selected.reverse, receipt)
}
fun historyReceipt(history: List<ViewEvent>, id: String, reverse: Boolean, now: Long): String? {
    val zone = Sydney; val n = Instant.ofEpochMilli(now).atZone(zone)
    val events = history.filter { it.tripId == id && it.reverse == reverse }.map { Instant.ofEpochMilli(it.at).atZone(zone) }
        .filter { (it.dayOfWeek.value >= 6) == (n.dayOfWeek.value >= 6) && abs(it.hour - n.hour).let { d -> min(d, 24 - d) } <= 2 }
    if (events.size < 3) return null
    return if (n.dayOfWeek.value < 6 && n.hour < 12 && events.map { it.toLocalDate() }.distinct().size >= 3) "You check this trip most weekday mornings." else "You often check this trip around now."
}
fun inferredFocus(data: UserData, fix: Fix, now: Long): FocusedJourney? {
    if (!data.useLocation || data.focus != null || now - fix.at !in 0..300_000) return null
    val last = data.lastAnswer ?: return null
    val trip = data.trips.find { it.id == last.tripId } ?: return null
    if (!compatible(trip, data.modes) || last.journey.legs.any { it.mode !in data.modes }) return null
    val from = if (last.reverse) trip.to else trip.from; val to = if (last.reverse) trip.from else trip.to
    val j = last.journey
    if (data.rides.any { it.tripId == trip.id && it.reverse == last.reverse && it.departure == j.departure }) return null
    if (now !in j.effectiveDeparture..(j.effectiveArrival + 1_800_000) || last.stationId != from.id || j.effectiveDeparture - last.at !in 0..900_000) return null
    val left = distanceMetres(fix, from)
    val toward = left >= 1000 && distanceMetres(fix, to) <= distanceMetres(Fix(from.lat, from.lon, now), to) - 1000
    val fast = (fix.speed ?: 0.0) >= 8 && left >= 200
    return if (left.isFinite() && (toward || fast)) FocusedJourney(trip.id, last.reverse, j, last.board, false) else null
}

fun savedTripMetadata(data: UserData, fix: Fix?, selectedTripId: String?, selectedReverse: Boolean, now: Long): Map<String, String> {
    val currentFix = fix?.takeIf { data.useLocation && now - it.at in 0..300_000 }
    val today = Instant.ofEpochMilli(now).atZone(Sydney).toLocalDate()
    return data.trips.associate { trip ->
        val reverse = when {
            data.focus?.tripId == trip.id -> data.focus.reverse
            selectedTripId == trip.id -> selectedReverse
            else -> false
        }
        val origin = if (reverse) trip.to else trip.from
        val distance = currentFix?.let { distanceMetres(it, origin) }?.takeIf { it.isFinite() }?.let(::formatSavedDistance)
        val latest = data.rides.asSequence().filter { it.tripId == trip.id && it.arrival in 1..now }.maxByOrNull { it.arrival }
        val ridden = if (latest == null) "Never ridden" else {
            val arrival = Instant.ofEpochMilli(latest.arrival).atZone(Sydney)
            when (ChronoUnit.DAYS.between(arrival.toLocalDate(), today)) {
                0L -> "Rode it today"
                1L -> "Last ridden yesterday"
                in 2L..6L -> "Last ridden ${arrival.format(DateTimeFormatter.ofPattern("EEEE", Locale.forLanguageTag("en-AU")))}"
                else -> "Last ridden ${arrival.format(DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("en-AU")))}"
            }
        }
        trip.id to listOfNotNull(distance, ridden).joinToString(" · ")
    }
}

private fun formatSavedDistance(metres: Double): String = when {
    metres < 1000 -> "${max(10, (metres / 10).roundToInt() * 10)} m away"
    metres < 10_000 -> String.format(Locale.ROOT, "%.1f km away", metres / 1000)
    else -> "${(metres / 1000).roundToInt()} km away"
}
