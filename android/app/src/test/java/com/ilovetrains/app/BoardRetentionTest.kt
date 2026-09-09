package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BoardRetentionTest {
    private val now = 1_788_765_000_000L
    private val townHall = Station("200070", "Town Hall Station")
    private val rhodes = Station("213820", "Rhodes Station")
    private val t9 = Journey(listOf(Leg("T9", "train", "Epping", townHall, rhodes,
        now + 60_000, now + 25 * 60_000, now + 4 * 60_000, now + 28 * 60_000)))
    private val previous = BoardData(townHall, rhodes, listOf(t9), now, source = "live", homeJourneyKey = t9.key)
    private val localT9 = Journey(t9.legs.map { it.copy(identity = TripIdentity("sydneytrains", "T9.42", "2026-09-07", townHall.id, rhodes.id)) })

    @Test fun offlinePinKeepsItsLastKnownDelayAndArrivalAcrossRestart() {
        val focus = FocusedJourney("trip", false, t9, previous).lastKnown()
        val restored = Wire.user(JSONObject(Wire.user(UserData(focus = focus)).toString())).focus!!
        assertEquals(t9.effectiveArrival, restored.journey.effectiveArrival)
        assertTrue(restored.journey.retained)
        assertTrue(restored.board.offline)
        assertFalse(restored.board.isLive(now))
    }

    @Test fun cachedRecommendationKeepsItsOwnSourceButCannotLookFreshOffline() {
        val source = previous.copy(journeys = listOf(t9), generatedAt = now)
        val cached = previous.copy(journeys = emptyList(), homeJourneyKey = t9.key,
            recommendation = RecommendationResult(t9, source)).lastKnown()

        assertEquals(t9.key, nextHomeJourney(cached, now)?.key)
        assertTrue(cached.recommendation!!.journey.retained)
        assertTrue(cached.recommendation.source.offline)
        assertFalse(cached.recommendation.source.isLive(now))
        assertEquals(t9.key, nextHomeJourney(cached, now + 9 * 60_000)?.key)
        val scheduled = previous.copy(journeys = emptyList(), source = "schedule", offline = true,
            recommendation = RecommendationResult(Journey(t9.legs.map { it.copy(estimatedArrival = null) }), previous))
        val reopened = requireNotNull(mergeBoardResults(cached, scheduled, null, now + 9 * 60_000))
        assertEquals(t9.effectiveArrival, nextHomeJourney(reopened, now + 9 * 60_000)?.effectiveArrival)
    }

    @Test fun aCachedBoardLosesItsThreeChangeRowsOnlyWhileTheCapIsOn() {
        val hub = Station("200060", "Central Station")
        fun leg(from: Station, to: Station, index: Int) = Leg("T1", "train", to.name, from, to,
            now + index * 20 * 60_000L, now + (index * 20 + 15) * 60_000L)
        val threeChanges = Journey(listOf(leg(townHall, hub, 0), leg(hub, rhodes, 1), leg(rhodes, hub, 2), leg(hub, rhodes, 3)))
        val cached = Wire.board(JSONObject(Wire.board(previous.copy(journeys = listOf(t9, threeChanges))).toString()))

        assertEquals(listOf(t9.key), cached.withinTransferCap(2).journeys.map { it.key })
        assertEquals(listOf(t9.key, threeChanges.key), cached.withinTransferCap(null).journeys.map { it.key })
        assertFalse(threeChanges.withinTransferCap(2))
        assertTrue(threeChanges.withinTransferCap(null))
        assertTrue(t9.withinTransferCap(2))
    }

    @Test fun delayedTrainSurvivesOfflineReopenFiveMinutesAfterDeparture() {
        val reopened = now + 9 * 60_000
        val cached = Wire.board(JSONObject(Wire.board(previous).toString()))
        val emptyLocal = BoardData(townHall, rhodes, emptyList(), now - 86_400_000, offline = true)
        val result = requireNotNull(mergeBoardResults(cached, emptyLocal, null, reopened))
        assertTrue(result.offline)
        assertEquals(t9.key, result.journeys.single().key)
        assertEquals(t9.effectiveDeparture, result.journeys.single().effectiveDeparture)
        assertEquals(t9.key, retainedHomeJourney(result, reopened)?.key)
        assertEquals("Ago", figureFor(result.journeys.single(), result, reopened).provenance)
        assertEquals("5", figureFor(result.journeys.single(), result, reopened).value)
        assertEquals(result, Wire.board(JSONObject(Wire.board(result).toString())))
    }

    @Test fun scheduledReplanDoesNotErasePreviouslyObservedDelay() {
        val local = previous.copy(source = "schedule", offline = true,
            journeys = listOf(Journey(t9.legs.map { it.copy(estimatedDeparture = null, estimatedArrival = null) })))
        val result = requireNotNull(mergeBoardResults(previous, local, null, now + 5 * 60_000))
        assertEquals(t9.effectiveArrival, result.journeys.single().effectiveArrival)
        assertTrue(result.journeys.single().retained)
    }

    @Test fun successfulLocalReplanDoesNotRelabelAServerStaleResponseOffline() {
        val stale = previous.copy(serverStale = true, generatedAt = now - 120_000)
        val local = previous.copy(source = "schedule", offline = false,
            journeys = listOf(Journey(t9.legs.map { it.copy(estimatedDeparture = null, estimatedArrival = null) })))

        val result = requireNotNull(mergeBoardResults(stale, local, null, now, requestFailed = false))

        assertTrue(result.serverStale)
        assertFalse(result.offline)
    }

    @Test fun onlineFutureReplacesCacheButKeepsDepartedTrain() {
        val later = Journey(t9.legs.map { it.copy(departure = now + 20 * 60_000, arrival = now + 45 * 60_000,
            estimatedDeparture = null, estimatedArrival = null) })
        val online = previous.copy(journeys = listOf(later), generatedAt = now + 9 * 60_000)
        val result = requireNotNull(mergeBoardResults(previous, null, online, now + 9 * 60_000))
        assertEquals(listOf(t9.key, later.key), result.journeys.map { it.key })
        assertTrue(result.journeys.first().retained)
        assertEquals(later.key, nextHomeJourney(result, now + 9 * 60_000)?.key)
        assertNull(retainedHomeJourney(result, now + 9 * 60_000))
        assertEquals("Ago", figureFor(result.journeys.first(), result, now + 9 * 60_000).provenance)
    }

    @Test fun freshObservationOverridesSavedEstimateForSameService() {
        val updated = Journey(t9.legs.map { it.copy(estimatedArrival = now + 32 * 60_000) })
        val online = previous.copy(journeys = listOf(updated), generatedAt = now + 30_000)
        val result = requireNotNull(mergeBoardResults(previous, null, online, now + 30_000))
        assertEquals(listOf(updated), result.journeys)
        assertFalse(result.journeys.single().retained)
    }

    @Test fun authoritativeEmptyOnlineResultRemovesOldFutureDepartures() {
        val result = requireNotNull(mergeBoardResults(previous, null, previous.copy(journeys = emptyList()), now))
        assertTrue(result.journeys.isEmpty())
        assertNull(result.homeJourneyKey)
    }

    @Test fun offlineHeaderKeepsOriginalEvenWhenAnotherDepartureExists() {
        val next = Journey(t9.legs.map { it.copy(departure = now + 20 * 60_000, arrival = now + 45 * 60_000,
            estimatedDeparture = null, estimatedArrival = null) })
        val local = previous.copy(journeys = listOf(next), source = "schedule", offline = true)
        val result = requireNotNull(mergeBoardResults(previous, local, null, now + 9 * 60_000))
        assertEquals(2, result.journeys.size)
        assertEquals(t9.key, nextHomeJourney(result, now + 9 * 60_000)?.key)
        assertNull(retainedHomeJourney(result, t9.effectiveArrival + 30 * 60_000 + 1))
    }

    @Test fun anUnmatchedApiBoardDemotesOnlyTheJourneyItCouldHaveCarried() {
        val identified = FocusedJourney("trip", false, localT9, previous.copy(journeys = listOf(localT9)))
        assertNull(identified.demotedForUnmatchedBoard())
        val online = FocusedJourney("trip", false, t9, previous)
        assertEquals(online.lastKnown(), online.demotedForUnmatchedBoard())
        assertTrue(requireNotNull(online.demotedForUnmatchedBoard()).journey.retained)
    }

    @Test fun aLostOverlayMatchDemotesTheJourneyOnlyThisPhoneCanRefresh() {
        val identified = FocusedJourney("trip", false, localT9, previous.copy(journeys = listOf(localT9)))
        val demoted = requireNotNull(identified.demotedForLostOverlay())
        assertTrue(demoted.journey.retained)
        assertTrue(demoted.board.offline)
        assertFalse(demoted.board.isLive(now))
        assertEquals(localT9.effectiveArrival, demoted.journey.effectiveArrival)
        assertNull(FocusedJourney("trip", false, t9, previous).demotedForLostOverlay())
    }

    @Test fun oldHistoryAndOtherStationPairsCannotLeakIntoBoard() {
        val old = previous.copy(journeys = listOf(Journey(t9.legs.map { it.copy(
            departure = now - 2 * 86_400_000, arrival = now - 2 * 86_400_000 + 60_000,
            estimatedDeparture = null, estimatedArrival = null) })))
        assertTrue(requireNotNull(mergeBoardResults(old, null, null, now)).journeys.isEmpty())
        val reverse = BoardData(rhodes, townHall, emptyList(), now, source = "live")
        assertTrue(requireNotNull(mergeBoardResults(previous, null, reverse, now)).journeys.isEmpty())
    }
}
