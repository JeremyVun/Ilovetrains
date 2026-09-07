package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test

/* The stale-arrival defect: resume settled the focus from the stored snapshot
   before the refresh could move its arrival, and the ride it wrote then
   outlived the correction. */
class RideSettlementTest {
    private val now = 1_788_765_000_000L
    private val central = Station("200060", "Central Station")
    private val parramatta = Station("215020", "Parramatta Station")

    private fun focus(arrival: Long): FocusedJourney {
        val journey = Journey(listOf(Leg("T1", "train", "Parramatta", central, parramatta,
            now - 25 * 60_000, now - 60_000, estimatedArrival = arrival)))
        return FocusedJourney("work", false, journey, BoardData(central, parramatta, listOf(journey), now, source = "live"))
    }

    @Test fun aRideRecordedFromAStaleArrivalIsWithdrawnWhenTheRefreshMovesItAhead() {
        val settledOnResume = emptyList<Ride>().settled(focus(now - 60_000), arrived = true)
        assertEquals(1, settledOnResume.size)
        assertEquals(now - 60_000, settledOnResume.first().arrival)

        val settledOnRefresh = settledOnResume.settled(focus(now + 5 * 60_000), arrived = false)
        assertEquals(emptyList<Ride>(), settledOnRefresh)
    }

    @Test fun aRefreshThatConfirmsTheArrivalRecordsItOnceAndCorrectsALaterOne() {
        val recorded = emptyList<Ride>().settled(focus(now - 5 * 60_000), arrived = true)
        val corrected = recorded.settled(focus(now - 60_000), arrived = true)
        assertEquals(1, corrected.size)
        assertEquals(now - 60_000, corrected.first().arrival)
        assertSame(corrected, corrected.settled(focus(now - 60_000), arrived = true))
        assertEquals(central, corrected.first().from)
        assertEquals(parramatta, corrected.first().to)
    }

    @Test fun arrivingAtTheDestinationRecordsBeforeTheTimetableAgrees() {
        val atDestination = emptyList<Ride>().settled(focus(now + 2 * 60_000), arrived = true)
        assertEquals(1, atDestination.size)
        assertSame(atDestination, atDestination.settled(focus(now + 2 * 60_000), arrived = false))
    }

    @Test fun anUnfinishedJourneyRecordsNothing() {
        assertEquals(emptyList<Ride>(), emptyList<Ride>().settled(focus(now + 60_000), arrived = false))
    }
}
