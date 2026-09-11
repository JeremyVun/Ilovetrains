package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class StorageTest {
    @Test fun focusAndExactNativeIdentitySurviveRestart() {
        val a = Station("a", "A"); val b = Station("b", "B")
        val j = Journey(listOf(Leg("T9", "train", "B", a, b, 10_000, 20_000, 11_000, 22_000, "1", "2",
            identity = TripIdentity("sydneytrains", "exact", "20260906", "a1", "b2"))))
        val pageBody = BoardData(a, b, listOf(j), 8_000, source = "live", serverStale = true,
            fetchConstraint = TransferConstraint(null))
        val board = BoardData(a, b, listOf(j), 9000, source = "live", serverStale = true,
            fetchConstraint = TransferConstraint(0), recommendationPages = listOf(
                RecommendationPage(7_000, pageBody, true, TransferConstraint(null))),
            recommendation = RecommendationResult(j, pageBody))
        val alternatives = board.copy(generatedAt = 30_000, serverStale = false,
            journeys = listOf(j.copy(legs = j.legs.map { it.copy(departure = 40_000, arrival = 60_000,
                estimatedDeparture = 41_000, estimatedArrival = 62_000, cancelled = true) })))
        val data = UserData(trips = listOf(SavedTrip("t", a, b)),
            focus = FocusedJourney("t", false, j, board, alternatives = alternatives,
                arrivalGuard = ArrivalGuard(true, 12_000, ArrivalBasis.Location, 13_000)), modes = emptySet())
        val restored = Wire.user(JSONObject(Wire.user(data).toString()))
        assertEquals(data, restored)
        assertEquals("exact", restored.focus?.journey?.legs?.first()?.identity?.tripId)
        assertEquals(alternatives, restored.focus?.alternatives)
        assertTrue(restored.focus!!.board.serverStale)
        assertFalse(restored.focus.alternatives!!.serverStale)
        assertEquals(TransferConstraint(0), restored.focus.board.fetchConstraint)
        assertEquals(TransferConstraint(null), restored.focus.board.recommendationPages.single().constraint)
        assertEquals(13_000L, restored.focus.arrivalGuard?.confirmedAt)
        assertEquals(pageBody, restored.focus.board.recommendation?.source)
        assertTrue(restored.modes.isEmpty())
    }
    @Test fun recoveryRecordSurvivesRestartAndAMalformedOneDropsAlone() {
        val a = Station("a", "A"); val b = Station("b", "B"); val c = Station("c", "C")
        val followed = Journey(listOf(
            Leg("T9", "train", "B", a, b, 10_000, 20_000, fromPlatform = "1", toPlatform = "3"),
            Leg("T4", "train", "C", b, c, 19_000, 40_000, fromPlatform = "5", toPlatform = "2"),
        ))
        val board = BoardData(a, c, listOf(followed), 9_000, source = "live")
        val recovery = Recovery(0, Journey(listOf(Leg("T4", "train", "C", b, c, 70_000, 90_000,
            fromPlatform = "5", toPlatform = "2"))), 11_000, RecoverySource(9_500, degraded = true))
        val data = UserData(trips = listOf(SavedTrip("t", a, c)),
            focus = FocusedJourney("t", false, followed, board, recovery = recovery))
        val restored = Wire.user(JSONObject(Wire.user(data).toString()))
        assertEquals(data, restored)
        assertEquals(recovery, restored.focus?.recovery)
        assertEquals(listOf("T9", "T4"), restored.focus?.composed?.legs?.map { it.line })
        assertEquals(90_000L, restored.focus?.composed?.effectiveArrival)

        val d = Station("d", "D")
        val movedAnchor = recovery.copy(journey = Journey(listOf(
            Leg("T1", "train", "D", b, d, 30_000, 50_000, fromPlatform = "5", toPlatform = "1"),
            Leg("T4", "train", "C", d, c, 70_000, 90_000, fromPlatform = "2", toPlatform = "2"))), anchor = 1)
        val moved = data.copy(focus = data.focus!!.copy(recovery = movedAnchor))
        assertEquals(movedAnchor, Wire.user(JSONObject(Wire.user(moved).toString())).focus?.recovery)

        val beforeAnchorExisted = Wire.user(moved)
        beforeAnchorExisted.getJSONObject("focus").getJSONObject("recovery").remove("anchor")
        assertEquals(0, Wire.user(JSONObject(beforeAnchorExisted.toString())).focus?.recovery?.anchor)

        val wire = Wire.user(data)
        wire.getJSONObject("focus").getJSONObject("recovery")
            .put("journey", JSONObject("""{"legDetail":[{"broken":true}]}"""))
        val survivor = Wire.user(JSONObject(wire.toString()))
        assertNull(survivor.focus?.recovery)
        assertEquals(followed, survivor.focus?.journey)
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

    @Test fun journeyAlertsSurviveRestartAndDefaultToOn() {
        val off = UserData(journeyAlerts = false)
        assertEquals(off, Wire.user(JSONObject(Wire.user(off).toString())))
        assertTrue(Wire.user(JSONObject(Wire.user(UserData()).toString())).journeyAlerts)
        assertTrue(Wire.user(JSONObject("{}")).journeyAlerts)
        assertTrue(Wire.user(JSONObject("""{"journeyAlerts":"no"}""")).journeyAlerts)
        assertFalse(Wire.user(JSONObject("""{"journeyAlerts":false}""")).journeyAlerts)
    }

    @Test fun transferConstraintNeedsBothTheFlagAndThePreferenceAndBoundsOfflineRouting() {
        val on = mapOf("transferLimit" to true)
        assertEquals(2, UserData(flags = on).maxTransfers)
        assertEquals(0, UserData(flags = on, transferLimit = TransferLimit.Direct).maxTransfers)
        assertNull(UserData(flags = on, transferLimit = TransferLimit.Any).maxTransfers)
        assertNull(UserData().maxTransfers)
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
