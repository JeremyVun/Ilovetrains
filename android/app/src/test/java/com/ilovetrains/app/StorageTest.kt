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
        val alternatives = board.copy(generatedAt = 30_000, serverStale = false,
            journeys = listOf(j.copy(legs = j.legs.map { it.copy(departure = 40_000, arrival = 60_000,
                estimatedDeparture = 41_000, estimatedArrival = 62_000, cancelled = true) })))
        val data = UserData(trips = listOf(SavedTrip("t", a, b)),
            focus = FocusedJourney("t", false, j, board, alternatives = alternatives), modes = emptySet())
        val restored = Wire.user(JSONObject(Wire.user(data).toString()))
        assertEquals(data, restored)
        assertEquals("exact", restored.focus?.journey?.legs?.first()?.identity?.tripId)
        assertEquals(alternatives, restored.focus?.alternatives)
        assertTrue(restored.focus!!.board.serverStale)
        assertFalse(restored.focus.alternatives!!.serverStale)
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

    @Test fun transferLimitAndFlagsSurviveRestartAndFallBackToTheCap() {
        val chosen = UserData(transferLimit = TransferLimit.Any, flags = mapOf("transferLimit" to true))
        val restored = Wire.user(JSONObject(Wire.user(chosen).toString()))
        assertEquals(chosen, restored)
        assertEquals(TransferLimit.Any, restored.transferLimit)
        assertEquals(mapOf("transferLimit" to true), restored.flags)

        assertEquals(TransferLimit.Two, Wire.user(JSONObject(Wire.user(UserData()).toString())).transferLimit)
        assertEquals(TransferLimit.Two, Wire.user(JSONObject("{}")).transferLimit)
        assertEquals(TransferLimit.Two, Wire.user(JSONObject("""{"transferLimit":"three"}""")).transferLimit)
        assertEquals(TransferLimit.Any, Wire.user(JSONObject("""{"transferLimit":"any"}""")).transferLimit)
        assertTrue(Wire.user(JSONObject("{}")).flags.isEmpty())
        assertTrue(Wire.user(JSONObject("""{"flags":"on"}""")).flags.isEmpty())
        assertEquals(mapOf("transferLimit" to false),
            Wire.user(JSONObject("""{"flags":{"transferLimit":false,"other":"yes","count":2}}""")).flags)
    }

    @Test fun cappedNeedsBothTheFlagAndThePreferenceAndBoundsOfflineRouting() {
        val on = mapOf("transferLimit" to true)
        assertTrue(UserData(flags = on).capped)
        assertFalse(UserData(flags = on, transferLimit = TransferLimit.Any).capped)
        assertFalse(UserData().capped)
        assertFalse(UserData(transferLimit = TransferLimit.Any).capped)
        assertEquals(2, UserData(flags = on).offlineMaxTransfers)
        assertEquals(4, UserData(flags = on, transferLimit = TransferLimit.Any).offlineMaxTransfers)
        assertEquals(2, UserData(transferLimit = TransferLimit.Any).offlineMaxTransfers)
    }

    @Test fun completedRideEndpointEvidenceSurvivesRestart() {
        val a = Station("a", "A"); val b = Station("b", "B")
        val ride = Ride("deleted-trip", true, 1_000, 2_000, b, a)
        val restored = Wire.user(JSONObject(Wire.user(UserData(rides = listOf(ride))).toString()))
        assertEquals(ride, restored.rides.single())
    }

    @Test fun outOfRangePersistedTimeDoesNotDiscardOtherCachedJourneys() {
        val a = Station("a", "A"); val b = Station("b", "B")
        val journey = Journey(listOf(Leg("T9", "train", "B", a, b, 10_000, 20_000)))
        val board = Wire.board(BoardData(a, b, listOf(journey), 9_000))
        val damaged = Wire.journey(journey)
        damaged.getJSONArray("legDetail").getJSONObject(0).apply {
            getJSONObject("departure").put("scheduled", 1e20)
            getJSONObject("arrival").put("scheduled", 1e20)
        }
        board.getJSONArray("journeys").put(damaged)
        assertEquals(listOf(journey), Wire.board(board).journeys)
    }
}
