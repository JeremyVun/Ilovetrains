package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TravelTrackerStateTest {
    @Test fun acceptedPresentationCasesMatchTheSharedFixture() {
        val fixture = JSONObject(resource("/travel-tracker.json"))
        val base = fixture.getJSONObject("base")
        val cases = fixture.getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val expected = case.getJSONObject("expected")
            val focus = fixtureFocus(fixture, base, case)
            val state = requireNotNull(TravelTrackerState.derive(focus, case.getLong("now"), 7))

            assertEquals(case.getString("name"), expected.getString("stage"), state.stage.name.lowercase())
            assertEquals(case.getString("name"), expected.getInt("activeLeg"), state.activeLegIndex)
            assertEquals(case.getString("name"), expected.getString("eventName"), state.event.name)
            assertEquals(case.getString("name"), expected.getInt("countdown"), state.event.countdownMinutes)
            assertEquals(case.getString("name"), state.event.deadline, state.nextBoundary)
            assertEquals(case.getString("name"), expected.getString("headlineLead"), state.headline.lead)
            assertEquals(case.getString("name"), expected.getString("headlineEmphasis"), state.headline.emphasis)
            assertEquals(case.getString("name"), expected.getString("instruction"), state.instruction)
            assertEquals(case.getString("name"), expected.stringOrNull("connection"), state.connection)
            assertEquals(case.getString("name"), expected.getString("destination"), state.destination)
            assertEquals(case.getString("name"), expected.getString("eta"), state.etaText)
            assertEquals(case.getString("name"), expected.getBoolean("tight"), state.tightConnection)
            assertEquals(case.getString("name"), expected.getString("freshness"), state.freshness.name.lowercase())
            assertEquals(case.getString("name"), expected.getString("provenance"), state.provenance)
            assertEquals(case.getString("name"), strings(expected, "platforms"), state.platforms.map { "${it.role.name.lowercase()}:${it.label}" })
            assertEquals(case.getString("name"), ints(expected, "segmentsMinutes"), state.segments.map { ((it.end - it.start) / 60_000).toInt() })
            assertEquals(
                case.getString("name"),
                expected.getDouble("progressNumerator") / expected.getDouble("progressDenominator"),
                state.progress,
                0.000_001,
            )
            if (state.freshness == TravelTrackerFreshness.Live) {
                assertEquals(case.getString("name"), case.getLong("now") + 90_000, state.freshUntil)
            } else assertNull(case.getString("name"), state.freshUntil)
        }
    }

    @Test fun identityAndGenerationRejectReplacementFocusAndLatePublication() {
        val focus = twoLegFocus()
        val original = requireNotNull(TravelTrackerState.derive(focus, 6 * MINUTE, 4))
        assertEquals("T1:300000|M2:1500000", original.revision.identity.serviceKey)
        val realtime = focus.copy(journey = focus.journey.copy(legs = focus.journey.legs.mapIndexed { index, leg ->
            leg.copy(
                estimatedDeparture = leg.departure + MINUTE,
                estimatedArrival = leg.arrival + MINUTE,
                fromPlatform = if (index == 1) "9" else leg.fromPlatform,
            )
        }))
        val updated = requireNotNull(TravelTrackerState.derive(realtime, 6 * MINUTE, 5))
        assertEquals(original.revision.identity, updated.revision.identity)
        assertTrue(updated.revision.canReplace(original.revision))
        assertFalse(original.revision.canReplace(updated.revision))

        val replacement = realtime.copy(journey = realtime.journey.copy(legs = realtime.journey.legs.mapIndexed { index, leg ->
            if (index == 0) leg.copy(line = "T2") else leg
        }))
        val replacementState = requireNotNull(TravelTrackerState.derive(replacement, 6 * MINUTE, 6))
        assertFalse(replacementState.revision.canReplace(updated.revision))
        assertFalse(requireNotNull(TravelTrackerState.derive(realtime.copy(reverse = true), 6 * MINUTE, 6)).revision.canReplace(updated.revision))

        val differentDeparture = realtime.copy(journey = realtime.journey.copy(legs = realtime.journey.legs.mapIndexed { index, leg ->
            if (index == 0) leg.copy(departure = leg.departure + MINUTE) else leg
        }))
        assertFalse(requireNotNull(TravelTrackerState.derive(differentDeparture, 6 * MINUTE, 6)).revision.canReplace(updated.revision))
    }

    @Test fun retainedDelayNeverFallsBackToTheScheduleAndFreshnessNeverRenewsOnRender() {
        val focus = twoLegFocus().let { value ->
            val delayed = value.journey.copy(retained = true, legs = value.journey.legs.map {
                it.copy(estimatedDeparture = it.departure + 5 * MINUTE, estimatedArrival = it.arrival + 5 * MINUTE)
            })
            value.copy(journey = delayed, board = value.board.copy(journeys = listOf(delayed), generatedAt = MINUTE))
        }
        val state = requireNotNull(TravelTrackerState.derive(focus, 11 * MINUTE, 1))
        assertEquals(TravelTrackerStage.Ride, state.stage)
        assertEquals(9, state.event.countdownMinutes)
        assertEquals(45 * MINUTE, state.eta)
        assertEquals(TravelTrackerFreshness.Retained, state.freshness)
        assertNull(state.freshUntil)

        val futureSource = focus.copy(journey = focus.journey.copy(retained = false), board = focus.board.copy(generatedAt = 12 * MINUTE))
        val futureState = requireNotNull(TravelTrackerState.derive(futureSource, 11 * MINUTE, 1))
        assertEquals(TravelTrackerFreshness.Stale, futureState.freshness)
        assertNull(futureState.freshUntil)
    }

    @Test fun cancellationStaysOnTheChosenIdentityAndDoesNotOfferAnotherService() {
        val focus = twoLegFocus()
        val cancelled = focus.copy(journey = focus.journey.copy(legs = listOf(
            focus.journey.legs[0], focus.journey.legs[1].copy(cancelled = true),
        )))
        val state = requireNotNull(TravelTrackerState.derive(cancelled, 6 * MINUTE, 1))
        assertEquals(focus.journey.key, state.revision.identity.serviceKey)
        assertEquals(TravelTrackerEventKind.Cancellation, state.event.kind)
        assertEquals("M2 cancelled", state.headline.text)
        assertEquals("10:25 from Change cancelled.", state.instruction)
        assertTrue(state.arrivalCancelled)
        assertTrue(state.cancelled)
        assertNull(state.connection)

        val firstCancelled = focus.copy(journey = focus.journey.copy(legs = listOf(
            focus.journey.legs[0].copy(cancelled = true), focus.journey.legs[1],
        )))
        assertFalse(requireNotNull(TravelTrackerState.derive(firstCancelled, 6 * MINUTE, 1)).arrivalCancelled)
    }

    @Test fun midnightMultipleLegWalkingHandoffAndNegativeWaitUseRealTimelinePositions() {
        val beforeMidnight = 1_788_875_880_000L
        val ferryStart = Station("train-hub", "Circular Quay")
        val ferryWharf = Station("ferry-stop", "Circular Quay")
        val legs = listOf(
            Leg("T2", "train", "City", Station("a", "Alpha Station"), ferryStart,
                beforeMidnight, beforeMidnight + 5 * MINUTE, toPlatform = "1"),
            Leg("F1", "ferry", "Barangaroo", ferryWharf, Station("wharf", "Barangaroo Wharf"),
                beforeMidnight + 8 * MINUTE, beforeMidnight + 12 * MINUTE, fromPlatform = "Wharf 2", toPlatform = "Side A"),
            Leg("M1", "metro", "Tallawong", Station("metro-a", "Barangaroo Station"), Station("z", "Final Station"),
                beforeMidnight + 14 * MINUTE, beforeMidnight + 19 * MINUTE, fromPlatform = "3", toPlatform = "4"),
        )
        val focus = focus(legs)
        val first = requireNotNull(TravelTrackerState.derive(focus, beforeMidnight + MINUTE, 1))
        assertEquals(4, first.event.countdownMinutes)
        assertEquals(listOf("Platform 1", "Wharf 2"), first.platforms.map { it.label })
        assertEquals(listOf("train-hub", "ferry-stop"), first.platforms.map { it.stationId })
        assertEquals(listOf("train", null, "ferry", null, "metro"), first.segments.map { it.mode })
        assertEquals(listOf(5, 3, 4, 2, 5), first.segments.map { ((it.end - it.start) / MINUTE).toInt() })

        val overlap = listOf(
            legs[0].copy(departure = 0, arrival = 10 * MINUTE),
            legs[1].copy(departure = 8 * MINUTE, arrival = 20 * MINUTE),
        )
        val duringFirst = requireNotNull(TravelTrackerState.derive(focus(overlap), 9 * MINUTE, 1))
        assertEquals(TravelTrackerStage.Ride, duringFirst.stage)
        assertEquals("F1 departs 10:08 before arrival", duringFirst.connection)
        assertEquals("Get off on Platform 1.", duringFirst.instruction)
        assertEquals(listOf(TravelTrackerPlatformRole.Alight), duringFirst.platforms.map { it.role })
        assertFalse(duringFirst.tightConnection)
        assertEquals("Planned 10:20", duringFirst.etaText)
        assertEquals(0, duringFirst.missedConnection?.fromLegIndex)
        assertEquals(1, duringFirst.missedConnection?.toLegIndex)
        assertEquals("train-hub", duringFirst.missedConnection?.arrivalStationId)
        assertEquals("ferry-stop", duringFirst.missedConnection?.departureStationId)
        assertEquals(0.0, duringFirst.segments[1].lengthFraction, 0.0)
        assertTrue(duringFirst.segments[1].endFraction < duringFirst.segments[1].startFraction)
        val afterFirst = requireNotNull(TravelTrackerState.derive(focus(overlap), 10 * MINUTE, 1))
        assertEquals(TravelTrackerStage.MissedTransfer, afterFirst.stage)
        assertEquals(0, afterFirst.activeLegIndex)
        assertEquals(TravelTrackerEventKind.MissedConnection, afterFirst.event.kind)
        assertNull(afterFirst.event.countdownMinutes)
        assertEquals("F1 connection unavailable", afterFirst.headline.text)
        assertEquals("F1 departure 10:08 is before the 10:10 arrival.", afterFirst.instruction)
        assertTrue(afterFirst.platforms.isEmpty())
        assertFalse(afterFirst.tightConnection)
        assertEquals(20 * MINUTE, afterFirst.nextBoundary)
        assertNull(TravelTrackerState.derive(focus(overlap), 20 * MINUTE, 1))

        val lateEarlierLeg = listOf(overlap[0].copy(arrival = 25 * MINUTE), overlap[1])
        val stillRiding = requireNotNull(TravelTrackerState.derive(focus(lateEarlierLeg), 21 * MINUTE, 1))
        assertEquals(TravelTrackerStage.Ride, stillRiding.stage)
        assertEquals(25 * MINUTE, stillRiding.nextBoundary)
        assertEquals(21.0 / 25.0, stillRiding.progress, 0.000_001)
        assertEquals(1.0, stillRiding.segments[0].endFraction, 0.000_001)
        assertEquals(20.0 / 25.0, stillRiding.segments.last().endFraction, 0.000_001)
        assertNull(TravelTrackerState.derive(focus(lateEarlierLeg), 25 * MINUTE, 1))
    }

    @Test fun ferrySideAndNamedWharfKeepFerryVocabulary() {
        val ferry = focus(listOf(Leg(
            "F1", "ferry", "Circular Quay", Station("a", "Barangaroo Wharf"), Station("b", "Balmain Wharf"),
            0, 10 * MINUTE, fromPlatform = "Wharf 4, Side B", toPlatform = "Side A",
        )))
        val final = requireNotNull(TravelTrackerState.derive(ferry, MINUTE, 1))
        assertEquals("Get off at Side A.", final.instruction)
        assertEquals("Side A", final.platforms.single().label)

        val named = ferry.copy(journey = ferry.journey.copy(legs = listOf(ferry.journey.legs.single().copy(toPlatform = "Balmain Wharf"))))
        assertEquals("Get off at Balmain Wharf.", requireNotNull(TravelTrackerState.derive(named, MINUTE, 1)).instruction)
    }

    @Test fun countdownUsesPrintedMinuteBoundariesAndRoundsOnlyLongHeadlineDisplay() {
        val leg = Leg("T1", "train", "End", Station("a", "Start"), Station("b", "End"),
            0, 10 * MINUTE + 1_000)
        val state = requireNotNull(TravelTrackerState.derive(focus(listOf(leg)), 5 * MINUTE + 59_000, 1))
        assertEquals(5, state.event.countdownMinutes)
        assertEquals("5 min.", state.headline.emphasis)

        val long = leg.copy(arrival = 120 * MINUTE)
        val longState = requireNotNull(TravelTrackerState.derive(focus(listOf(long)), 1_000, 1))
        assertEquals(120, longState.event.countdownMinutes)
        assertEquals("2 hr.", longState.headline.emphasis)
    }

    @Test fun delayedDepartureCanProjectBoardingWithoutMakingItEligibleAndCompletionOnlyEndsProjection() {
        val focus = twoLegFocus().let { value ->
            val delayed = value.journey.copy(legs = value.journey.legs.mapIndexed { index, leg ->
                if (index == 0) leg.copy(estimatedDeparture = 8 * MINUTE) else leg
            })
            value.copy(journey = delayed, board = value.board.copy(journeys = listOf(delayed)))
        }
        val boarding = requireNotNull(TravelTrackerState.derive(focus, 6 * MINUTE, 1))
        assertEquals(TravelTrackerStage.Boarding, boarding.stage)
        assertEquals("T1 leaves in 2 min.", boarding.headline.text)
        assertEquals(8 * MINUTE, boarding.nextBoundary)
        assertNull(TravelTrackerState.derive(focus, focus.journey.effectiveArrival, 1))
    }

    private fun twoLegFocus(): FocusedJourney = focus(listOf(
        Leg("T1", "train", "Change", Station("a", "Start Station"), Station("b", "Change Station"),
            5 * MINUTE, 15 * MINUTE, fromPlatform = "1", toPlatform = "2"),
        Leg("M2", "metro", "Finish", Station("b", "Change Station"), Station("c", "Finish Station"),
            25 * MINUTE, 40 * MINUTE, fromPlatform = "3", toPlatform = "4"),
    ))

    private fun focus(legs: List<Leg>): FocusedJourney {
        val journey = Journey(legs)
        val board = BoardData(legs.first().from, legs.last().to, listOf(journey), 6 * MINUTE, source = "live")
        return FocusedJourney("trip", false, journey, board, pinned = false)
    }

    private fun fixtureFocus(root: JSONObject, base: JSONObject, case: JSONObject): FocusedJourney {
        val changeName = case.optString("changeName", base.getJSONArray("legs").getJSONObject(0).getJSONObject("to").getString("name"))
        val legObjects = base.getJSONArray("legs")
        val legs = (0 until legObjects.length()).map { index ->
            val value = legObjects.getJSONObject(index)
            fun station(key: String): Station {
                val raw = value.getJSONObject(key)
                val name = if ((index == 0 && key == "to") || (index == 1 && key == "from")) changeName else raw.getString("name")
                return Station(raw.getString("id"), name)
            }
            Leg(
                value.getString("line"), value.getString("mode"), value.getString("headsign"),
                station("from"), station("to"),
                if (index == 1 && case.has("onwardDeparture")) case.getLong("onwardDeparture") else value.getLong("departure"),
                value.getLong("arrival"),
                fromPlatform = value.stringOrNull("fromPlatform"),
                toPlatform = if (index == 1 && case.has("finalPlatform")) case.stringOrNull("finalPlatform") else value.stringOrNull("toPlatform"),
            )
        }
        val journey = Journey(legs, retained = case.optBoolean("retained"))
        val generatedAt = if (case.has("generatedAt")) case.getLong("generatedAt") else case.getLong("now")
        val board = BoardData(legs.first().from, legs.last().to, listOf(journey), generatedAt,
            source = base.getString("source"), offline = case.optBoolean("offline"))
        return FocusedJourney(root.getString("tripId"), root.getBoolean("reverse"), journey, board, pinned = false)
    }

    private fun strings(value: JSONObject, key: String) = value.getJSONArray(key).let { array ->
        (0 until array.length()).map(array::getString)
    }

    private fun ints(value: JSONObject, key: String) = value.getJSONArray(key).let { array ->
        (0 until array.length()).map(array::getInt)
    }

    private fun resource(name: String) = requireNotNull(javaClass.getResourceAsStream(name)).bufferedReader().use { it.readText() }

    private companion object { const val MINUTE = 60_000L }
}
