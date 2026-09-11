package com.ilovetrains.app

enum class ConnectionState { Ordinary, Tight, Lost, Broken }

data class RecoverySource(val generatedAt: Long, val degraded: Boolean = false)

data class Recovery(
    val changeIndex: Int,
    val journey: Journey,
    val fetchedAt: Long,
    val source: RecoverySource,
)

data class RecoverySearch(val from: Station, val to: Station, val at: Long)

data class RecoveryPlan(
    val composed: Journey,
    val recovery: Recovery?,
    val anchor: Int?,
    val search: RecoverySearch?,
)

const val TightChangeMinutes = 5
const val RecoveryConnectionFloor = 3

fun connectionState(legs: List<Leg>, index: Int, printed: Boolean = true): ConnectionState {
    val before = legs[index]
    val after = legs[index + 1]
    if (before.cancelled || after.cancelled) return ConnectionState.Broken
    val window = minutesBetween(before.effectiveArrival, after.effectiveDeparture)
    if (window <= 0) return ConnectionState.Lost
    val shrunk = printed && window < minutesBetween(before.arrival, after.departure)
    return if (window < TightChangeMinutes || shrunk) ConnectionState.Tight else ConnectionState.Ordinary
}

/** A recovery change was never printed with the leg it follows, so only its window decides it. */
fun connectionStates(journey: Journey, recoveryFrom: Int? = null): List<ConnectionState> =
    (0 until journey.legs.lastIndex).map {
        connectionState(journey.legs, it, printed = recoveryFrom == null || it < recoveryFrom)
    }

fun lostChangeIndex(journey: Journey): Int? =
    connectionStates(journey).indexOfFirst { it == ConnectionState.Lost }.takeIf { it >= 0 }

fun recoveryApplies(followed: Journey, recovery: Recovery?): Boolean =
    recovery != null && recovery.journey.legs.isNotEmpty() &&
        recovery.changeIndex in 0 until followed.legs.lastIndex

fun composedJourney(followed: Journey, recovery: Recovery?): Journey {
    if (!recoveryApplies(followed, recovery)) return followed
    return Journey(followed.legs.take(recovery!!.changeIndex + 1) + recovery.journey.legs, followed.retained)
}

fun recoveryPlan(followed: Journey, held: Recovery?, destination: Station): RecoveryPlan {
    val followedLost = lostChangeIndex(followed)
    if (followedLost == null) return RecoveryPlan(followed, null, null, null)
    val record = held?.takeIf { recoveryApplies(followed, it) }
    val composed = composedJourney(followed, record)
    val composedLost = connectionStates(composed, record?.changeIndex)
        .indexOfFirst { it == ConnectionState.Lost }.takeIf { it >= 0 }
    val anchor = composedLost ?: (record?.changeIndex ?: followedLost)
    if (anchor !in 0 until composed.legs.lastIndex) return RecoveryPlan(composed, record, null, null)
    val leg = composed.legs[anchor]
    return RecoveryPlan(composed, record, anchor, RecoverySearch(leg.to, destination, leg.effectiveArrival))
}

fun recoveryCandidate(journeys: List<Journey>, arrival: Long, modes: Set<String>): Journey? =
    journeys.filter { candidate ->
        candidate.legs.isNotEmpty() && !candidate.cancelled && journeyAllowed(candidate, modes) &&
            minutesBetween(arrival, candidate.effectiveDeparture) >= RecoveryConnectionFloor
    }.minByOrNull { it.effectiveDeparture }

fun recoveryAfterSearch(plan: RecoveryPlan, candidate: Journey?, fetchedAt: Long, source: RecoverySource): Recovery? {
    val anchor = plan.anchor ?: return plan.recovery
    if (candidate == null) return plan.recovery
    val kept = plan.composed.legs.take(anchor + 1)
    val changeIndex = minOf(anchor, plan.recovery?.changeIndex ?: anchor)
    return Recovery(changeIndex, Journey(kept.drop(changeIndex + 1) + candidate.legs), fetchedAt, source)
}

/** The rider boards the recovery service at this instant; before it, the lost word stands. */
fun Recovery.boardingTime(): Long? = journey.legs.firstOrNull()?.effectiveDeparture

val FocusedJourney.composed: Journey get() = composedJourney(journey, recovery)

fun FocusedJourney.lostConnectionAhead(now: Long): Boolean {
    if (journey.cancelled) return false
    if (lostChangeIndex(journey) == null) return false
    val boarded = recovery?.boardingTime() ?: return true
    return now < boarded
}
