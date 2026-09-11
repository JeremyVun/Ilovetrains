package com.ilovetrains.app

import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

data class FocusStatus(val text: String, val warning: Boolean, val late: Boolean = false)

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
): BoardData? = focus?.takeIf { it.journey.key == journey.key }?.board
    ?: focus?.alternatives?.sourceForJourney(journey)
    ?: homeBoard?.sourceForJourney(journey)
    ?: board?.sourceForJourney(journey)
    ?: homeBoard ?: board

fun BoardData.sourceForJourney(journey: Journey): BoardData? =
    recommendation?.takeIf { it.journey.key == journey.key }?.source
        ?: (listOf(this) + recommendationPages.map { it.body })
            .filter { source -> source.journeys.any { it.key == journey.key } }.maxByOrNull { it.generatedAt }

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

fun isTightChange(journey: Journey, changeIndex: Int, recoveryFrom: Int? = null): Boolean {
    if (changeIndex !in 0 until journey.legs.lastIndex) return false
    val printed = recoveryFrom == null || changeIndex < recoveryFrom
    return connectionState(journey.legs, changeIndex, printed) in setOf(ConnectionState.Tight, ConnectionState.Lost)
}

fun relevantLeg(journey: Journey, now: Long): Leg? =
    journey.legs.firstOrNull { now < it.effectiveArrival } ?: journey.legs.lastOrNull()

fun focusStatus(focus: FocusedJourney, now: Long, complete: Boolean, arrival: ArrivalResult? = null): FocusStatus {
    val journey = focus.composed
    if (complete || arrival?.state == ArrivalState.Arrived) return FocusStatus("Trip over", false)
    if (arrival?.state == ArrivalState.CheckingArrival) return FocusStatus("Checking arrival", false)
    if (arrival?.state == ArrivalState.ArrivalUnconfirmed) return FocusStatus(
        if (arrival.moving) "Arrival uncertain" else "Arrival unconfirmed", arrival.moving)
    if (journey.cancelled) return FocusStatus("Cancelled", true)
    val active = relevantLeg(journey, now)
    val delay = maxOf(
        active?.estimatedDeparture?.let { minutesBetween(active.departure, it) } ?: 0,
        active?.estimatedArrival?.let { minutesBetween(active.arrival, it) } ?: 0,
    )
    val currentObservation = focus.board.source == "live" && !focus.board.offline && !journey.retained &&
        now - focus.board.generatedAt in 0..90_000
    val late = currentObservation && delay > 0
    if (focus.lostConnectionAhead(now)) {
        return FocusStatus(if (late) "Late · Connection gone" else "Connection gone", true, late)
    }
    if (late) return FocusStatus("Running late", true, true)
    if (focus.pinned && now < journey.effectiveDeparture) return FocusStatus("Pinned", false)
    return FocusStatus("Running", false)
}

