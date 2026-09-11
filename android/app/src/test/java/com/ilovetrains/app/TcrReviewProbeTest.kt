package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Adversarial probes for transfer completion and recovery
 * (docs/backlog/transfer-completion-recovery). Each test names the invariant it
 * attacks; a failing probe is a finding, not a broken test. Times are the shared
 * fixture's (tools/fixtures/conformance/transfer-recovery.json).
 */
class TcrReviewProbeTest {
    private val rhodes = Station("213820", "Rhodes Station")
    private val townHall = Station("200070", "Town Hall Station")
    private val central = Station("200060", "Central Station")
    private val bondi = Station("202210", "Bondi Junction Station")

    private val t9 = Leg("T9", "train", "Gordon via Lindfield", rhodes, townHall, T("09:24"), T("09:51"),
        estimatedArrival = T("10:00"), fromPlatform = "1", toPlatform = "3")
    private val t4 = Leg("T4", "train", "Bondi Junction", townHall, bondi, T("09:58"), T("10:08"),
        fromPlatform = "5", toPlatform = "1")
    private val followed = Journey(listOf(t9, t4))

    private fun t4At(departure: Long, arrival: Long, estimatedDeparture: Long? = null, from: Station = townHall) =
        Leg("T4", "train", "Bondi Junction", from, bondi, departure, arrival,
            estimatedDeparture = estimatedDeparture, fromPlatform = "5", toPlatform = "1")

    private val heldTenPastEight = Recovery(0, Journey(listOf(t4At(T("10:08"), T("10:18")))), NOW, RecoverySource(NOW))

    private fun focusOf(recovery: Recovery?, journey: Journey = followed) = FocusedJourney(
        "rhodes-bondijunction", false, journey,
        BoardData(rhodes, bondi, listOf(journey), NOW, source = "live"), pinned = false, recovery = recovery,
    )

    /** The two lines of TrainViewModel.settleRecovery that choose the record from a board. */
    private fun settle(focus: FocusedJourney, boards: (RecoverySearch) -> List<Journey>): Recovery? {
        val plan = recoveryPlan(focus.journey, focus.recovery, bondi)
        val search = plan.search ?: return plan.recovery
        val candidate = recoveryCandidate(boards(search), search.at, AllModes)
        return recoveryAfterSearch(plan, candidate, NOW, RecoverySource(NOW))
    }

    private fun outline(journey: Journey) = journey.legs.map { it.line to it.departure }

    // Invariant 2 / 8: the record is re-matched, never re-picked.

    @Test fun aHeldCandidateIsKeptWhenAnEarlierTrainBecomesEligible() {
        val earlier = Journey(listOf(t4At(T("10:04"), T("10:15"), estimatedDeparture = T("10:05"))))
        val record = settle(focusOf(heldTenPastEight)) { listOf(earlier, heldTenPastEight.journey) }
        assertEquals("the rider was told the 10:08 and is now re-told the 10:04",
            outline(heldTenPastEight.journey), outline(requireNotNull(record).journey))
    }

    @Test fun aHeldCandidateWhoseWindowShrinksToTightIsKeptNotSwapped() {
        val tightened = Journey(listOf(t4At(T("10:08"), T("10:18"), estimatedDeparture = T("10:02"))))
        val later = Journey(listOf(t4At(T("10:15"), T("10:25"))))
        val record = requireNotNull(settle(focusOf(heldTenPastEight)) { listOf(tightened, later) })
        assertEquals("the tight 10:08 was swapped for a later train", outline(tightened), outline(record.journey))
        val composed = composedJourney(followed, record)
        assertEquals(ConnectionState.Tight, connectionStates(composed, record.changeIndex)[0])
    }

    @Test fun aMovedAnchorRecordIsStableAcrossTheRefreshesThatFollowIt() {
        val viaCentral = Journey(listOf(
            Leg("T1", "train", "Central", townHall, central, T("10:05"), T("10:08"),
                estimatedArrival = T("10:14"), fromPlatform = "5", toPlatform = "18"),
            t4At(T("10:11"), T("10:24"), from = central).copy(fromPlatform = "20"),
        ))
        val fromCentral = Journey(listOf(t4At(T("10:19"), T("10:32"), from = central).copy(fromPlatform = "20")))
        val boards: (RecoverySearch) -> List<Journey> = { search ->
            when (search.from.id) {
                townHall.id -> listOf(viaCentral)
                central.id -> listOf(fromCentral)
                else -> emptyList()
            }
        }
        var focus = focusOf(Recovery(0, viaCentral, NOW, RecoverySource(NOW)))
        val first = requireNotNull(settle(focus, boards))
        assertEquals(listOf("T9" to T("09:24"), "T1" to T("10:05"), "T4" to T("10:19")),
            outline(composedJourney(followed, first)))

        focus = focus.copy(recovery = first)
        for (refresh in 2..4) {
            val record = requireNotNull(settle(focus, boards))
            assertEquals("refresh $refresh re-told the rider a different train",
                outline(composedJourney(followed, first)), outline(composedJourney(followed, record)))
            focus = focus.copy(recovery = record)
        }
    }

