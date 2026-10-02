package com.ilovetrains.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PastPagesTest {
    private val a = Station("a", "Alpha")
    private val b = Station("b", "Bravo")
    private val now = 1_788_645_600_000L
    private val minute = 60_000L
    private val key = PastKey("a", "b", setOf("train"), null)

    private fun service(line: String, departs: Long, estimated: Long? = null, cancelled: Boolean = false) =
        Journey(listOf(Leg(line, "train", "Bravo", a, b, departs, departs + 20 * minute,
            estimatedDeparture = estimated, cancelled = cancelled)))

    private fun board(vararg journeys: Journey) = BoardData(a, b, journeys.toList(), now, source = "live")

    @Test fun firstPageReachesThirtyMinutesBackAndLaterPagesStepAnHourFromTheEarliestPaged() {
        assertEquals(now - 30 * minute, nextPastAt(now, cursor = null, earliestPaged = null))
        assertEquals(now - 94 * minute, nextPastAt(now, cursor = now - 30 * minute, earliestPaged = now - 34 * minute))
        assertEquals("a window with nothing before it steps past itself", now - 90 * minute,
            nextPastAt(now, cursor = now - 30 * minute, earliestPaged = now - 2 * minute))
        assertEquals(now - 24 * 60 * minute, nextPastAt(now, cursor = now - 23 * 60 * minute, earliestPaged = null))
        assertNull(nextPastAt(now, cursor = now - 24 * 60 * minute, earliestPaged = null))
    }

    @Test fun pagerAsksBothSourcesForTheSameWindowsInOrder() = runBlocking {
        val asked = mutableListOf<Pair<String, Long>>()
        val pages = PastPages(this) {}
        pages.next(key, now, { at -> asked += "online" to at; listOf(service("T1", now - 34 * minute)) },
            { at -> asked += "timetable" to at; listOf(service("T1", now - 25 * minute)) })
        pages.join()
        pages.next(key, now, { at -> asked += "online" to at; emptyList() }, { at -> asked += "timetable" to at; emptyList() })
        pages.join()
        pages.next(key, now, { at -> asked += "online" to at; emptyList() }, { at -> asked += "timetable" to at; emptyList() })
        pages.join()

        assertEquals(listOf(
            "online" to now - 30 * minute, "timetable" to now - 30 * minute,
            "online" to now - 94 * minute, "timetable" to now - 94 * minute,
            "online" to now - 154 * minute, "timetable" to now - 154 * minute,
        ), asked)
    }

    @Test fun onlineRowsWinByKeyOverTheTimetable() = runBlocking {
        val scheduled = service("T1", now - 20 * minute)
        val observed = service("T1", now - 20 * minute, estimated = now - 17 * minute)
        val onlineOnly = service("T2", now - 12 * minute)
        val timetableOnly = service("T3", now - 8 * minute)
        val online = CompletableDeferred<List<Journey>>()
        val pages = PastPages(this) {}
        pages.next(key, now, { online.await() }, { listOf(scheduled, timetableOnly) })
        while (pages.rows(key).isEmpty()) yield()
        assertEquals(listOf(scheduled.key, timetableOnly.key), pages.rows(key).map { it.key })
        online.complete(listOf(observed, onlineOnly))
        pages.join()

        val rows = pages.rows(key).associateBy { it.key }
        assertEquals(setOf(scheduled.key, onlineOnly.key, timetableOnly.key), rows.keys)
        assertEquals(observed, rows[scheduled.key])
    }

    @Test fun eitherSourceAloneServesThePage() = runBlocking {
        val onlineRow = service("T1", now - 20 * minute, estimated = now - 18 * minute)
        val timetableRow = service("T2", now - 10 * minute)
        val offline = PastPages(this) {}
        offline.next(key, now, { error("no network") }, { listOf(timetableRow) })
        offline.join()
        assertEquals(listOf(timetableRow), offline.rows(key).toList())

        val noTimetable = PastPages(this) {}
        noTimetable.next(key, now, { listOf(onlineRow) }, { error("timetable unavailable") })
        noTimetable.join()
        assertEquals(listOf(onlineRow), noTimetable.rows(key).toList())

        var asked = 0L
        offline.next(key, now, { at -> asked = at; emptyList() }, { emptyList() })
        offline.join()
        assertEquals("a page answered by one source moves on", now - 90 * minute, asked)
    }

    @Test fun aFailedPageIsRetriedAtTheSameWindow() = runBlocking {
        var published = 0
        val asked = mutableListOf<Long>()
        val pages = PastPages(this) { published++ }
        pages.next(key, now, { at -> asked += at; error("offline") }, { at -> asked += at; error("no timetable") })
        pages.join()
        assertFalse(pages.loading)
        assertEquals(0, published)
        assertTrue(pages.rows(key).isEmpty())

        pages.next(key, now, { at -> asked += at; emptyList() }, { at -> asked += at; listOf(service("T1", now - 20 * minute)) })
        pages.join()
        assertEquals(List(4) { now - 30 * minute }, asked)
        assertEquals(2, published)
    }

    @Test fun aRequestWhileAPageIsInFlightIsIgnored() = runBlocking {
        val release = CompletableDeferred<List<Journey>>()
        var calls = 0
        val pages = PastPages(this) {}
        assertTrue(pages.next(key, now, { calls++; release.await() }, { release.await() }))
        yield()
        assertTrue(pages.loading)
        assertFalse(pages.next(key, now, { calls++; emptyList() }, { emptyList() }))
        release.complete(emptyList())
        pages.join()
        assertEquals(1, calls)
        assertFalse(pages.loading)
    }

    @Test fun aRefreshWhileAPageIsInFlightNeitherCancelsNorDiscardsIt() = runBlocking {
        val departed = service("T1", now - 20 * minute, estimated = now - 19 * minute)
        val upcoming = service("T2", now + 5 * minute)
        val release = CompletableDeferred<List<Journey>>()
        lateinit var pages: PastPages
        var shown = board(upcoming)
        fun publish(answer: BoardData) { shown = answer.withPast(pages.rows(answer.pastKey(setOf("train"), null)), now) }
        pages = PastPages(this) { publish(shown) }
        pages.next(key, now, { release.await() }, { release.await() })
        yield()

        publish(board(upcoming.copy(legs = upcoming.legs.map { it.copy(estimatedDeparture = now + 6 * minute) })))
        assertTrue(pages.loading)
        release.complete(listOf(departed))
        pages.join()
        assertEquals(listOf(departed.key, upcoming.key), shown.journeys.map { it.key })

        publish(mergeBoardResults(board(upcoming), null, board(upcoming), now)!!)
        assertEquals("a later refresh keeps the page", listOf(departed.key, upcoming.key), shown.journeys.map { it.key })
    }

    @Test fun anotherPairDropsThePageInFlight() = runBlocking {
        val other = key.copy(to = "c")
        val release = CompletableDeferred<List<Journey>>()
        val pages = PastPages(this) {}
        pages.next(key, now, { release.await() }, { release.await() })
        yield()
        val otherRow = service("T5", now - 15 * minute)
        assertTrue(pages.next(other, now, { listOf(otherRow) }, { emptyList() }))
        release.complete(listOf(service("T1", now - 20 * minute)))
        pages.join()
        assertTrue(pages.rows(key).isEmpty())
        assertEquals(listOf(otherRow), pages.rows(other).toList())
    }

    @Test fun departedPageRowsJoinTheBoardAndTheBoardsObservationsWin() {
        val scheduled = service("T1", now - 20 * minute)
        val observed = service("T1", now - 20 * minute, estimated = now - 17 * minute, cancelled = true)
        val older = service("T2", now - 50 * minute)
        val merged = board(observed).withPast(listOf(older, scheduled), now)
        assertEquals(listOf(older.key, observed.key), merged.journeys.map { it.key })
        assertEquals(observed, merged.journeys.last())
    }

    @Test fun aPageObservationReplacesAnUnobservedBoardCopy() {
        val scheduled = service("T1", now - 20 * minute)
        val observed = service("T1", now - 20 * minute, estimated = now - 17 * minute)
        assertEquals(listOf(observed), board(scheduled).withPast(listOf(observed), now).journeys)
    }

    @Test fun onlyDepartedRowsFromTheLastDayJoinTheBoard() {
        val upcoming = service("T1", now + 10 * minute)
        val tooOld = service("T2", now - 24 * 60 * minute - 1)
        val shown = board()
        assertEquals(shown, shown.withPast(listOf(upcoming, tooOld), now))
    }

    private suspend fun PastPages.join() { while (loading) yield() }
}
