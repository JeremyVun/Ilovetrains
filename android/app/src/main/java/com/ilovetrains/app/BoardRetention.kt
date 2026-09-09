package com.ilovetrains.app

private const val PAST_RETENTION = 24 * 60 * 60_000L

internal fun BoardData.lastKnown(): BoardData {
    fun retainedSource(source: BoardData) = source.copy(offline = true,
        journeys = source.journeys.map { it.copy(retained = true) }, recommendationPages = emptyList(), recommendation = null)
    return copy(
        offline = true,
        journeys = journeys.map { it.copy(retained = true) },
        recommendationPages = recommendationPages.map { page -> page.copy(body = retainedSource(page.body)) },
        recommendation = recommendation?.let { result -> RecommendationResult(
            result.journey.copy(retained = true), retainedSource(result.source)) },
    )
}

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
    return (board.journeys + listOfNotNull(board.recommendation?.journey))
        .find { it.key == board.homeJourneyKey && now <= it.effectiveArrival + 30 * 60_000L }
}

fun nextHomeJourney(board: BoardData, now: Long): Journey? = retainedHomeJourney(board, now)
    ?: board.recommendation?.journey?.takeIf { !it.cancelled && it.effectiveDeparture >= now }
    ?: selectRecommendation(board.recommendationCandidates(now), now)?.journey

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
    val retainedAnswer = prior?.copy(offline = base.offline)?.let { retainedHomeJourney(it, now) }
    val selectedRecommendation = when {
        online != null -> online.recommendation ?: selectRecommendation(online.recommendationCandidates(now), now)?.let {
            RecommendationResult(it.journey, it.source)
        }
        retainedAnswer != null -> RecommendationResult(
            rows[retainedAnswer.key] ?: retainedAnswer.copy(retained = true),
            (prior.recommendation?.source?.takeIf { prior.recommendation.journey.key == retainedAnswer.key } ?: prior).lastKnown())
        local != null -> local.recommendation ?: selectRecommendation(local.recommendationCandidates(now), now)?.let {
            RecommendationResult(it.journey, it.source)
        }
        else -> prior?.recommendation
    }
    val recommendation = selectedRecommendation?.let { selected ->
        val priorSource = prior?.recommendation?.takeIf { it.journey.key == selected.journey.key }?.source ?: prior
        val known = prior?.recommendation?.journey?.takeIf { it.key == selected.journey.key }
            ?: prior?.journeys?.find { it.key == selected.journey.key }
        if (online == null && known != null && (known.realtime || known.cancelled) &&
            !(selected.source.isLive(now) && selected.journey.realtime) && priorSource != null) {
            RecommendationResult(known.copy(retained = true), priorSource.lastKnown())
        } else selected
    }
    val merged = base.copy(journeys = rows.values.sortedBy { it.effectiveDeparture }, homeJourneyKey = prior?.homeJourneyKey,
        recommendation = recommendation)
    return merged.copy(homeJourneyKey = nextHomeJourney(merged, now)?.key)
}
