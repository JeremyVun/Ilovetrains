package com.ilovetrains.app

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.*

/** [bearing] is degrees clockwise from true north, null when the provider reported none. */
data class Fix(val lat: Double, val lon: Double, val at: Long, val speed: Double? = null, val accuracyMetres: Double? = null,
    val bearing: Double? = null)
data class Selection(val tripId: String, val reverse: Boolean, val receipt: String? = null, val kind: HeaderKind = HeaderKind.Predicted)
fun distanceMetres(a: Fix, b: Station): Double =
    if (b.lat == 0.0 && b.lon == 0.0) Double.POSITIVE_INFINITY else metresBetween(a.lat, a.lon, b.lat, b.lon)
fun distanceMetres(a: Fix, b: Fix): Double = metresBetween(a.lat, a.lon, b.lat, b.lon)
fun distanceMetres(a: Station, b: Station): Double =
    if (a.lat == 0.0 && a.lon == 0.0 || b.lat == 0.0 && b.lon == 0.0) Double.POSITIVE_INFINITY else metresBetween(a.lat, a.lon, b.lat, b.lon)
private fun metresBetween(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
    val p = Math.PI / 180; val dLat = (bLat - aLat) * p; val dLon = (bLon - aLon) * p
    val h = sin(dLat / 2).pow(2) + cos(aLat * p) * cos(bLat * p) * sin(dLon / 2).pow(2)
    return 6_371_000 * 2 * atan2(sqrt(h.coerceIn(0.0, 1.0)), sqrt((1 - h).coerceIn(0.0, 1.0)))
}
fun compatible(trip: SavedTrip, modes: Set<String>) = modes.isNotEmpty() && listOf(trip.from, trip.to).all { s -> s.modes.any { it in modes } }
fun focusExpiry(focus: FocusedJourney): Long {
    val guard = focus.arrivalGuard
    val arrival = focus.composed.effectiveArrival
    return if (guard?.armed == true && guard.basis == null) {
        max(arrival + ArrivalConstants.Expiry, (guard.retainedAt ?: arrival) + ArrivalConstants.Retention)
    } else arrival + ArrivalConstants.Expiry
}
fun visibleFocus(data: UserData, now: Long, resumeWaitUntil: Long? = null): FocusedJourney? = data.focus?.takeIf { focus ->
    val guard = focus.arrivalGuard
    val awaitingEvidence = guard?.armed == true && guard.basis != ArrivalBasis.Location &&
        resumeWaitUntil?.let { now < it } == true
    (now <= focusExpiry(focus) || awaitingEvidence) &&
        data.trips.find { it.id == focus.tripId }?.let { compatible(it, data.modes) } == true &&
        focus.journey.legs.all { it.mode in data.modes }
}
fun automaticHome(data: UserData): Station? = data.votes.groupBy { it.station.id }.values
    .filter { it.size >= 3 }.maxWithOrNull(compareBy<List<HomeVote>> { it.size }.thenBy { it.last().day })?.last()?.station ?: data.trips.firstOrNull()?.from
data class HistoryEvidence(val score: Double, val days: Int, val receiptDays: Int)
private const val HABIT_DAYS_NEEDED = 2
private const val HABIT_SCORE_MARGIN = .25
fun historyEvidence(events: List<ViewEvent>, tripId: String, reverse: Boolean, now: Long): HistoryEvidence {
    val current = Instant.ofEpochMilli(now).atZone(Sydney)
    val daily = sortedMapOf<java.time.LocalDate, Double>()
    val receiptDays = mutableSetOf<java.time.LocalDate>()
    events.filter { it.tripId == tripId && it.reverse == reverse && it.at <= now }.forEach {
        val event = Instant.ofEpochMilli(it.at).atZone(Sydney)
        val delta = abs(current.hour - event.hour).let { d -> min(d, 24 - d) }
        val hour = when { delta <= 1 -> 1.0; delta <= 2 -> .5; else -> 0.0 }
        val day = if ((current.dayOfWeek.value >= 6) == (event.dayOfWeek.value >= 6)) 1.0 else .2
        val score = hour * day * .97.pow(max(0.0, (now - it.at) / 86_400_000.0))
        if (score > 0) {
            val date = event.toLocalDate()
            daily[date] = max(daily[date] ?: 0.0, score)
            if (day == 1.0) receiptDays.add(date)
        }
    }
    return HistoryEvidence(daily.values.sum(), daily.size, receiptDays.size)
}
fun historyScore(events: List<ViewEvent>, tripId: String, reverse: Boolean, now: Long): Double =
    historyEvidence(events, tripId, reverse, now).score
fun stationHere(data: UserData, stations: List<Station>, fix: Fix?, now: Long, previousFix: Fix? = null): Station? =
    here(data, stations, fix, now, previousFix)?.station
