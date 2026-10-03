package com.ilovetrains.app

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

// About 30 km/h: faster than anyone walks or runs on a platform.
const val TrainSpeedMps = 8.0
// Gadigal is 152 m from Town Hall's point, so a saved station's footprint must beat a stranger's 200 m.
const val SavedStationMetres = 400.0
const val AtStationMetres = 200.0
const val NearStationMetres = 2_000.0
// Platforms reach about 150 m from a station's point, and a Home fix may be 200 m inaccurate.
const val SightingMetres = 300.0
const val PreviousFixMinMillis = 15_000L
const val PreviousFixMaxMillis = 120_000L

/** [tier] 1 is standing at the station, 2 a saved end within 2 km, 3 any station within 2 km. */
data class Here(val station: Station, val tier: Int)

fun previousFixUsable(fix: Fix, previous: Fix?): Boolean =
    previous != null && fix.at - previous.at in PreviousFixMinMillis..PreviousFixMaxMillis

private fun Double?.known(): Double? = this?.takeIf { it.isFinite() && it >= 0 }

// Without a usable speed, only a displacement no position error could produce counts.
fun trainSpeed(fix: Fix?, previous: Fix? = null): Boolean {
    fix ?: return false
    fix.speed.known()?.let { return it >= TrainSpeedMps }
    if (previous == null || !previousFixUsable(fix, previous)) return false
    val accuracy = fix.accuracyMetres.known() ?: return false
    val previousAccuracy = previous.accuracyMetres.known() ?: return false
    return distanceMetres(fix, previous) >= TrainSpeedMps * (fix.at - previous.at) / 1000 + accuracy + previousAccuracy
}

/**
 * Where the phone is, as a station: the nearest saved end within 400 m, else any station within 200 m, else the
 * nearest saved end within 2 km, else the nearest station within 2 km. A phone at train speed is passing stations.
 */
fun here(data: UserData, stations: List<Station>, fix: Fix?, now: Long, previousFix: Fix? = null): Here? {
    if (!data.useLocation || fix == null || now - fix.at !in 0..300_000 || trainSpeed(fix, previousFix)) return null
    val saved = data.trips.flatMap { listOf(it.from, it.to) }.map { s -> stations.find { it.id == s.id } ?: s }.distinctBy { it.id }
        .filter { s -> s.modes.any { it in data.modes } }
    val eligible = stations.filter { s -> s.modes.any { it in data.modes } }
    fun nearest(list: List<Station>, within: Double) = list.filter { distanceMetres(fix, it) <= within }.minByOrNull { distanceMetres(fix, it) }
    nearest(saved, SavedStationMetres)?.let { return Here(it, 1) }
    nearest(eligible, AtStationMetres)?.let { return Here(it, 1) }
    nearest(saved, NearStationMetres)?.let { return Here(it, 2) }
    return nearest(eligible, NearStationMetres)?.let { Here(it, 3) }
}

/** The station a record may name as seen at: here's station, when the fix is close enough to be on its platforms. */
fun sightingOf(here: Here?, fix: Fix?): Station? =
    here?.station?.takeIf { fix != null && distanceMetres(fix, it) <= SightingMetres }

const val TravelSeenMillis = 15 * 60_000L
const val TravelLateMillis = 30 * 60_000L
const val TravelMovedMetres = 1_000.0
const val TravelSpeedMovedMetres = 200.0
// A train pulling out stays within 300 m of the platform for its first 20-30 s.
const val HoldSightingAfterMillis = 60_000L
// A car following the line would otherwise match the next train along one fix later.
const val DeclineHoldMillis = 60 * 60_000L

/** The guessed trip the rider stopped; [departure] is the declined journey's [departureKey]. */
data class InferenceDecline(val tripId: String, val reverse: Boolean, val at: Long, val departure: String, val arrival: Long)

/** The first service leg's line and scheduled departure, independent of the full-journey [Journey.key]. */
val Journey.departureKey: String get() = legs.first().let { "${it.line}:${it.departure}" }

