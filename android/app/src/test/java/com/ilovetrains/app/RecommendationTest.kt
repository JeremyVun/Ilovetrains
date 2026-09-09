package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecommendationTest {
    private val now = 1_800_000_000_000L
    private val a = Station("a", "A")
    private val b = Station("b", "B")
    private val c = Station("c", "C")

    @Test fun cachedWinnerOutsideBoardRowsParticipatesInReloadSelection() {
        val winner = journey("T9", now + 120_000, now + 500_000, now + 500_000)
        val row = journey("T1", now + 60_000, now + 900_000, now + 900_000)
        val source = BoardData(a, b, listOf(winner), now - 10_000, source = "live")
        val board = BoardData(a, b, listOf(row), now, source = "live",
            recommendation = RecommendationResult(winner, source))
        val selected = requireNotNull(selectRecommendation(board.recommendationCandidates(now), now))
        assertEquals(winner, selected.journey)
        assertEquals(source.generatedAt, selected.source.generatedAt)
    }

    @Test fun newerMatchingObservationWinsRegardlessOfPageOrder() {
        val old = journey("T1", now + 60_000, now + 600_000, now + 660_000)
        val newer = old.copy(legs = old.legs.map { it.copy(estimatedArrival = now + 720_000) })
        val first = BoardData(a, b, listOf(newer), now, source = "live", fetchConstraint = TransferConstraint(2))
        val oldPage = BoardData(a, b, listOf(old), now - 30_000, source = "live", fetchConstraint = TransferConstraint(2))
        val combined = first.copy(recommendationPages = listOf(
            RecommendationPage(now, oldPage, false, TransferConstraint(2))))

        assertEquals(newer, combined.recommendationCandidates(now).single().journey)
    }

    @Test fun freshnessIsJudgedPerSourceAndCapMismatchIsProvisional() {
        val freshJourney = journey("T1", now + 60_000, now + 600_000, now + 660_000)
        val staleJourney = journey("T2", now + 120_000, now + 500_000, now + 560_000)
        val stalePage = BoardData(a, b, listOf(staleJourney), now - 91_000, source = "live",
            fetchConstraint = TransferConstraint(2))
        val board = BoardData(a, b, listOf(freshJourney), now, source = "live",
            fetchConstraint = TransferConstraint(2), recommendationPages = listOf(
                RecommendationPage(now, stalePage, false, TransferConstraint(2))))
        val candidates = board.recommendationCandidates(now)

        assertFalse(candidates.first { it.journey.key == freshJourney.key }.stale)
        assertTrue(candidates.first { it.journey.key == staleJourney.key }.stale)
        assertTrue(board.recommendationCandidates(now, TransferConstraint(0)).all { it.stale })
    }

    @Test fun overlappingEffectiveLegsAreIneligible() {
        val first = Leg("T1", "train", "C", a, c, now + 60_000, now + 300_000)
        val second = Leg("T2", "train", "B", c, b, now + 360_000, now + 600_000,
            estimatedDeparture = now + 240_000)
        assertEquals(null, recommendationCost(Journey(listOf(first, second))))
    }

    private fun journey(line: String, departure: Long, arrival: Long, scheduledArrival: Long) =
        Journey(listOf(Leg(line, "train", "B", a, b, departure, scheduledArrival,
            estimatedArrival = arrival)))
}