/** The home end of a trip Home saves when the phone is at a station no saved trip touches. */
fun homewardPairEnd(data: UserData, here: Station): Station? {
    val home = data.home ?: automaticHome(data) ?: return null
    val fromHere = data.trips.filter { compatible(it, data.modes) }.any { it.from.id == here.id || it.to.id == here.id }
    return home.takeIf { !fromHere && it.id != here.id && it.modes.any { mode -> mode in data.modes } }
}
fun predict(data: UserData, stations: List<Station>, fix: Fix?, now: Long, previousFix: Fix? = null): Selection? {
    val trips = data.trips.filter { compatible(it, data.modes) }
    if (trips.isEmpty()) return null
    // At train speed a fix says where the train is, not where the rider starts from.
    val fix = fix?.takeUnless { trainSpeed(it, previousFix) }
    val hasCurrentFix = data.useLocation && fix != null && now - fix.at in 0..300_000
    val here = stationHere(data, stations, fix, now)
    data class Candidate(val trip: SavedTrip, val reverse: Boolean, val score: Double, val days: Int, val factor: Double) { val from get() = if (reverse) trip.to else trip.from; val to get() = if (reverse) trip.from else trip.to }
    val candidates = trips.flatMap { trip -> listOf(false, true).map { reverse ->
        val origin = if (reverse) trip.to else trip.from
        val metres = if (data.useLocation && fix != null && now - fix.at in 0..300_000) distanceMetres(fix, origin) else Double.POSITIVE_INFINITY
        val factor = when { !metres.isFinite() -> 1.0; metres <= 2000 -> 2.5; metres <= 10_000 -> 1.0; else -> .3 }
        val evidence = historyEvidence(data.history, trip.id, reverse, now)
        Candidate(trip, reverse, if (here != null) evidence.score else (evidence.score + .01) * factor, evidence.days, factor)
    } }
    val local = candidates.filter { it.from.id == here?.id }
    val pool = local.ifEmpty { candidates }
    val ranked = pool.sortedByDescending { it.score }
    val habit = ranked.first().takeIf { it.days >= HABIT_DAYS_NEEDED &&
        it.score - (ranked.getOrNull(1)?.score ?: 0.0) >= HABIT_SCORE_MARGIN }
    val location = if (here == null) pool.filter { it.factor == pool.maxOf { c -> c.factor } }.singleOrNull() else null
    val winner = habit ?: location
    val home = data.home ?: automaticHome(data)
    val homeward = if (local.isNotEmpty() && here?.id != home?.id) local.find { it.to.id == home?.id } else null
    val selected = winner ?: homeward
        ?: pool.find { it.trip.id == data.lastTripId && it.reverse == data.lastReverse } ?: pool.first()
    val receipt = if (selected == homeward && winner == null) {
        if (data.votes.count { it.station.id == home?.id } >= 3) "Your days usually start at ${home?.shortName}." else "You usually travel from ${home?.shortName}."
    } else if (here == null && !hasCurrentFix && trips.size >= 2) historyReceipt(data.history, selected.trip.id, selected.reverse, now) else null
    val kind = when {
        here == null -> HeaderKind.Predicted
        selected == homeward && winner == null -> HeaderKind.Home
        else -> HeaderKind.Usual
    }
    return Selection(selected.trip.id, selected.reverse, receipt, kind)
}
fun historyReceipt(history: List<ViewEvent>, id: String, reverse: Boolean, now: Long): String? {
    val zone = Sydney; val n = Instant.ofEpochMilli(now).atZone(zone)
    if (historyEvidence(history, id, reverse, now).receiptDays < 3) return null
    return if (n.dayOfWeek.value < 6 && n.hour < 12) "You check this trip most weekday mornings." else "You often check this trip around now."
}
/** Travel mode from the platform-sighted [UserData.lastAnswer]: under way, seen at its origin, and moved the way it goes. */
fun inferredFocus(data: UserData, fix: Fix, now: Long): FocusedJourney? {
    if (!data.useLocation || data.focus != null || now - fix.at !in 0..300_000) return null
    val last = data.lastAnswer ?: return null
    val trip = data.trips.find { it.id == last.tripId } ?: return null
    if (!compatible(trip, data.modes) || last.journey.legs.any { it.mode !in data.modes }) return null
    val (from, to) = trip.ends(last.reverse)
    val j = last.journey
    if (rideRecorded(data, trip.id, last.reverse, j)) return null
    // A record written after its train left is a retained answer, not evidence of boarding.
    if (now !in j.effectiveDeparture..(j.effectiveArrival + TravelLateMillis) || last.stationId != from.id ||
        j.effectiveDeparture - last.at !in 0..TravelSeenMillis) return null
    val left = distanceMetres(fix, from)
    val span = distanceMetres(from, to)
    if (!left.isFinite() || !span.isFinite()) return null
    val toward = left >= TravelMovedMetres && distanceMetres(fix, to) <= span - TravelMovedMetres
    val fast = (fix.speed ?: 0.0) >= TrainSpeedMps && left >= TravelSpeedMovedMetres
    return if (toward || fast) FocusedJourney(trip.id, last.reverse, j, last.board, false) else null
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
