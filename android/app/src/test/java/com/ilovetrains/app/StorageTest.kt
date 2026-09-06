package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class StorageTest {
    @Test fun focusAndExactNativeIdentitySurviveRestart() {
        val a = Station("a", "A"); val b = Station("b", "B")
        val j = Journey(listOf(Leg("T9", "train", "B", a, b, 10_000, 20_000, 11_000, 22_000, "1", "2",
            identity = TripIdentity("sydneytrains", "exact", "20260906", "a1", "b2"))))
        val board = BoardData(a, b, listOf(j), 9000, source = "live", serverStale = true)
        val data = UserData(trips = listOf(SavedTrip("t", a, b)), focus = FocusedJourney("t", false, j, board), modes = emptySet())
        val restored = Wire.user(JSONObject(Wire.user(data).toString()))
        assertEquals(data, restored)
        assertEquals("exact", restored.focus?.journey?.legs?.first()?.identity?.tripId)
        assertTrue(restored.modes.isEmpty())
    }
    @Test fun malformedLegCannotTurnTransferIntoDifferentJourney() {
        val raw = JSONObject("""{"legDetail":[{"line":{"name":"T9","mode":"train"},"headsign":"B","from":{"id":"a","name":"A"},"to":{"id":"b","name":"B"},"departure":{"scheduled":1000},"arrival":{"scheduled":2000}},{"broken":true}]}""")
        assertTrue(runCatching { Wire.journey(raw) }.isFailure)
    }
    @Test fun apiTimesAndFreshnessArePreservedWithoutFakingEstimate() {
        val raw = JSONObject("""{"from":{"id":"a","name":"A"},"to":{"id":"b","name":"B"},"generatedAt":"2026-09-06T08:00:00+10:00","journeys":[{"legDetail":[{"line":{"name":"F1","mode":"ferry"},"headsign":"Manly","from":{"id":"a","name":"A","platform":"Wharf 4, Side B"},"to":{"id":"b","name":"B"},"departure":{"scheduled":"2026-09-06T08:10:00+10:00","estimated":null},"arrival":{"scheduled":"2026-09-06T08:40:00+10:00","estimated":null}}]}]}""")
        val board = Wire.board(raw, api = true)
        assertNull(board.journeys.single().legs.single().estimatedDeparture)
        assertEquals("Wharf 4, Side B", board.journeys.single().legs.single().fromPlatform)
        assertEquals(1_788_645_600_000L, board.generatedAt)
    }

    @Test fun completedRideEndpointEvidenceSurvivesRestart() {
        val a = Station("a", "A"); val b = Station("b", "B")
        val ride = Ride("deleted-trip", true, 1_000, 2_000, b, a)
        val restored = Wire.user(JSONObject(Wire.user(UserData(rides = listOf(ride))).toString()))
        assertEquals(ride, restored.rides.single())
    }
}
