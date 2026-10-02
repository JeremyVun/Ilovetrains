package com.ilovetrains.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

internal const val PastFirstLookbackMillis = 30 * 60_000L
internal const val PastStepMillis = 60 * 60_000L
internal const val PastBoundMillis = 24 * 60 * 60_000L
internal const val PastOnlineLimit = 10
internal const val PastTimetableLimit = 30

internal data class PastKey(val from: String, val to: String, val modes: Set<String>, val maxTransfers: Int?)

internal fun BoardData.pastKey(modes: Set<String>, maxTransfers: Int?) = PastKey(from.id, to.id, modes, maxTransfers)

/** The first page reaches the services that just left; later pages step back from the earliest one paged. */
internal fun nextPastAt(now: Long, cursor: Long?, earliestPaged: Long?): Long? {
    if (cursor == null) return now - PastFirstLookbackMillis
    val bound = now - PastBoundMillis
    if (cursor <= bound) return null
    // A window that added nothing earlier would otherwise be asked for again.
    return (minOf(cursor, earliestPaged ?: cursor) - PastStepMillis).coerceAtLeast(bound)
}

/** Departed page rows join the board; the board's own copy of a service wins. */
internal fun BoardData.withPast(rows: Collection<Journey>, now: Long): BoardData {
    val past = rows.filter { it.effectiveDeparture < now && it.effectiveDeparture >= now - PastBoundMillis }
    if (past.isEmpty()) return this
    return copy(journeys = mergeEarlier(journeys, past))
}

internal class PastPages(private val scope: CoroutineScope, private val loaded: (PastKey) -> Unit) {
    private var key: PastKey? = null
    private var cursor: Long? = null
    private val online = linkedMapOf<String, Journey>()
    private val timetable = linkedMapOf<String, Journey>()
    private var job: Job? = null
    val loading get() = job?.isActive == true

    fun rows(key: PastKey): Collection<Journey> =
        if (key != this.key) emptyList() else LinkedHashMap(timetable).apply { putAll(online) }.values

    /** A new board visit pages from now again. */
    fun reset() {
        job?.cancel(); job = null
        key = null; cursor = null
        online.clear(); timetable.clear()
    }

    fun cancel() { job?.cancel() }

    fun open(key: PastKey, now: Long, fromOnline: suspend (Long) -> List<Journey>, fromTimetable: suspend (Long) -> List<Journey>) {
        if (key != this.key || cursor == null) next(key, now, fromOnline, fromTimetable)
    }

    fun next(key: PastKey, now: Long, fromOnline: suspend (Long) -> List<Journey>, fromTimetable: suspend (Long) -> List<Journey>): Boolean {
        if (key != this.key) { reset(); this.key = key }
        if (loading) return false
        val earliest = (online.values + timetable.values).minOfOrNull { it.departure }
        val at = nextPastAt(now, cursor, earliest) ?: return false
        job = scope.launch {
            var answered = false
            fun take(rows: List<Journey>?, into: MutableMap<String, Journey>) {
                if (rows == null || this@PastPages.key != key) return
                rows.forEach { into[it.key] = it }
                answered = true
                loaded(key)
            }
            joinAll(
                launch { take(attempt { fromOnline(at) }, online) },
                launch { take(attempt { fromTimetable(at) }, timetable) },
            )
            if (answered && this@PastPages.key == key) cursor = at
        }
        return true
    }
}

private suspend fun <T> attempt(block: suspend () -> T): T? =
    try { block() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