    // Invariant 8 (ruling): the candidate's own change is lost and nothing is found from the later change.

    @Test fun theCandidatesOwnChangeLostWithNothingFromTheLaterChangeReadsAsLost() {
        val viaCentral = Journey(listOf(
            Leg("T1", "train", "Central", townHall, central, T("10:05"), T("10:08"),
                estimatedArrival = T("10:14"), fromPlatform = "5", toPlatform = "18"),
            t4At(T("10:11"), T("10:24"), from = central).copy(fromPlatform = "20"),
        ))
        val held = Recovery(0, viaCentral, NOW, RecoverySource(NOW))
        val record = settle(focusOf(held)) { emptyList() }
        val header = focusHeader(focusOf(record), NOW)
        assertEquals("Check the station boards.", header.receipt)
        assertEquals("The T1 arrives too late for the 10:11", header.instruction)
        assertNotNull("the arrival the rider cannot make is shown as achievable", header.arrival.planned)
    }

    // Invariant 6: a recovery change is judged by its window alone.

    @Test fun aRecoveryChangeWhoseEstimateLandsEarlierThanItsTimetableIsNotShrunk() {
        val early = Journey(listOf(t4At(T("10:08"), T("10:18"), estimatedDeparture = T("10:06"))))
        val record = requireNotNull(settle(focusOf(null)) { listOf(early) })
        val focus = focusOf(record)
        assertEquals(ConnectionState.Ordinary, connectionStates(focus.composed, record.changeIndex)[0])
        val header = focusHeader(focus, NOW)
        assertEquals("Get off at Town Hall · Platform 3", header.instruction)
        assertFalse(header.receipt, header.receipt.contains("Printed change"))
    }

    // Invariant 3: the ride recorded is the followed journey's.

    @Test fun theRideRecordedAtTheEndOfARecoveredJourneyIsTheFollowedJourneys() {
        val rides = emptyList<Ride>().settled(focusOf(heldTenPastEight), arrived = true, ends = rhodes to bondi)
        assertEquals(followed.effectiveArrival, rides.single().arrival)
        assertEquals(followed.departure, rides.single().departure)
    }

    // Invariant 2: malformed records.

    @Test fun aChangeIndexPastTheLastChangeIsIgnored() {
        val stray = heldTenPastEight.copy(changeIndex = 3)
        assertEquals(followed, focusOf(stray).composed)
        assertNull(recoveryPlan(followed, stray, bondi).recovery)
    }

    @Test fun aRecordWhoseFirstLegDoesNotBoardAtTheChangeStationIsNotComposed() {
        val stray = Recovery(0, Journey(listOf(t4At(T("10:08"), T("10:18"), from = central))), NOW, RecoverySource(NOW))
        val composed = focusOf(stray).composed
        assertEquals("the composed journey changes at Town Hall but boards at Central",
            composed.legs[0].to.id, composed.legs[1].from.id)
    }

    // Invariant 5: the tight-change cue waits until the rider is riding toward the change.

    @Test fun aChangeBecomingTightBeforeDepartureDoesNotCue() {
        val waiting = Journey(listOf(
            Leg("T9", "train", "Gordon", rhodes, townHall, NOW + 5 * MIN, NOW + 20 * MIN, fromPlatform = "1", toPlatform = "3"),
            Leg("T4", "train", "Bondi", townHall, bondi, NOW + 23 * MIN, NOW + 33 * MIN, fromPlatform = "5", toPlatform = "1"),
        ))
        val focus = focusOf(null, waiting)
        val projection = requireNotNull(TravelTrackerState.derive(focus, NOW, 1))
        assertEquals(TravelTrackerStage.Boarding, projection.stage)
        val previous = TravelTrackerObservation(0, listOf(ConnectionState.Ordinary))
        val cues = trackerCues(focus, projection, NOW, previous).map { it.kind }
        assertTrue("a tight change cued while the rider is still on the platform: $cues",
            TravelTrackerCueKind.TightChange !in cues)
    }

    private companion object {
        const val MIN = 60_000L
        fun T(clock: String): Long {
            val (hour, minute) = clock.split(":").map { it.toInt() }
            // 2026-09-15 00:00 Australia/Sydney (AEST, +10) in epoch millis.
            return 1_789_394_400_000L + (hour * 60L + minute) * MIN
        }
        val NOW = T("09:47")
    }
}
