package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test

class TripDeletionTest {
    private val now = 1_788_765_000_000L
    private val central = Station("200060", "Central Station")
    private val parramatta = Station("215020", "Parramatta Station")
    private val rhodes = Station("213820", "Rhodes Station")
    private val bondi = Station("201040", "Bondi Junction Station")
    private val work = SavedTrip("work", central, parramatta)
    private val beach = SavedTrip("beach", rhodes, bondi)
    private val shops = SavedTrip("shops", central, bondi)
    private val journey = Journey(listOf(Leg("T1", "train", "Parramatta", central, parramatta, now + 60_000, now + 25 * 60_000)))
    private val board = BoardData(central, parramatta, listOf(journey), now, source = "live")
    private val data = UserData(
        trips = listOf(work, beach, shops),
        history = listOf(ViewEvent("work", false, now - 3), ViewEvent("beach", true, now - 2), ViewEvent("work", true, now - 1)),
        focus = FocusedJourney("work", false, journey, board),
        lastAnswer = LastAnswer("work", false, now, null, board, journey),
        lastTripId = "work", lastReverse = true,
    )

    @Test fun deletionRemovesTripHistoryFocusLastAnswerAndLastTripId() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("work"))
        assertEquals(listOf("beach", "shops"), remaining.trips.map { it.id })
        assertEquals(listOf(ViewEvent("beach", true, now - 2)), remaining.history)
        assertNull(remaining.focus); assertNull(remaining.lastAnswer); assertNull(remaining.lastTripId)
        assertEquals(work, pending.trip); assertEquals(0, pending.index)
        assertEquals(listOf(ViewEvent("work", false, now - 3), ViewEvent("work", true, now - 1)), pending.history)
        assertEquals(data.focus, pending.focus); assertEquals(data.lastAnswer, pending.lastAnswer); assertEquals("work", pending.lastTripId)
    }

    @Test fun deletingAnotherTripLeavesEvidenceOfTheOthersAlone() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("beach"))
        assertEquals(listOf("work", "shops"), remaining.trips.map { it.id })
        assertEquals(data.focus, remaining.focus); assertEquals(data.lastAnswer, remaining.lastAnswer); assertEquals("work", remaining.lastTripId)
        assertNull(pending.focus); assertNull(pending.lastAnswer); assertNull(pending.lastTripId)
        assertNull(data.beginDeletion("missing"))
    }

    @Test fun restorePutsEverythingBackAtTheOriginalIndexInOrder() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("beach"))
        val restored = remaining.restore(pending)
        assertEquals(listOf("work", "beach", "shops"), restored.trips.map { it.id })
        assertEquals(listOf(ViewEvent("work", false, now - 3), ViewEvent("work", true, now - 1), ViewEvent("beach", true, now - 2)), restored.history)
        val (rest, first) = requireNotNull(data.beginDeletion("work"))
        val back = rest.restore(first)
        assertEquals(data.trips, back.trips)
        assertEquals(data.focus, back.focus); assertEquals(data.lastAnswer, back.lastAnswer); assertEquals("work", back.lastTripId)
        assertEquals(data.history.sortedBy { it.at }, back.history.sortedBy { it.at })
    }

    @Test fun restoreDoesNotOverwriteEvidenceSetInBetween() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("work"))
        val beachJourney = Journey(listOf(Leg("T4", "train", "Bondi Junction", rhodes, bondi, now + 60_000, now + 40 * 60_000)))
        val newer = remaining.copy(focus = FocusedJourney("beach", false, beachJourney, BoardData(rhodes, bondi, listOf(beachJourney), now)), lastTripId = "beach")
        val restored = newer.restore(pending)
        assertEquals("beach", restored.focus?.tripId)
        assertEquals("beach", restored.lastTripId)
        assertEquals(data.lastAnswer, restored.lastAnswer)
    }

    @Test fun restoreAfterTheListShrankClampsTheIndex() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("shops"))
        val shrunk = remaining.copy(trips = emptyList())
        assertEquals(listOf("shops"), shrunk.restore(pending).trips.map { it.id })
    }

    @Test fun restoreIsANoOpWhenTheSamePairWasSavedAgain() {
        val (remaining, pending) = requireNotNull(data.beginDeletion("work"))
        val resaved = remaining.copy(trips = remaining.trips + SavedTrip("work-2", parramatta, central))
        assertEquals(resaved, resaved.restore(pending))
    }

    @Test fun deletionMessageUsesShortStationNames() {
        assertEquals("Central → Parramatta deleted", deletionMessage(work))
    }
}
