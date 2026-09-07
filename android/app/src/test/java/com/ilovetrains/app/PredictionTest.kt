package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test
import java.time.ZonedDateTime
import java.util.TimeZone

class PredictionTest {
    private val central = Station("200060", "Central", -33.884, 151.206)
    private val rhodes = Station("213820", "Rhodes", -33.8308, 151.0879)
    private val bondi = Station("202210", "Bondi Junction", -33.891, 151.248)
    private val now = ZonedDateTime.parse("2026-09-07T08:00:00+10:00[Australia/Sydney]").toInstant().toEpochMilli()
    private val first = SavedTrip("a", rhodes, central)
    private val second = SavedTrip("b", rhodes, bondi)

    @Test fun tiePreservesLastExplicitDirection() {
        val d = UserData(trips = listOf(first, second), lastTripId = "b", lastReverse = true)
        assertEquals(Selection("b", true), predict(d, emptyList(), null, now))
    }
    @Test fun nearbyDestinationSelectsReturnWithoutInventingRide() {
        val d = UserData(trips = listOf(first))
        val selection = predict(d, listOf(central, rhodes), Fix(central.lat, central.lon, now), now)
        assertEquals("a", selection?.tripId); assertEquals(true, selection?.reverse)
        assertTrue(selection?.receipt?.contains("ride") != true)
    }
    @Test fun aSavedOriginWithinTwoKmBeatsCloserUnfamiliarStation() {
        val stranger = Station("s", "Stranger", -33.833, 151.0879)
        val d = UserData(trips = listOf(first))
        assertEquals(rhodes, stationHere(d, listOf(rhodes, stranger), Fix(-33.836, 151.0879, now), now))
    }
    @Test fun staleAndDisabledLocationCannotInfluenceChoice() {
        val d = UserData(trips = listOf(first))
        assertNull(stationHere(d, listOf(central), Fix(central.lat, central.lon, now - 300_001), now))
        assertEquals(Selection("a", false), predict(d.copy(useLocation = false), listOf(central), Fix(central.lat, central.lon, now), now))
    }
    @Test fun homeNeedsThreeVotesAndManualHomeDoesNotEraseThem() {
        val two = listOf(HomeVote("2026-09-01", bondi), HomeVote("2026-09-02", bondi))
        val d = UserData(trips = listOf(first), votes = two, home = central)
        assertEquals(rhodes, automaticHome(d))
        assertEquals(bondi, automaticHome(d.copy(votes = two + HomeVote("2026-09-03", bondi))))
    }
    @Test fun modesAreAppliedToEveryEndpoint() {
        val ferry = SavedTrip("f", central, Station("manly", "Manly Wharf", modes = setOf("ferry")))
        assertFalse(compatible(ferry, setOf("train")))
        assertNull(predict(UserData(trips = listOf(first), modes = emptySet()), emptyList(), null, now))
    }
    @Test fun pastPredictionsAreNeverMadeFreshByReceiptTime() {
        val board = BoardData(central, rhodes, emptyList(), now - 91_000, source = "live")
        assertFalse(board.isLive(now)); assertFalse(board.copy(generatedAt = now, offline = true).isLive(now))
        assertFalse(board.copy(generatedAt = now, serverStale = true).isLive(now))
        assertFalse(board.copy(generatedAt = now, source = "schedule").isLive(now))
        assertFalse(board.copy(generatedAt = now + 60_000).isLive(now))
    }
    @Test fun inferenceRequiresPlatformEvidenceAndMovementTowardDestination() {
        val j = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now - 300_000, now + 1_200_000)))
        val board = BoardData(rhodes, central, listOf(j), now)
        val d = UserData(trips = listOf(first), lastAnswer = LastAnswer("a", false, now - 400_000, rhodes.id, board, j))
        assertNull(inferredFocus(d, Fix(rhodes.lat, rhodes.lon, now), now))
        assertNull(inferredFocus(d.copy(lastAnswer = d.lastAnswer!!.copy(stationId = null)), Fix(-33.85, 151.13, now), now))
        val f = inferredFocus(d, Fix(-33.85, 151.13, now), now)
        assertNotNull(f); assertFalse(f!!.pinned)
        assertNull(inferredFocus(d.copy(rides = listOf(Ride("a", false, j.departure, j.arrival))), Fix(-33.85, 151.13, now), now))
        assertNull(inferredFocus(d.copy(modes = emptySet()), Fix(-33.85, 151.13, now), now))
    }

    @Test fun incompatibleFocusIsHiddenButRetained() {
        val ferry = Station("f", "Ferry Wharf", modes = setOf("ferry"))
        val trip = SavedTrip("ferry", central, ferry)
        val journey = Journey(listOf(Leg("F1", "ferry", "Ferry Wharf", central, ferry, now, now + 600_000)))
        val focus = FocusedJourney(trip.id, false, journey, BoardData(central, ferry, listOf(journey), now))
        val data = UserData(trips = listOf(trip), focus = focus, modes = setOf("train"))
        assertNull(visibleFocus(data, now))
        assertSame(focus, data.focus)
        assertSame(focus, visibleFocus(data.copy(modes = setOf("train", "ferry")), now))
        val mixed = journey.copy(legs = listOf(
            Leg("T1", "train", "Central", central, bondi, now, now + 300_000),
            journey.legs.single().copy(from = bondi, departure = now + 360_000),
        ))
        assertNull(visibleFocus(data.copy(modes = setOf("ferry"), focus = focus.copy(journey = mixed)), now))
    }

    @Test fun inferenceRequiresBothEndpointCoordinatesEvenWithSpeedEvidence() {
        for (missingOrigin in listOf(false, true)) {
            val origin = if (missingOrigin) Station(rhodes.id, rhodes.name) else rhodes
            val destination = if (missingOrigin) central else Station(central.id, central.name)
            val trip = SavedTrip("a", origin, destination)
            val journey = Journey(listOf(Leg("T9", "train", "Central", origin, destination,
                now - 300_000, now + 1_200_000)))
            val board = BoardData(origin, destination, listOf(journey), now)
            val data = UserData(trips = listOf(trip), lastAnswer = LastAnswer(
                trip.id, false, now - 400_000, origin.id, board, journey))
            for (speed in listOf(null, 12.0)) {
                assertNull("missingOrigin=$missingOrigin, speed=$speed",
                    inferredFocus(data, Fix(-33.85, 151.13, now, speed), now))
            }
        }
    }

    @Test fun historyUsesSydneyTimeWhenDeviceTimezoneDiffers() {
        val previous = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            val event = ZonedDateTime.parse("2026-09-01T08:00:00+10:00[Australia/Sydney]").toInstant().toEpochMilli()
            assertTrue(historyScore(listOf(ViewEvent("a", false, event)), "a", false, now) > .5)
        } finally {
            TimeZone.setDefault(previous)
        }
    }

    @Test fun staleFixDoesNotSuppressHistoryReceipt() {
        val history = (1L..3L).map { days ->
            ViewEvent("a", false, now - days * 7 * 86_400_000)
        }
        val data = UserData(trips = listOf(first, second), history = history)
        val stale = Fix(rhodes.lat, rhodes.lon, now - 300_001)
        assertEquals("You check this trip most weekday mornings.", predict(data, listOf(rhodes), stale, now)?.receipt)
    }

    @Test fun savedTripMetadataUsesDisplayedDirectionAndCompletedRides() {
        val yesterday = ZonedDateTime.parse("2026-09-06T18:00:00+10:00[Australia/Sydney]").toInstant().toEpochMilli()
        val data = UserData(trips = listOf(first), rides = listOf(Ride("a", false, yesterday - 1000, yesterday)))
        val nearCentral = Fix(central.lat, central.lon, now)
        assertEquals("10 m away · Last ridden yesterday", savedTripMetadata(data, nearCentral, "a", true, now)["a"])
        assertEquals("Never ridden", savedTripMetadata(data.copy(rides = emptyList()), null, "a", false, now)["a"])
        assertEquals("Never ridden", savedTripMetadata(data.copy(rides = emptyList(), useLocation = false), nearCentral, "a", true, now)["a"])
    }
}
