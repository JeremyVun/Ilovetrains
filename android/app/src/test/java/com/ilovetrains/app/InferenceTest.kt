package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InferenceTest {
    private val rhodes = Station("213820", "Rhodes Station", -33.83053, 151.087032, setOf("train"))
    private val townHall = Station("200070", "Town Hall Station", -33.873596, 151.206899, setOf("train"))
    private val trip = SavedTrip("rt", rhodes, townHall)
    private val now = 1_790_806_200_000
    private val minute = 60_000L

    private fun journey(departure: Long, minutes: Long) =
        Journey(listOf(Leg("T9", "train", "Hornsby", rhodes, townHall, departure, departure + minutes * minute)))

    @Test fun aDeclineHoldsItsTripForAnHourWhenTheRideEndsSooner() {
        val declined = journey(now - 20 * minute, 15)
        val data = UserData(trips = listOf(trip), inferenceDeclined = InferenceDecline(trip.id, false, now, declined.departureKey,
            declined.effectiveArrival))
        assertTrue(inferenceDeclined(data, trip.id, now + 60 * minute - 1))
        assertFalse(inferenceDeclined(data, trip.id, now + 60 * minute))
        assertTrue("the declined departure stays declined", inferenceDeclined(data, trip.id, now + 600 * minute, declined))
        assertFalse(inferenceDeclined(data, "other", now))
    }

    @Test fun decliningAFocusRecordsItsFirstDepartureAndComposedArrival() {
        val followed = journey(now - 10 * minute, 27)
        val focus = FocusedJourney(trip.id, true, followed, BoardData(townHall, rhodes, listOf(followed), now), pinned = false)
        val decline = UserData(trips = listOf(trip)).declining(focus, now).inferenceDeclined
        assertEquals(InferenceDecline(trip.id, true, now, "T9:${now - 10 * minute}", focus.composed.effectiveArrival), decline)
    }

    @Test fun aWriteSightedAtTheHeldOriginAMinuteAfterDepartureShowsTheRiderStayed() {
        val held = journey(now, 27)
        val stored = LastAnswer(trip.id, false, now - 2 * minute, rhodes.id, BoardData(rhodes, townHall, listOf(held), now), held)
        val data = UserData(trips = listOf(trip), lastAnswer = stored)
        val next = journey(now + 8 * minute, 27)
        val seen = LastAnswer(trip.id, false, now + 90_000, rhodes.id, BoardData(rhodes, townHall, listOf(next), now), next)
        assertEquals(stored, data.withLastAnswer(seen, sightingAt = now + HoldSightingAfterMillis - 1).lastAnswer)
        assertEquals(seen, data.withLastAnswer(seen, sightingAt = now + HoldSightingAfterMillis).lastAnswer)
        assertEquals(stored, data.withLastAnswer(seen.copy(stationId = null), sightingAt = null).lastAnswer)
        assertEquals(seen, data.copy(lastAnswer = null).withLastAnswer(seen, null).lastAnswer)
    }
}