fun SavedTrip.ends(reverse: Boolean): Pair<Station, Station> = if (reverse) to to from else from to to

fun lastAnswerInferable(data: UserData, record: LastAnswer?, now: Long): Boolean {
    val trip = record?.let { data.trips.find { trip -> trip.id == it.tripId } } ?: return false
    return record.stationId != null && record.stationId == trip.ends(record.reverse).first.id &&
        record.journey.effectiveDeparture - record.at in 0..TravelSeenMillis && now <= record.journey.effectiveArrival + TravelLateMillis
}

// A record unsighted or sighted anywhere but the held origin proves nothing, so it cannot erase evidence.
fun replacesLastAnswer(data: UserData, incomingStationId: String?, now: Long, sightingAt: Long?): Boolean {
    val stored = data.lastAnswer
    if (stored == null || !lastAnswerInferable(data, stored, now)) return true
    if (incomingStationId != stored.stationId) return false
    val departure = stored.journey.effectiveDeparture
    return now < departure || sightingAt != null && sightingAt >= departure + HoldSightingAfterMillis
}

// By then a departed train is kilometres out: a fix reads train speed or finds the rider still waiting.
const val ShownDepartureFixMillis = 5 * 60_000L
const val MovingFixFreshMillis = 2 * 60_000L

/** Whether a refresh tick with Home open takes a fix, given the departures of leads Home showed this visit. */
fun tickNeedsFix(data: UserData, now: Long, shownDepartures: Collection<Long>, fix: Fix?, previousFix: Fix?): Boolean {
    if (shownDepartures.any { now >= it && now - it <= ShownDepartureFixMillis }) return true
    val stored = data.lastAnswer
    if (stored != null && lastAnswerInferable(data, stored, now) && stored.journey.effectiveDeparture <= now) return true
    return fix != null && now - fix.at <= MovingFixFreshMillis && trainSpeed(fix, previousFix)
}

/** Writes [record], taken at its own `at`, unless the stored record could still be ridden and this one cannot erase it. */
fun UserData.withLastAnswer(record: LastAnswer, sightingAt: Long?): UserData =
    if (replacesLastAnswer(this, record.stationId, record.at, sightingAt)) copy(lastAnswer = record) else this

// Seen at the origin a minute after the snapshot's train left, the rider did not board it.
fun retiresSnapshot(data: UserData, snapshot: LastAnswer?, incomingStationId: String?, sightingAt: Long?): Boolean {
    val trip = snapshot?.let { data.trips.find { trip -> trip.id == it.tripId } } ?: return false
    return incomingStationId != null && incomingStationId == trip.ends(snapshot.reverse).first.id &&
        sightingAt != null && sightingAt >= snapshot.journey.effectiveDeparture + HoldSightingAfterMillis
}

fun inferenceDeclined(data: UserData, tripId: String, now: Long, journey: Journey? = null): Boolean {
    val decline = data.inferenceDeclined?.takeIf { it.tripId == tripId } ?: return false
    return journey?.departureKey == decline.departure || now < maxOf(decline.at + DeclineHoldMillis, decline.arrival + TravelLateMillis)
}

fun UserData.declining(focus: FocusedJourney, now: Long): UserData = copy(inferenceDeclined = InferenceDecline(
    focus.tripId, focus.reverse, now, focus.journey.departureKey, focus.composed.effectiveArrival))

/** Home offers Start trip for its train in the window auto-start reads as "seen at the platform". */
fun startable(journey: Journey, now: Long): Boolean =
    !journey.cancelled && journey.effectiveDeparture - now in 0..TravelSeenMillis

/** A board row on its way starts trip mode at once; upcoming and arrived rows open detail. */
fun runningJourney(journey: Journey, now: Long, modes: Set<String>, maxTransfers: Int?): Boolean =
    journey.effectiveDeparture <= now && now < journey.effectiveArrival && !journey.cancelled &&
        journeyAllowed(journey, modes) && journey.withinTransferCap(maxTransfers)

internal fun FocusedJourney.sameService(other: FocusedJourney): Boolean =
    tripId == other.tripId && reverse == other.reverse && journey.key == other.journey.key