fun savedTripFocusStatus(focus: FocusedJourney, now: Long, complete: Boolean, arrival: ArrivalResult? = null): String {
    val status = focusStatus(focus, now, complete, arrival).text
    val labelled = focus.pinned && status != "Pinned" && !focus.lostConnectionAhead(now)
    return if (labelled) "$status · Pinned" else status
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
    val observed = observedSources.filter { source ->
        source.isLive(now) && source.journeys.any { it == lead && !it.retained }
    }.maxByOrNull { it.generatedAt } ?: return null
    return ShownLeadEvidence(observed, lead)
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

data class FocusArrivalClocks(val shown: String? = null, val struck: String? = null, val planned: String? = null)

data class FocusHeader(
    val journey: Journey,
    val recoveryFrom: Int?,
    val status: FocusStatus,
    val pinIcon: Boolean,
    val pinWord: Boolean,
    val changeLabels: List<String>,
    val receipt: String,
    val instruction: String,
    val warnInstruction: Boolean,
    val arrival: FocusArrivalClocks,
    val figure: Figure,
)

fun changeStationLabel(journey: Journey, changeIndex: Int): String {
    val leg = journey.legs[changeIndex]
    val next = journey.legs[changeIndex + 1]
    return if (leg.to.id == next.from.id) leg.to.shortName else "${leg.to.shortName} → ${next.from.shortName}"
}

fun changeLabel(journey: Journey, changeIndex: Int, recoveryFrom: Int?): String {
    val station = changeStationLabel(journey, changeIndex)
    if (recoveryFrom == null || changeIndex < recoveryFrom) return station
    val next = journey.legs[changeIndex + 1]
    val service = next.line.takeIf { it.isNotBlank() }?.let { "$it " }.orEmpty()
    return "$station · $service${clockTime(next.effectiveDeparture)}"
}

/** Without the line code the label still names the station and the service it boards. */
fun shortChangeLabel(journey: Journey, changeIndex: Int, recoveryFrom: Int?): String {
    if (recoveryFrom == null || changeIndex < recoveryFrom) return changeLabel(journey, changeIndex, recoveryFrom)
    return "${changeStationLabel(journey, changeIndex)} · ${clockTime(journey.legs[changeIndex + 1].effectiveDeparture)}"
}

/** Before departure the home figure stays the displayed board's; the focus header's figure is the riding one. */
fun homeHeaderFigure(header: FocusHeader?, departed: Boolean, board: Figure): Figure =
    header?.figure?.takeIf { departed } ?: board

fun focusHeader(focus: FocusedJourney, now: Long, complete: Boolean = false, arrival: ArrivalResult? = null): FocusHeader {
    val followed = focus.journey
    val composed = focus.composed
    val recoveryFrom = focus.recovery?.takeIf { recoveryApplies(followed, it) }?.changeIndex
    val states = connectionStates(composed, recoveryFrom)
    val lost = focus.lostConnectionAhead(now)
    val status = focusStatus(focus, now, complete, arrival)
    val completed = complete || arrival?.state == ArrivalState.Arrived
    val departed = now >= composed.effectiveDeparture
    val overdue = departed && now >= composed.effectiveArrival && !completed
    val figure = when {
        overdue -> {
            val past = ((now - composed.effectiveArrival) / 60_000).toInt()
            val moving = arrival?.moving == true && past > 0
            Figure(if (moving) past.toString() else "—", if (moving) "min" else "",
                if (moving) "Past estimate" else "Last estimate", past = true)
        }
        departed && !completed -> directionFigureFor(composed, now) ?: figureFor(composed, focus.board, now)
        else -> figureFor(composed, focus.board, now)
    }

    val cancelledIndex = composed.legs.indexOfFirst { it.cancelled }.takeIf { it > 0 }
    val ridingCancelled = cancelledIndex != null && departed && now < composed.effectiveArrival
    val risk = states.indices.firstOrNull {
        states[it] == ConnectionState.Tight && now < composed.legs[it + 1].effectiveDeparture
    }
    val stranded = states.indexOfFirst { it == ConnectionState.Lost }.takeIf { it >= 0 }
    val instruction = when {
        ridingCancelled -> composed.legs[cancelledIndex!!].let {
            "${clockTime(it.effectiveDeparture)} from ${it.from.shortName} cancelled"
        }
        lost && stranded != null ->
            "The ${composed.legs[stranded].line} arrives too late for the " +
                clockTime(composed.legs[stranded + 1].effectiveDeparture)
        risk != null -> composed.legs[risk + 1].let {
            "Tight change · ${minutesBetween(composed.legs[risk].effectiveArrival, it.effectiveDeparture)} min" +
                placeClause(it.fromPlatform, it.mode)
        }
        else -> focusedInstruction(composed, now, recoveryFrom)
    }

    val receipt = when {
        composed.cancelled -> ""
        !lost -> if (risk != null && shrunkChange(composed, risk, recoveryFrom)) {
            "Printed change was ${minutesBetween(composed.legs[risk].arrival, composed.legs[risk + 1].departure)} min."
        } else ""
        stranded != null -> "Check the station boards."
        else -> recoveryReceipt(followed).orEmpty()
    }

    val arrivalClocks = when {
        composed.legs.last().cancelled -> FocusArrivalClocks(struck = clockTime(composed.effectiveArrival))
        lost && stranded != null -> FocusArrivalClocks(planned = clockTime(followed.effectiveArrival))
        recoveryFrom != null -> FocusArrivalClocks(
            shown = clockTime(composed.effectiveArrival), struck = clockTime(followed.effectiveArrival))
        else -> FocusArrivalClocks(shown = clockTime(composed.effectiveArrival))
    }

    return FocusHeader(
        journey = composed,
        recoveryFrom = recoveryFrom,
        status = status,
        pinIcon = focus.pinned,
        pinWord = focus.pinned && !lost,
        changeLabels = states.indices.map { changeLabel(composed, it, recoveryFrom) },
        receipt = receipt,
        instruction = instruction,
        warnInstruction = ridingCancelled || (lost && stranded != null),
        arrival = arrivalClocks,
        figure = figure,
    )
}

private fun shrunkChange(journey: Journey, changeIndex: Int, recoveryFrom: Int?): Boolean {
    if (recoveryFrom != null && changeIndex >= recoveryFrom) return false
    val before = journey.legs[changeIndex]
    val after = journey.legs[changeIndex + 1]
    return minutesBetween(before.effectiveArrival, after.effectiveDeparture) <
        minutesBetween(before.arrival, after.departure)
}

fun focusedInstruction(journey: Journey, now: Long, recoveryFrom: Int? = null): String {
    journey.legs.forEachIndexed { index, leg ->
        if (now < leg.effectiveArrival) {
            return "Get off at ${leg.to.shortName}${placeClause(leg.toPlatform, leg.mode)}"
        }
        val next = journey.legs.getOrNull(index + 1) ?: return@forEachIndexed
        if (now < next.effectiveDeparture) {
            val recovered = recoveryFrom != null && index >= recoveryFrom
            val place = placeClause(next.fromPlatform, next.mode)
            return if (recovered) "Board the ${clockTime(next.effectiveDeparture)} at ${next.from.shortName}$place"
            else "Change at ${next.from.shortName}$place"
        }
    }
    val last = journey.legs.last()
    return "Get off at ${last.to.shortName}${placeClause(last.toPlatform, last.mode)}"
}

private fun placeClause(raw: String?, mode: String): String {
    val place = platformText(raw, mode, full = true) ?: return ""
    return " · $place"
}

fun recoveryReceipt(followed: Journey): String? {
    val lost = lostChangeIndex(followed) ?: return null
    val before = followed.legs[lost]
    val after = followed.legs[lost + 1]
    return "The ${before.line} arrives at ${clockTime(before.effectiveArrival)}, " +
        "but the ${after.line} left at ${clockTime(after.effectiveDeparture)}."
}
