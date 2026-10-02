package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Adversarial probes for commute-reliability rules 3, 5 and 6 on the pure Android logic. Each test states what
 * design.md and client-storage.md require; a failure is a defect or a contract contradiction (REVIEW.md).
 */
class ReviewInferenceTest {
    private val rhodes = Station("213820", "Rhodes Station", -33.83053, 151.087032)
    private val townHall = Station("200070", "Town Hall Station", -33.873596, 151.206899)
    private val trip = SavedTrip("rt", rhodes, townHall)
    private val eight = 1_790_805_600_000L
    private val minute = 60_000L
    private val onTheWay = Fix(-33.87181, 151.094427, 0L, speed = 14.0, accuracyMetres = 10.0, bearing = 90.0)

    private fun t9(departure: Long, arrival: Long) =
        Journey(listOf(Leg("T9", "train", "Hornsby via Strathfield", rhodes, townHall, departure, arrival, departure, arrival, "1", "3")))

    private fun record(journey: Journey, at: Long, station: Station? = rhodes) =
        LastAnswer(trip.id, false, at, station?.id, BoardData(rhodes, townHall, listOf(journey), at), journey)

    /** Lead suspect 1: a same-origin sighting 60 s after departure means the rider did not board, so the open's snapshot must not enter that train either. */
    @Test fun aPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo() {
        val departed = record(t9(eight, eight + 27 * minute), at = eight - 2 * minute)
        val snapshot = departed
        var data = UserData(trips = listOf(trip), lastAnswer = departed, useLocation = true)
        val sightingAt = eight + 70_000
        data = data.withLastAnswer(record(t9(eight + 8 * minute, eight + 35 * minute), at = sightingAt), sightingAt)
        assertEquals("the hold rule replaces the stored record with the next train", eight + 8 * minute, data.lastAnswer?.journey?.departure)

        val now = eight + 12 * minute
        val entered = inferFromRecords(data, snapshot, now, onTheWay.copy(at = now))
        assertNotNull("the moving fix enters trip mode", entered)
        assertEquals("entered the departed train instead of the one the rider could have boarded",
            data.lastAnswer?.journey?.key, entered?.journey?.key)
    }

    private class Probe(val data: UserData, val now: Long, val fix: Fix, val journey: Journey) {
        fun boards() = mapOf(TripDirection("rt", false) to listOf(journey))
        fun enter() = inferOnBoard(data, now, fix, null, boards(), emptyMap())
    }

    /** A running service whose time progress sits [gap] from the fix's position progress on a 30 minute ride. */
    private fun onBoardAt(gap: Double, now: Long = eight + 10 * minute): Probe {
        val fix = onTheWay.copy(at = now)
        val fromOrigin = distanceMetres(fix, rhodes)
        val position = fromOrigin / (fromOrigin + distanceMetres(fix, townHall))
        val ride = 30 * minute
        val departure = Math.round((now - (position + gap) * ride) / 1000.0) * 1000
        return Probe(UserData(trips = listOf(trip), useLocation = true), now, fix, t9(departure, departure + ride))
    }

    @Test fun aServicePointTwoFourOffThePositionProgressStillMatches() {
        val probe = onBoardAt(0.24)
        assertEquals(probe.journey.key, probe.enter()?.journey?.key)
    }

    @Test fun aServicePointTwoSixOffThePositionProgressIsNotAMatch() {
        assertNull(onBoardAt(0.26).enter())
        assertEquals(0.25, ProgressWindow, 0.0)
    }

    @Test fun aServicePointTwoFourNineOffStillMatchesBecauseTheWindowIsInclusive() {
        val probe = onBoardAt(0.249)
        assertEquals(probe.journey.key, probe.enter()?.journey?.key)
    }

    /** Fixture gap 1: no shared case is held by the decline's hour alone. */
    @Test fun theDeclineHourAloneHoldsEntryOnceTheDeclinedArrivalPlusThirtyHasPassed() {
        val probe = onBoardAt(0.02)
        val declined = InferenceDecline(trip.id, false, probe.now - 59 * minute, "T9:${eight - 70 * minute}", probe.now - 40 * minute)
        val held = probe.data.copy(inferenceDeclined = declined)
        assertTrue(inferenceDeclined(held, trip.id, probe.now))
        assertNull(inferOnBoard(held, probe.now, probe.fix, null, probe.boards(), emptyMap()))
        val lapsed = probe.data.copy(inferenceDeclined = declined.copy(at = probe.now - 60 * minute))
        assertFalse("the hour lapses exactly 60 min after the stop", inferenceDeclined(lapsed, trip.id, probe.now))
        assertEquals(probe.journey.key, inferOnBoard(lapsed, probe.now, probe.fix, null, probe.boards(), emptyMap())?.journey?.key)
    }
}
