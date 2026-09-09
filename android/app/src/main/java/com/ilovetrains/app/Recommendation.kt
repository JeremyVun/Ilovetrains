package com.ilovetrains.app

const val TransferPenaltyMillis = 300_000L
private const val RecommendationBucketMillis = 600_000L
private const val RecommendationFutureLimitMillis = 7_200_000L

data class RecommendationCandidate(val journey: Journey, val source: BoardData, val stale: Boolean)

fun recommendationCost(journey: Journey): Long? = recommendationTuple(journey)?.cost

fun compareRecommendations(first: Journey, second: Journey): Int {
    val left = recommendationTuple(first)
    val right = recommendationTuple(second)
    if (left == null || right == null) return if (left != null) -1 else if (right != null) 1 else 0
    compareValues(left.cost, right.cost).takeIf { it != 0 }?.let { return it }
    compareValues(left.changes, right.changes).takeIf { it != 0 }?.let { return it }
    compareValues(left.arrival, right.arrival).takeIf { it != 0 }?.let { return it }
    compareValues(left.departure, right.departure).takeIf { it != 0 }?.let { return it }
    for (index in 0 until minOf(left.identity.size, right.identity.size)) {
        compareCodePoints(left.identity[index].first, right.identity[index].first).takeIf { it != 0 }?.let { return it }
        compareValues(left.identity[index].second, right.identity[index].second).takeIf { it != 0 }?.let { return it }
    }
    return compareValues(left.identity.size, right.identity.size)
}

fun selectRecommendation(
    candidates: List<RecommendationCandidate>,
    now: Long,
    modes: Set<String> = AllModes,
    maxTransfers: Int? = null,
): RecommendationCandidate? {
    val eligible = candidates.filter { candidate ->
        recommendationTuple(candidate.journey) != null && candidate.journey.effectiveDeparture >= now &&
            journeyAllowed(candidate.journey, modes) && candidate.journey.withinTransferCap(maxTransfers)
    }
    val pool = eligible.filterNot(RecommendationCandidate::stale).ifEmpty { eligible }
    return pool.minWithOrNull { a, b -> compareRecommendations(a.journey, b.journey) }
}

fun earliestAlternative(
    candidates: List<RecommendationCandidate>,
    recommended: Journey,
    now: Long,
    modes: Set<String> = AllModes,
    maxTransfers: Int? = null,
): RecommendationCandidate? {
    val identity = firstServiceIdentity(recommended)
    return candidates.asSequence().filter { candidate ->
        val journey = candidate.journey
        recommendationTuple(journey) != null && journey.effectiveDeparture >= now &&
            journeyAllowed(journey, modes) && journey.withinTransferCap(maxTransfers) && firstServiceIdentity(journey) != identity
    }.minWithOrNull { a, b ->
        compareValues(a.journey.effectiveDeparture, b.journey.effectiveDeparture).takeIf { it != 0 }
            ?: compareRecommendations(a.journey, b.journey)
    }
}

fun nextRecommendationCursor(page: BoardData, previousAt: Long, now: Long, best: Journey?): Long? {
    val greatest = page.journeys.maxOfOrNull(Journey::effectiveDeparture) ?: return null
    val cursor = (greatest / RecommendationBucketMillis + 1) * RecommendationBucketMillis
    val cost = best?.let(::recommendationCost)
    return cursor.takeIf { it > previousAt && it <= now + RecommendationFutureLimitMillis && (cost == null || it <= cost) }
}

fun BoardData.recommendationCandidates(now: Long, current: TransferConstraint? = fetchConstraint): List<RecommendationCandidate> {
    val rows = linkedMapOf<String, RecommendationCandidate>()
    fun add(source: BoardData, stale: Boolean) {
        source.journeys.forEach { journey ->
            val candidate = RecommendationCandidate(journey, source, stale || !source.isLive(now) || journey.retained)
            val previous = rows[journey.key]
            if (previous == null || source.generatedAt > previous.source.generatedAt ||
                source.generatedAt == previous.source.generatedAt && previous.stale && !candidate.stale) rows[journey.key] = candidate
        }
    }
    add(this, fetchConstraint != current || offline || serverStale)
    recommendationPages.forEach { page ->
        add(page.body, page.constraint != current || page.serverStale || page.body.offline)
    }
    recommendation?.let { result ->
        add(result.source.copy(journeys = listOf(result.journey)), result.source.fetchConstraint != current)
    }
    return rows.values.toList()
}

private data class RecommendationTuple(
    val cost: Long,
    val changes: Int,
    val arrival: Long,
    val departure: Long,
    val identity: List<Pair<String, Long>>,
)

private fun recommendationTuple(journey: Journey): RecommendationTuple? {
    if (journey.legs.isEmpty() || journey.cancelled) return null
    if (journey.legs.any { it.cancelled || it.arrival < it.departure || it.effectiveArrival < it.effectiveDeparture }) return null
    if (journey.legs.zipWithNext().any { (previous, next) -> next.effectiveDeparture < previous.effectiveArrival }) return null
    val arrival = journey.effectiveArrival
    val departure = journey.effectiveDeparture
    if (arrival < departure) return null
    val changes = journey.legs.size - 1
    val penalty = runCatching { Math.multiplyExact(changes.toLong(), TransferPenaltyMillis) }.getOrNull() ?: return null
    val cost = runCatching { Math.addExact(arrival, penalty) }.getOrNull() ?: return null
    return RecommendationTuple(cost, changes, arrival, departure, journey.legs.map { it.line to it.departure })
}

private fun firstServiceIdentity(journey: Journey): Pair<String, Long>? = journey.legs.firstOrNull()?.let { it.line to it.departure }

internal fun compareCodePoints(first: String, second: String): Int {
    var a = 0
    var b = 0
    while (a < first.length && b < second.length) {
        val left = first.codePointAt(a)
        val right = second.codePointAt(b)
        if (left != right) return compareValues(left, right)
        a += Character.charCount(left)
        b += Character.charCount(right)
    }
    return compareValues(first.codePointCount(0, first.length), second.codePointCount(0, second.length))
}
