package com.ilovetrains.app

private const val PAST_RETENTION = 24 * 60 * 60_000L

internal fun BoardData.lastKnown() = copy(offline = true, journeys = journeys.map { it.copy(retained = true) })

internal fun FocusedJourney.lastKnown() = copy(journey = journey.copy(retained = true), board = board.lastKnown())

/** A board that never knew a locally identified journey cannot demote it; the realtime overlay owns that one. */
internal fun FocusedJourney.demotedForUnmatchedBoard(): FocusedJourney? =
    if (journey.legs.all { it.identity != null }) null else lastKnown()

/** The overlay is the only refresh a locally identified journey has, so losing its match is last known now. */
internal fun FocusedJourney.demotedForLostOverlay(): FocusedJourney? =
    if (journey.legs.all { it.identity != null }) lastKnown() else null

/** An offline open keeps the answer the rider last saw, without inferring a ride. */
fun retainedHomeJourney(board: BoardData?, now: Long): Journey? {
    if (board == null || !board.offline) return null
    return board.journeys.find { it.key == board.homeJourneyKey && now <= it.effectiveArrival + 30 * 60_000L }
}

fun nextHomeJourney(board: BoardData, now: Long): Journey? = retainedHomeJourney(board, now)
    ?: board.journeys.firstOrNull { !it.cancelled && it.effectiveDeparture >= now }
    ?: board.journeys.firstOrNull { it.effectiveDeparture >= now }

/** Online answers own future services. A failed request cannot erase a saved service. */
internal fun mergeBoardResults(
    previous: BoardData?,
    local: BoardData?,
    online: BoardData?,
    now: Long,
    requestFailed: Boolean = online == null,
): BoardData? {
    val base = online ?: local?.takeIf { it.isLive(now) && it.journeys.isNotEmpty() }
        ?: previous?.takeIf { it.journeys.isNotEmpty() }?.copy(offline = previous.offline || requestFailed)
        ?: local ?: return null
    val prior = previous?.takeIf { it.from.id == base.from.id && it.to.id == base.to.id }
    val rows = linkedMapOf<String, Journey>()
    fun recent(journey: Journey) = journey.effectiveDeparture >= now - PAST_RETENTION
    // Scheduled planning cannot replace a previously observed delay with the printed timetable.
    local?.journeys?.filter { recent(it) && (online == null || it.effectiveDeparture < now) }
        ?.forEach { rows[it.key] = it }
    prior?.journeys?.filter { recent(it) && (online == null || it.effectiveDeparture < now) }
        ?.forEach { rows[it.key] = it.copy(retained = true) }
    local?.takeIf { it.isLive(now) }?.journeys?.filter { recent(it) && it.realtime && (online == null || it.effectiveDeparture < now) }
        ?.forEach { rows[it.key] = it }
    online?.journeys?.forEach { rows[it.key] = it }
    val merged = base.copy(journeys = rows.values.sortedBy { it.effectiveDeparture }, homeJourneyKey = prior?.homeJourneyKey)
    return merged.copy(homeJourneyKey = nextHomeJourney(merged, now)?.key)
}
