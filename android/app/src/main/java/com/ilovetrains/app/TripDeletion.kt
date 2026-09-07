package com.ilovetrains.app

const val UndoWindowMillis = 4_000L

data class PendingDeletion(val trip: SavedTrip, val index: Int, val history: List<ViewEvent>,
    val focus: FocusedJourney?, val lastAnswer: LastAnswer?, val lastTripId: String?)

fun deletionMessage(trip: SavedTrip) = "${trip.from.shortName} → ${trip.to.shortName} deleted"

fun UserData.beginDeletion(id: String): Pair<UserData, PendingDeletion>? {
    val index = trips.indexOfFirst { it.id == id }
    if (index < 0) return null
    val pending = PendingDeletion(trips[index], index, history.filter { it.tripId == id },
        focus?.takeIf { it.tripId == id }, lastAnswer?.takeIf { it.tripId == id }, lastTripId?.takeIf { it == id })
    val remaining = copy(trips = trips.filter { it.id != id }, history = history.filter { it.tripId != id },
        focus = focus?.takeIf { it.tripId != id }, lastAnswer = lastAnswer?.takeIf { it.tripId != id },
        lastTripId = lastTripId?.takeIf { it != id })
    return remaining to pending
}

fun UserData.restore(pending: PendingDeletion): UserData {
    val pair = setOf(pending.trip.from.id, pending.trip.to.id)
    if (trips.any { it.id == pending.trip.id || setOf(it.from.id, it.to.id) == pair }) return this
    val restored = trips.toMutableList().apply { add(pending.index.coerceAtMost(size), pending.trip) }
    return copy(trips = restored, history = (history + pending.history).takeLast(500),
        focus = focus ?: pending.focus, lastAnswer = lastAnswer ?: pending.lastAnswer, lastTripId = lastTripId ?: pending.lastTripId)
}
