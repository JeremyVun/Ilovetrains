package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveHorizonTest {
    private val now = 9_000_000L
    private val from = Station("a", "A")
    private val to = Station("b", "B")

    private fun journeyAt(scheduled: Int, estimated: Int?, cancelled: Boolean = false) = Journey(listOf(
        Leg("T1", "train", "B", from, to, now + scheduled * 60_000L, now + (scheduled + 30) * 60_000L,
            estimatedDeparture = estimated?.let { now + it * 60_000L },
            estimatedArrival = estimated?.let { now + (it + 30) * 60_000L }, cancelled = cancelled)))

    private fun liveBoard(journey: Journey) = BoardData(from, to, listOf(journey), now, source = "live")

    @Test fun anOnTimeEstimateIsLiveAtTheHorizonAndScheduledBeyondIt() {
        val atHorizon = journeyAt(40, 40)
        assertFalse(beyondLiveHorizon(atHorizon, liveBoard(atHorizon), now))
        assertEquals(Figure("40", "min", ""), figureFor(atHorizon, liveBoard(atHorizon), now))

        val beyond = journeyAt(41, 41)
        assertTrue(beyondLiveHorizon(beyond, liveBoard(beyond), now))
        assertEquals(Figure("41", "min", "Scheduled"), figureFor(beyond, liveBoard(beyond), now))
    }

    @Test fun aDelayBeyondTheHorizonKeepsItsLabelAndItsDelayedFigure() {
        val late = journeyAt(41, 47)
        assertFalse(beyondLiveHorizon(late, liveBoard(late), now))
        assertEquals(Figure("47", "min", "6 min late"), figureFor(late, liveBoard(late), now))
    }

    @Test fun anEarlyEstimateBeyondTheHorizonStaysLive() {
        val early = journeyAt(43, 41)
        assertFalse(beyondLiveHorizon(early, liveBoard(early), now))
        assertEquals(Figure("41", "min", ""), figureFor(early, liveBoard(early), now))
    }

    @Test fun aCancellationBeyondTheHorizonStillShows() {
        val cancelled = journeyAt(41, 41, cancelled = true)
        assertFalse(beyondLiveHorizon(cancelled, liveBoard(cancelled), now))
        assertEquals(Figure("—", "", "Cancelled"), figureFor(cancelled, liveBoard(cancelled), now))
    }

    @Test fun rowsAlreadyReadingScheduledDoNotEnterTheHorizonRule() {
        val journey = journeyAt(41, 41)
        val live = liveBoard(journey)
        val alreadyScheduled = listOf(
            journey to null,
            journey to live.copy(offline = true),
            journey to live.copy(generatedAt = now - 120_000),
            journey to live.copy(source = "schedule"),
            journey.copy(retained = true) to live)
        for ((row, board) in alreadyScheduled) {
            assertFalse(beyondLiveHorizon(row, board, now))
            assertEquals("Scheduled", figureFor(row, board, now).provenance)
        }
    }

    @Test fun aLiveLaterLegDoesNotMoveARowWhoseFirstDepartureIsTimetableOnly() {
        val mid = Station("m", "M")
        val journey = Journey(listOf(
            Leg("T1", "train", "M", from, mid, now + 41 * 60_000L, now + 60 * 60_000L),
            Leg("T2", "train", "B", mid, to, now + 65 * 60_000L, now + 80 * 60_000L,
                estimatedDeparture = now + 65 * 60_000L, estimatedArrival = now + 80 * 60_000L)))
        val board = liveBoard(journey)
        assertFalse(beyondLiveHorizon(journey, board, now))
        assertEquals(Figure("41", "min", ""), figureFor(journey, board, now))
    }

    @Test fun theNextServiceRailFormatsBothSidesOfTheHorizonIdentically() {
        val atHorizon = journeyAt(40, 40)
        val beyond = journeyAt(41, 41)
        assertEquals("40 min", nextServiceFigure(atHorizon, liveBoard(atHorizon), now))
        assertEquals("41 min", nextServiceFigure(beyond, liveBoard(beyond), now))
    }
}
