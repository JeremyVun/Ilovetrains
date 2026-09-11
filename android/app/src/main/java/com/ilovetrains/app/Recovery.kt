package com.ilovetrains.app

enum class ConnectionState { Ordinary, Tight, Lost, Broken }

data class RecoverySource(val generatedAt: Long, val degraded: Boolean = false)

data class Recovery(
    val changeIndex: Int,
    val journey: Journey,
    val fetchedAt: Long,
    val source: RecoverySource,
    /** Legs of [journey] kept from an earlier search; only the legs after them are searched again. */
    val carried: Int = 0,
)

data class RecoverySearch(val from: Station, val to: Station, val at: Long)

data class RecoveryPlan(
    val composed: Journey,
    val recovery: Recovery?,
    val anchor: Int?,
    val search: RecoverySearch?,
    val stranded: Boolean = false,
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

fun recoveryApplies(followed: Journey, recovery: Recovery?): Boolean {
    val first = recovery?.journey?.legs?.firstOrNull() ?: return false
    if (recovery.changeIndex !in 0 until followed.legs.lastIndex) return false
    return first.from.id == followed.legs[recovery.changeIndex].to.id
}

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
    val anchor = composedLost ?: record?.let { it.changeIndex + it.carried } ?: followedLost
    if (anchor !in 0 until composed.legs.lastIndex) return RecoveryPlan(composed, record, null, null)
    val leg = composed.legs[anchor]
    return RecoveryPlan(composed, record, anchor,
        RecoverySearch(leg.to, destination, leg.effectiveArrival), stranded = composedLost != null)
}

fun recoveryCandidate(journeys: List<Journey>, search: RecoverySearch, modes: Set<String>): Journey? =
    journeys.filter { candidate ->
        candidate.legs.firstOrNull()?.from?.id == search.from.id && !candidate.cancelled &&
            journeyAllowed(candidate, modes) &&
            minutesBetween(search.at, candidate.effectiveDeparture) >= RecoveryConnectionFloor
    }.minByOrNull { it.effectiveDeparture }

/** A held candidate is re-matched by its service keys; only a cleared or stranded record picks again. */
fun recoveryChoice(plan: RecoveryPlan, journeys: List<Journey>, modes: Set<String>): Journey? {
    val search = plan.search ?: return null
    val held = plan.recovery
    if (held == null || plan.stranded) return recoveryCandidate(journeys, search, modes)
    val tail = Journey(held.journey.legs.drop(held.carried)).key
    return journeys.firstOrNull { it.key == tail }
}

fun recoveryAfterSearch(plan: RecoveryPlan, candidate: Journey?, fetchedAt: Long, source: RecoverySource): Recovery? {
    val anchor = plan.anchor ?: return plan.recovery
    if (candidate == null) return plan.recovery
    val held = plan.recovery
    val changeIndex = minOf(anchor, held?.changeIndex ?: anchor)
    val journey = Journey(plan.composed.legs.subList(changeIndex + 1, anchor + 1) + candidate.legs)
    // A refresh that re-matched the same trains settles nothing, so the record keeps the time it was fetched.
    if (held != null && held.changeIndex == changeIndex && held.journey == journey) return held
    return Recovery(changeIndex, journey, fetchedAt, source, anchor - changeIndex)
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
