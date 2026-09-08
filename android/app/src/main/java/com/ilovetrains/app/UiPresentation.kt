package com.ilovetrains.app

import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

data class FocusStatus(val text: String, val warning: Boolean)

fun journeyAllowed(journey: Journey, modes: Set<String>): Boolean =
    modes.isNotEmpty() && journey.legs.isNotEmpty() && journey.legs.all { it.mode.lowercase(Locale.ENGLISH) in modes }

fun sameDeparture(first: Journey, second: Journey): Boolean {
    val a = first.legs.firstOrNull() ?: return false
    val b = second.legs.firstOrNull() ?: return false
    return a.line == b.line && a.departure == b.departure
}

fun redirectOrigin(focus: FocusedJourney, trips: List<SavedTrip>): Station? {
    val trip = trips.firstOrNull { it.id == focus.tripId } ?: return null
    return if (focus.reverse) trip.to else trip.from
}

fun boardForOpenedJourney(
    focus: FocusedJourney?,
    homeBoard: BoardData?,
    board: BoardData?,
    journey: Journey,
): BoardData? = focus?.alternatives?.takeIf { alternatives ->
    journey.key != focus.journey.key && alternatives.journeys.any { it.key == journey.key }
} ?: homeBoard ?: board

fun focusAfterRefresh(focus: FocusedJourney, update: FocusedRefresh?, alternatives: BoardData?): FocusedJourney {
    if (update == null || update.journey.key != focus.journey.key || update.journey.legs.size != focus.journey.legs.size) {
        return focus.lastKnown().copy(alternatives = alternatives ?: focus.alternatives)
    }
    val merged = Journey(focus.journey.legs.mapIndexed { index, leg ->
        update.journey.legs[index].takeIf { index in update.matchedLegIndices } ?: leg
    })
    if (!update.live) {
        val retained = merged.copy(retained = true)
        return focus.copy(
            journey = retained,
            board = focus.board.copy(
                journeys = listOf(retained),
                generatedAt = minOf(focus.board.generatedAt, update.observedAt ?: focus.board.generatedAt),
                offline = true,
            ),
            alternatives = alternatives ?: focus.alternatives,
        )
    }
    return focus.copy(journey = merged, board = focus.board.copy(
        journeys = listOf(merged),
        generatedAt = update.observedAt ?: focus.board.generatedAt,
        source = "live",
        offline = false,
        serverStale = false,
    ), alternatives = alternatives ?: focus.alternatives)
}

fun showAlightingPin(legCount: Int, changeIndex: Int): Boolean = legCount <= 2 || changeIndex == 0

fun isTightChange(journey: Journey, changeIndex: Int): Boolean =
    !journey.cancelled && changeIndex in 0 until journey.legs.lastIndex &&
        minutesBetween(journey.legs[changeIndex].effectiveArrival, journey.legs[changeIndex + 1].effectiveDeparture) < 5

fun focusStatus(focus: FocusedJourney, now: Long, complete: Boolean): FocusStatus {
    val journey = focus.journey
    if (complete || now >= journey.effectiveArrival) return FocusStatus("Trip over", false)
    if (journey.cancelled) return FocusStatus("Cancelled", true)
    val active = journey.legs.firstOrNull { now < it.effectiveArrival } ?: journey.legs.lastOrNull()
    val delay = active?.estimatedDeparture?.let { minutesBetween(active.departure, it) } ?: 0
    val currentObservation = focus.board.source == "live" && !focus.board.offline && !journey.retained &&
        now - focus.board.generatedAt in 0..90_000
    if (currentObservation && delay > 0) return FocusStatus("Running late", true)
    if (focus.pinned && now < journey.effectiveDeparture) return FocusStatus("Pinned", false)
    return FocusStatus("Running", false)
}

fun savedTripFocusStatus(focus: FocusedJourney, now: Long, complete: Boolean): String {
    val status = focusStatus(focus, now, complete).text
    return if (focus.pinned && status != "Pinned") "$status · Pinned" else status
}

fun figureToken(figure: Figure): String = figure.value + if (figure.unit == "H") "H" else ""

fun wideFigure(figure: Figure): Boolean = figureToken(figure).length >= 3

fun nextServiceFigure(journey: Journey, board: BoardData, now: Long): String {
    val figure = figureFor(journey, board, now)
    if (figure.value.isEmpty()) return ""
    return when (figure.unit) {
        "H" -> figure.value + figure.unit
        "min" -> "${figure.value} min"
        else -> figure.value
    }
}

data class ShownLeadEvidence(val board: BoardData, val journey: Journey)

fun shownLeadEvidence(
    board: BoardData,
    observedSources: List<BoardData>,
    now: Long,
    suppressed: Boolean,
): ShownLeadEvidence? {
    if (suppressed) return null
    val lead = nextHomeJourney(board, now)?.takeUnless { it.retained } ?: return null
    val observed = observedSources.any { source ->
        source.isLive(now) && source.journeys.any { it.key == lead.key && !it.retained }
    }
    return if (observed) ShownLeadEvidence(board, lead) else null
}

fun shouldCastHomeVote(screen: Screen, hasTrips: Boolean, station: Station?, alreadyVoted: Boolean): Boolean =
    screen == Screen.Home && hasTrips && station != null && !alreadyVoted

fun distanceText(metres: Int): String = when {
    metres < 1_000 -> "${max(10, (metres / 10.0).roundToInt() * 10)} m"
    metres < 10_000 -> String.format(Locale.ROOT, "%.1f km", metres / 1_000.0)
    else -> "${(metres / 1_000.0).roundToInt()} km"
}

fun stationFuzzyScore(value: String, query: String): Int {
    val haystack = value.lowercase(Locale.ENGLISH)
    val needle = query.trim().lowercase(Locale.ENGLISH)
    if (needle.isEmpty()) return 0
    val direct = haystack.indexOf(needle)
    if (direct >= 0) return 10_000 - direct * 10 - haystack.length
    var at = 0
    var gaps = 0
    for (character in needle) {
        val next = haystack.indexOf(character, at)
        if (next < 0) return 0
        gaps += next - at
        at = next + 1
    }
    return 1_000 - gaps * 10 - haystack.length
}

fun nearestStation(stations: List<Station>, fix: Fix, withinMetres: Double = 2_000.0): Station? =
    stations.asSequence()
        .map { it to distanceMetres(fix, it) }
        .filter { it.second.isFinite() && it.second <= withinMetres }
        .minByOrNull { it.second }
        ?.first

fun mergeEarlier(current: List<Journey>, earlier: List<Journey>): List<Journey> {
    val merged = linkedMapOf<String, Journey>()
    earlier.forEach { merged[it.key] = it }
    current.forEach { merged[it.key] = it }
    return merged.values.sortedBy { it.effectiveDeparture }
}

fun justAddedDistance(metadata: String): String =
    metadata.split(" · ").firstOrNull { it.endsWith(" away") }.orEmpty()
