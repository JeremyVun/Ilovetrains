package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Ignore
import org.junit.Test

/* Review probes for the ride ledger (client-storage.md, Completed rides). The
   @Ignore'd tests assert the plan's literal reading and fail on the shipped
   guard; they are retained for the owner ruling. */
class RideSettlementProbeTest {
    private val now = 1_788_765_000_000L
    private val central = Station("200060", "Central Station")
    private val parramatta = Station("215020", "Parramatta Station")

    private fun focus(arrival: Long, tripId: String = "work"): FocusedJourney {
        val journey = Journey(listOf(Leg("T1", "train", "Parramatta", central, parramatta,
            now - 25 * 60_000, now - 60_000, estimatedArrival = arrival)))
        return FocusedJourney(tripId, false, journey, BoardData(central, parramatta, listOf(journey), now, source = "live"))
    }

    @Test fun i2CorrectionNeverDuplicatesAndTheCapHolds() {
        val filler = (0 until 100).map { Ride("other-$it", false, now - it * 60_000L, now - 1, central, parramatta) }
        val recorded = filler.settled(focus(now - 60_000), arrived = true)
        assertEquals(100, recorded.size)
        assertEquals(1, recorded.count { it.tripId == "work" })
        val corrected = recorded.settled(focus(now - 30_000), arrived = true)
        assertEquals(100, corrected.size)
        assertEquals(1, corrected.count { it.tripId == "work" })
        assertEquals(now - 30_000, corrected.first { it.tripId == "work" }.arrival)
        assertSame(corrected, corrected.settled(focus(now - 30_000), arrived = true))
        val withdrawn = corrected.settled(focus(now + 60_000), arrived = false)
        assertEquals(99, withdrawn.size)
        assertEquals(0, withdrawn.count { it.tripId == "work" })
    }

    @Test fun builderBehaviourAnEarlierMovedArrivalIsLeftOnTheRow() {
        val recorded = emptyList<Ride>().settled(focus(now - 5 * 60_000), arrived = true)
        val moved = recorded.settled(focus(now - 6 * 60_000), arrived = true)
        assertSame(recorded, moved)
        assertEquals(now - 5 * 60_000, moved.single().arrival)
    }

    @Ignore("fails on the builder's later-only guard: the plan says a moved arrival is taken")
    @Test fun planTextARecordedRideTakesAnEarlierRefreshedArrivalThatIsStillPast() {
        val recorded = emptyList<Ride>().settled(focus(now - 5 * 60_000), arrived = true)
        assertEquals(now - 6 * 60_000, recorded.settled(focus(now - 6 * 60_000), arrived = true).single().arrival)
    }

    @Test fun builderBehaviourA200mCompletionIsWithdrawnByALaterMovedFutureArrival() {
        val atDestination = emptyList<Ride>().settled(focus(now + 2 * 60_000), arrived = true)
        assertEquals(emptyList<Ride>(), atDestination.settled(focus(now + 5 * 60_000), arrived = false))
    }

    @Ignore("fails on the builder's ledger: the natives settle from the clock alone, so a later-but-future move withdraws a fix completion")
    @Test fun i3A200mCompletionSurvivesALaterMovedFutureArrival() {
        val atDestination = emptyList<Ride>().settled(focus(now + 2 * 60_000), arrived = true)
        assertEquals(1, atDestination.settled(focus(now + 5 * 60_000), arrived = false).size)
    }

    @Test fun i1AStaleArrivalInThePastRecordsNothingUntilTheRefreshedOneHasPassed() {
        val stale = focus(now - 60_000)
        val moved = focus(now + 5 * 60_000)
        assertEquals(emptyList<Ride>(), emptyList<Ride>().settled(moved, arrived = now >= moved.journey.effectiveArrival))
        val later = now + 6 * 60_000
        assertEquals(1, emptyList<Ride>().settled(moved, arrived = later >= moved.journey.effectiveArrival).size)
        assertEquals(1, emptyList<Ride>().settled(stale, arrived = now >= stale.journey.effectiveArrival).size)
    }
}