/** Starting the guessed journey itself keeps its arrival evidence; any other start replaces the focus. */
fun UserData.withTripStarted(started: FocusedJourney): UserData =
    copy(focus = focus?.takeIf { it.sameService(started) }?.copy(pinned = true) ?: started)

fun savedLeg(data: UserData, from: Station, to: Station): TripDirection? = data.trips.firstNotNullOfOrNull { trip ->
    listOf(false, true).firstOrNull { reverse -> trip.ends(reverse).let { it.first.id == from.id && it.second.id == to.id } }
        ?.let { TripDirection(trip.id, it) }
}

fun UserData.withTripStopped(now: Long): UserData {
    val stopped = focus ?: return this
    // Started trips decline too: the next train-speed fix would guess them back in.
    val owner = if (stopped.pinned) savedLeg(this, stopped.board.from, stopped.board.to) else TripDirection(stopped.tripId, stopped.reverse)
    val cleared = copy(focus = null)
    return owner?.let { cleared.declining(stopped.copy(tripId = it.tripId, reverse = it.reverse), now) } ?: cleared
}

// Evidence for another train survives the expiry.
fun UserData.withFocusExpired(expired: FocusedJourney): UserData = copy(focus = null, lastAnswer = lastAnswer?.takeUnless {
    it.tripId == expired.tripId && it.reverse == expired.reverse && it.journey.key == expired.journey.key
})

fun rideRecorded(data: UserData, tripId: String, reverse: Boolean, journey: Journey): Boolean =
    data.rides.any { it.tripId == tripId && it.reverse == reverse && it.departure == journey.departure }

// Snapshot first keeps the proven auto-start intact; the stored record only adds entries.
fun inferFromRecords(data: UserData, snapshot: LastAnswer?, now: Long, fix: Fix): FocusedJourney? =
    listOfNotNull(snapshot, data.lastAnswer).firstNotNullOfOrNull { record ->
        if (inferenceDeclined(data, record.tripId, now, record.journey) || !record.journey.withinTransferCap(data.maxTransfers)) null
        else inferredFocus(data.copy(lastAnswer = record), fix, now)
    }

// Rhodes → Redfern and Town Hall → Rhodes bend to 1.27 and 1.2 of the straight line.
const val CorridorRatio = 1.5
const val HeadingWindowDegrees = 90.0
const val ClosingMetres = 200.0
const val OnBoardCandidates = 3
const val OnBoardLimit = 10
const val OnBoardTimetableLimit = 30
const val OnBoardLookbackMarginMillis = 10 * 60_000L
const val OnBoardDefaultRideMillis = 60 * 60_000L
// Eight-minute headways on a 25-minute ride put neighbouring services 0.32 apart.
const val ProgressWindow = 0.25

data class TripDirection(val tripId: String, val reverse: Boolean)

/** One departures request, and one timetable plan, for the services a decided candidate trip could be riding. */
data class OnBoardRequest(val trip: TripDirection, val from: Station, val to: Station, val at: Long, val limit: Int)

data class OnBoardMatch(val trip: TripDirection, val journey: Journey)

private fun bearingDegrees(from: Fix, to: Station): Double {
    val rad = PI / 180
    val dLon = (to.lon - from.lon) * rad
    val y = sin(dLon) * cos(to.lat * rad)
    val x = cos(from.lat * rad) * sin(to.lat * rad) - sin(from.lat * rad) * cos(to.lat * rad) * cos(dLon)
    return (atan2(y, x) / rad + 360) % 360
}

private fun turn(a: Double, b: Double) = abs(((a - b) % 360 + 540) % 360 - 180)

/** Each test decides only when exactly one direction passes it; with neither, the candidate waits for the next fix. */
private fun directionOf(trip: SavedTrip, fix: Fix, previousFix: Fix?): Boolean? {
    fun pick(test: (Station) -> Boolean) = listOf(false, true).singleOrNull { reverse -> test(trip.ends(reverse).second) }
    fix.bearing?.takeIf { it.isFinite() }?.let { heading ->
        pick { turn(heading, bearingDegrees(fix, it)) <= HeadingWindowDegrees }?.let { return it }
    }
    if (previousFix == null || !previousFixUsable(fix, previousFix)) return null
    return pick { distanceMetres(previousFix, it) - distanceMetres(fix, it) >= ClosingMetres }
}

