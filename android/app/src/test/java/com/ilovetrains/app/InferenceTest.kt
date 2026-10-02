package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        assertEquals(stored, data.withLastAnswer(seen, sightingAt = now + minute - 1).lastAnswer)
        assertEquals(seen, data.withLastAnswer(seen, sightingAt = now + minute).lastAnswer)
        assertEquals(stored, data.withLastAnswer(seen.copy(stationId = null), sightingAt = null).lastAnswer)
        assertEquals(seen, data.copy(lastAnswer = null).withLastAnswer(seen, null).lastAnswer)
    }

    @Test fun aRecordWrittenAfterItsTrainLeftDoesNotEnter() {
        val left = journey(now - 5 * minute, 27)
        val written = LastAnswer(trip.id, false, now - 5 * minute + 1, rhodes.id, BoardData(rhodes, townHall, listOf(left), now), left)
        val onTheWay = Fix(-33.85, 151.13, now, accuracyMetres = 10.0)
        assertNull(inferredFocus(UserData(trips = listOf(trip), lastAnswer = written), onTheWay, now))
        assertNull("nor does the open's snapshot", inferFromRecords(UserData(trips = listOf(trip)), written, now, onTheWay))
        val asItLeaves = written.copy(at = now - 5 * minute)
        assertEquals(left.key, inferredFocus(UserData(trips = listOf(trip), lastAnswer = asItLeaves), onTheWay, now)?.journey?.key)
    }

    private fun riding(pinned: Boolean): FocusedJourney {
        val followed = journey(now - 10 * minute, 27)
        return FocusedJourney(trip.id, false, followed, BoardData(rhodes, townHall, listOf(followed), now - minute), pinned = pinned,
            arrivalGuard = ArrivalGuard(armed = true, retainedAt = now - 8 * minute))
    }

    @Test fun stoppingAGuessedTripDeclinesItAndRecordsNoRide() {
        val guessed = riding(pinned = false)
        val earlier = Ride("other", false, now - 120 * minute, now - 90 * minute)
        val stopped = UserData(trips = listOf(trip), rides = listOf(earlier), focus = guessed).withTripStopped(now)
        assertNull(stopped.focus)
        assertEquals(listOf(earlier), stopped.rides)
        assertEquals(InferenceDecline(trip.id, false, now, guessed.journey.departureKey, guessed.composed.effectiveArrival),
            stopped.inferenceDeclined)
    }

    @Test fun stoppingAStartedTripDeclinesTheSavedTripOnItsPairAndRecordsNoRide() {
        val started = riding(pinned = true)
        val earlier = Ride("other", false, now - 120 * minute, now - 90 * minute)
        val stopped = UserData(trips = listOf(trip), rides = listOf(earlier), focus = started).withTripStopped(now)
        assertNull(stopped.focus)
        assertEquals(listOf(earlier), stopped.rides)
        assertEquals(InferenceDecline(trip.id, false, now, started.journey.departureKey, started.composed.effectiveArrival),
            stopped.inferenceDeclined)

        val back = started.copy(tripId = "elsewhere", board = started.board.copy(from = townHall, to = rhodes))
        assertEquals("the pair's reverse declines the saved trip in reverse", InferenceDecline(trip.id, true, now,
            back.journey.departureKey, back.composed.effectiveArrival), UserData(trips = listOf(trip), focus = back).withTripStopped(now).inferenceDeclined)
    }

    @Test fun stoppingAStartedTripOnAnUnsavedPairKeepsTheOlderDecline() {
        val strathfield = Station("213510", "Strathfield Station", -33.871778, 151.094325, setOf("train"))
        val started = riding(pinned = true).let { it.copy(board = it.board.copy(to = strathfield)) }
        val older = InferenceDecline("other", false, now - 30 * minute, "T9:${now - 60 * minute}", now - 38 * minute)
        val stopped = UserData(trips = listOf(trip), focus = started, inferenceDeclined = older).withTripStopped(now)
        assertNull(stopped.focus)
        assertEquals(older, stopped.inferenceDeclined)
    }

    @Test fun expiryClearsOnlyARecordNamingTheExpiredTripDirectionAndJourney() {
        val expired = riding(pinned = false)
        val named = LastAnswer(trip.id, false, now - 12 * minute, rhodes.id, expired.board, expired.journey)
        assertNull(UserData(trips = listOf(trip), focus = expired, lastAnswer = named).withFocusExpired(expired).lastAnswer)
        val next = journey(now + 8 * minute, 27)
        for (other in listOf(named.copy(journey = next), named.copy(reverse = true), named.copy(tripId = "other"))) {
            val kept = UserData(trips = listOf(trip), focus = expired, lastAnswer = other).withFocusExpired(expired)
            assertNull(kept.focus)
            assertEquals(other, kept.lastAnswer)
        }
    }

    @Test fun startingTheGuessedJourneyKeepsItsGuardAndAnyOtherStartReplacesIt() {
        val guessed = riding(pinned = false)
        val data = UserData(trips = listOf(trip), focus = guessed)
        val tapped = FocusedJourney(trip.id, false, guessed.journey, BoardData(rhodes, townHall, listOf(guessed.journey), now))
        assertEquals(guessed.copy(pinned = true), data.withTripStarted(tapped).focus)

        val next = journey(now + 5 * minute, 27)
        val later = FocusedJourney(trip.id, false, next, BoardData(rhodes, townHall, listOf(next), now))
        assertEquals(later, data.withTripStarted(later).focus)
        val back = tapped.copy(reverse = true)
        assertEquals(back, data.withTripStarted(back).focus)
    }

    @Test fun aTickTakesAFixAroundAShownDepartureAHeldDepartedRecordOrAMovingPhone() {
        val data = UserData(trips = listOf(trip))
        assertTrue(tickNeedsFix(data, now, listOf(now - 5 * minute), null, null))
        assertFalse(tickNeedsFix(data, now, listOf(now - 5 * minute - 1, now + minute), null, null))

        val held = journey(now - minute, 27)
        val sighted = LastAnswer(trip.id, false, now - 3 * minute, rhodes.id, BoardData(rhodes, townHall, listOf(held), now), held)
        assertTrue(tickNeedsFix(data.copy(lastAnswer = sighted), now, emptyList(), null, null))
        assertFalse("not departed yet", tickNeedsFix(data.copy(lastAnswer = sighted), now - 2 * minute, emptyList(), null, null))
        assertFalse("unsighted", tickNeedsFix(data.copy(lastAnswer = sighted.copy(stationId = null)), now, emptyList(), null, null))

        val moving = Fix(-33.85, 151.13, now - 2 * minute, speed = 12.0)
        assertTrue(tickNeedsFix(data, now, emptyList(), moving, null))
        assertFalse(tickNeedsFix(data, now + 1, emptyList(), moving, null))
        assertFalse(tickNeedsFix(data, now, emptyList(), moving.copy(speed = 1.0), null))
    }
}
