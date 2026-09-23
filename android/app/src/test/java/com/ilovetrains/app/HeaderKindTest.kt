package com.ilovetrains.app

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZonedDateTime
import java.util.TimeZone

class HeaderKindTest {
    private val central = Station("200060", "Central", -33.884, 151.206)
    private val rhodes = Station("213820", "Rhodes", -33.8308, 151.0879)
    private val bondi = Station("202210", "Bondi Junction", -33.891, 151.248)
    private val stranger = Station("221710", "Strathfield", -33.8717, 151.0942)
    private val now = ZonedDateTime.parse("2026-09-07T08:00:00+10:00[Australia/Sydney]").toInstant().toEpochMilli()
    private val stations = listOf(central, rhodes, bondi, stranger)
    private val toCentral = SavedTrip("a", rhodes, central)
    private val fromCentral = SavedTrip("c", central, bondi)
    private fun at(station: Station) = Fix(station.lat, station.lon, now)
    private fun daily(tripId: String, days: Int) = (1..days).map { ViewEvent(tripId, false, now - it * 86_400_000L) }

    @Test fun withNoStationHereTheAnswerIsPredicted() {
        val data = UserData(trips = listOf(toCentral, fromCentral))
        assertEquals(HeaderKind.Predicted, predict(data, stations, null, now)?.kind)
        assertEquals(HeaderKind.Predicted, predict(data.copy(useLocation = false), stations, at(central), now)?.kind)
        assertEquals(HeaderKind.Predicted, predict(data, stations, at(central).copy(at = now - 300_001), now)?.kind)
    }

    @Test fun theHomewardFallbackIsHomeAndAHabitAtTheSameStationIsUsual() {
        val data = UserData(trips = listOf(toCentral, fromCentral))
        val homeward = requireNotNull(predict(data, stations, at(central), now))
        assertEquals(Selection("a", true, homeward.receipt, HeaderKind.Home), homeward)
        val habit = requireNotNull(predict(data.copy(history = daily("c", 3)), stations, at(central), now))
        assertEquals("c", habit.tripId)
        assertEquals(HeaderKind.Usual, habit.kind)
    }

    @Test fun anyOtherAnswerFromAStationHereIsUsual() {
        val data = UserData(trips = listOf(toCentral, SavedTrip("b", rhodes, bondi)))
        assertEquals("standing at home offers no homeward trip", HeaderKind.Usual, predict(data, stations, at(rhodes), now)?.kind)
        val strangerHere = predict(data, stations, at(stranger), now)
        assertEquals("a station with no saved trip from it", HeaderKind.Usual, strangerHere?.kind)
    }