fun onBoardRequests(data: UserData, now: Long, fix: Fix?, previousFix: Fix?, cached: Map<TripDirection, List<Journey>>): List<OnBoardRequest> {
    if (fix == null || !trainSpeed(fix, previousFix)) return emptyList()
    class Candidate(val trip: SavedTrip, val index: Int, val reverse: Boolean, val ratio: Double)
    val candidates = data.trips.filter { compatible(it, data.modes) }.mapIndexedNotNull { index, trip ->
        val fromOrigin = distanceMetres(fix, trip.from)
        val toDestination = distanceMetres(fix, trip.to)
        val span = distanceMetres(trip.from, trip.to)
        val ratio = (fromOrigin + toDestination) / span
        if (!ratio.isFinite() || fromOrigin < TravelMovedMetres || toDestination < TravelMovedMetres || ratio > CorridorRatio ||
            inferenceDeclined(data, trip.id, now)) return@mapIndexedNotNull null
        directionOf(trip, fix, previousFix)?.let { Candidate(trip, index, it, ratio) }
    }
    return candidates.sortedWith(compareBy<Candidate>({ it.ratio }, { it.index })).take(OnBoardCandidates).map { candidate ->
        val key = TripDirection(candidate.trip.id, candidate.reverse)
        val durations = cached[key].orEmpty().map { it.effectiveArrival - it.effectiveDeparture }.filter { it >= 0 }.sorted()
        // The median, lower middle for an even count: one long offline itinerary cannot push the window past every service.
        val ride = durations.getOrNull((durations.size - 1) / 2) ?: OnBoardDefaultRideMillis
        val (from, to) = candidate.trip.ends(candidate.reverse)
        OnBoardRequest(key, from, to, now - (ride + OnBoardLookbackMarginMillis), OnBoardLimit)
    }
}

/** The running service whose progress in time best matches the fix's progress along the trip, or null. */
fun inferOnBoard(data: UserData, now: Long, fix: Fix, previousFix: Fix?, boards: Map<TripDirection, List<Journey>>,
                 cached: Map<TripDirection, List<Journey>>): OnBoardMatch? {
    if (data.focus != null) return null
    class Match(val trip: TripDirection, val journey: Journey, val score: Double, val gap: Double, val order: Int)
    val matches = onBoardRequests(data, now, fix, previousFix, cached).flatMap { request ->
        val trip = request.trip
        val fromOrigin = distanceMetres(fix, request.from)
        val position = fromOrigin / (fromOrigin + distanceMetres(fix, request.to))
        val score = historyScore(data.history, trip.tripId, trip.reverse, now)
        val order = data.trips.indexOfFirst { it.id == trip.tripId }
        boards[trip].orEmpty().mapNotNull { journey ->
            val departure = journey.effectiveDeparture
            val arrival = journey.effectiveArrival
            if (departure > now || now > arrival || departure >= arrival || journey.cancelled || !journeyAllowed(journey, data.modes) ||
                !journey.withinTransferCap(data.maxTransfers) || rideRecorded(data, trip.tripId, trip.reverse, journey) ||
                inferenceDeclined(data, trip.tripId, now, journey)) return@mapNotNull null
            val gap = abs((now - departure).toDouble() / (arrival - departure) - position)
            Match(trip, journey, score, gap, order).takeIf { gap <= ProgressWindow }
        }
    }
    // History separates saved trips that share a train.
    return matches.sortedWith(compareByDescending<Match> { it.score }.thenBy { it.gap }
        .thenComparator { a, b -> compareJourneyIdentity(a.journey, b.journey) }.thenBy { it.order }.thenBy { it.trip.reverse })
        .firstOrNull()?.let { OnBoardMatch(it.trip, it.journey) }
}