    @Test fun nativeKindsMatchTheWebAnswerKindForEverySharedPredictionCase() {
        val web = mapOf(
            "repeated checks do not beat a local homeward fallback" to "home",
            "established local history still outranks homeward fallback" to "usual",
            "standing at destination chooses real return pair" to "home",
            "relevant origin history outranks home fallback" to "usual",
            "three first-open votes infer home" to "home",
        )
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Australia/Sydney"))
        try {
            val cases = JSONArray(requireNotNull(javaClass.getResourceAsStream("/prediction.json")).bufferedReader().use { it.readText() })
            val names = mutableSetOf<String>()
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index); val raw = case.getJSONObject("doc")
                val name = case.getString("name"); names += name
                val at = Instant.parse(case.getString("now")).toEpochMilli()
                val data = UserData(
                    trips = raw.getJSONArray("trips").readEach { SavedTrip(it.getString("id"), Wire.station(it.getJSONObject("from")), Wire.station(it.getJSONObject("to"))) },
                    history = raw.getJSONArray("history").readEach { ViewEvent(it.getString("tripId"), it.getString("direction") == "reverse", Instant.parse(it.getString("t")).toEpochMilli()) },
                    votes = raw.getJSONArray("homeVotes").readEach { HomeVote(it.getString("day"), Wire.station(it.getJSONObject("station"))) },
                    useLocation = raw.getJSONObject("preferences").optBoolean("useLocation", true),
                    lastTripId = raw.optJSONObject("lastViewed")?.getString("tripId"), lastReverse = raw.optJSONObject("lastViewed")?.getString("direction") == "reverse")
                val fix = case.optJSONObject("fix")?.let { Fix(it.getDouble("lat"), it.getDouble("lon"), at) }
                val stations = case.getJSONArray("stations").readEach(Wire::station)
                assertEquals(name, web[name] ?: "predicted", predict(data, stations, fix, at)?.kind?.wire)
                assertEquals(name, HeaderKind.Predicted, predict(data.copy(useLocation = false), stations, fix, at)?.kind)
            }
            assertTrue(names.containsAll(web.keys))
        } finally { TimeZone.setDefault(previous) }
    }

    @Test fun aVisibleFocusNamesItsOwnKindAndAnExplicitChoiceIsBrowsing() {
        val journey = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now, now + 1_200_000)))
        val pinned = FocusedJourney("a", false, journey, BoardData(rhodes, central, listOf(journey), now))
        val predicted = Selection("a", false, kind = HeaderKind.Home)
        assertEquals(HeaderKind.Focus, homeAnswerKind(pinned, browsing = true, predicted, "a", false))
        assertEquals(HeaderKind.Inferred, homeAnswerKind(pinned.copy(pinned = false), browsing = false, null, "a", false))
        assertEquals(HeaderKind.Home, homeAnswerKind(null, browsing = false, predicted, "a", false))
        assertNull(homeAnswerKind(null, browsing = true, predicted, "a", false))
        assertNull("an answer home did not predict is not its own", homeAnswerKind(null, browsing = false, predicted, "a", true))
        assertNull(homeAnswerKind(null, browsing = false, null, "a", false))
    }

    @Test fun theLeadIsTheJourneyHomeShowsForTheSelectedTripAndDirection() {
        val sooner = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now + 120_000, now + 1_500_000)))
        val later = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now + 600_000, now + 2_000_000)))
        val board = BoardData(rhodes, central, listOf(later, sooner), now, source = "live")
        val state = AppState(ready = true, trips = listOf(toCentral), selectedTripId = "a", board = board, homeBoard = board, now = now)
        assertEquals(sooner.key, displayedHomeLead(state)?.key)
        assertNull("a board for the other direction is not this answer's", displayedHomeLead(state.copy(reverse = true)))
        assertNull(displayedHomeLead(state.copy(board = null, homeBoard = null)))
        assertNull(displayedHomeLead(state.copy(board = board.copy(journeys = emptyList()), homeBoard = null)))
    }

    @Test fun onlyAWriteThatAppendsTheRideCountsIt() {
        val journey = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now - 1_500_000, now - 60_000)))
        val focus = FocusedJourney("a", false, journey, BoardData(rhodes, central, listOf(journey), now))
        val recorded = emptyList<Ride>().settled(focus, arrived = true)
        assertTrue(recordedNewRide(emptyList(), recorded, focus))

        val moved = focus.copy(journey = Journey(listOf(journey.legs.single().copy(estimatedArrival = now - 30_000))))
        val corrected = recorded.settled(moved, arrived = true)
        assertEquals(now - 30_000, corrected.single().arrival)
        assertFalse("a correction", recordedNewRide(recorded, corrected, moved))
        assertSame(corrected, corrected.settled(moved, arrived = true))
        assertFalse(recordedNewRide(corrected, corrected, moved))

        val withdrawn = corrected.settled(moved, arrived = false)
        assertFalse(recordedNewRide(corrected, withdrawn, moved))
        assertTrue("a withdrawn estimate recorded again counts again", recordedNewRide(withdrawn, withdrawn.settled(moved, arrived = true), moved))

        val full = (1..100).map { Ride("old$it", false, it.toLong(), it + 1L) }
        val appended = full.settled(focus, arrived = true)
        assertEquals(100, appended.size)
        assertTrue("the hundred-ride cap still appends", recordedNewRide(full, appended, focus))
    }

    @Test fun theReducerRecordsOnceThenOnlyCorrects() {
        val journey = Journey(listOf(Leg("T9", "train", "Central", rhodes, central, now - 1_500_000, now - 60_000)))
        var focus = FocusedJourney("a", false, journey, BoardData(rhodes, central, listOf(journey), now))
        var rides = emptyList<Ride>()
        val rode = mutableListOf<Pair<Boolean, ArrivalBasis>>()
        repeat(3) { step ->
            val result = reduceArrival(ArrivalInput("a", journey.effectiveDeparture, focus.journey.effectiveArrival, now + step * 1_000L,
                central, focus.arrivalGuard, legacyCompleted = rides.isNotEmpty()))
            focus = focus.copy(arrivalGuard = result.guard)
            if (result.action == ArrivalAction.Record || result.action == ArrivalAction.Correct) {
                val before = rides
                rides = before.settled(focus, true)
                if (result.basis != null && recordedNewRide(before, rides, focus)) rode += focus.pinned to result.basis!!
            }
        }
        assertEquals(listOf(true to ArrivalBasis.Estimate), rode)
        assertEquals(1, rides.size)
    }
}
