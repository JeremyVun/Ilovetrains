package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TravelTrackerLifecycleTest {
    @Test fun inferredEntryPromptsOnceAndDenialNeverStartsAnInvisibleService() {
        val store = FakeStore()
        val runtime = FakeRuntime()
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        var prompts = 0
        lifecycle.attachActivity { prompts++ }
        lifecycle.activityResumed()

        val focus = focus("inferred", pinned = false)
        lifecycle.reconcile(focus, focus, NOW)
        lifecycle.reconcile(focus, focus, NOW + 1_000)

        assertEquals(1, prompts)
        assertTrue(store.value.notificationPrompted)
        assertTrue(runtime.starts.isEmpty())
        assertEquals(0, runtime.stops)

        val recreated = TravelTrackerLifecycle(store, runtime)
        recreated.attachActivity { prompts++ }
        recreated.activityResumed()
        recreated.reconcile(focus, focus, NOW + 2_000)
        assertEquals(1, prompts)
        assertTrue(runtime.starts.isEmpty())
    }

    @Test fun pinDoesNotEnterButAnActiveTrackerFollowsAPinnedReplacement() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()

        val pin = focus("pin", pinned = true)
        assertNull(lifecycle.reconcile(pin, pin, NOW))
        assertTrue(runtime.starts.isEmpty())

        val inferred = focus("first", pinned = false)
        val first = requireNotNull(lifecycle.reconcile(inferred, inferred, NOW))
        assertEquals(listOf(first.revision), runtime.starts)

        val replacement = focus("replacement", pinned = true)
        val second = requireNotNull(lifecycle.reconcile(replacement, replacement, NOW))
        assertTrue(second.revision.generation > first.revision.generation)
        assertEquals(replacement.trackerIdentity, second.revision.identity)
        assertTrue(lifecycle.accepts(second.revision))
        assertFalse(lifecycle.accepts(first.revision))
    }

    @Test fun dismissalSuppressesOnlyTheExactFocusAndRejectsOldTapOrDeleteIntents() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val firstFocus = focus("first", pinned = false)
        val first = requireNotNull(lifecycle.reconcile(firstFocus, firstFocus, NOW))

        assertTrue(lifecycle.dismiss(first.revision))
        assertFalse(lifecycle.accepts(first.revision))
        assertNull(lifecycle.reconcile(firstFocus, firstFocus, NOW + 1_000))

        val replacement = focus("next", pinned = false)
        val next = requireNotNull(lifecycle.reconcile(replacement, replacement, NOW + 1_000))
        assertTrue(lifecycle.accepts(next.revision))
        assertFalse(lifecycle.dismiss(first.revision))
        assertEquals(2, runtime.starts.size)
    }

    @Test fun temporaryModeHidingStopsTheSurfaceButPreservesTheSession() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val focus = focus("focus", pinned = false)
        val shown = requireNotNull(lifecycle.reconcile(focus, focus, NOW))

        assertNull(lifecycle.reconcile(focus, null, NOW + 1_000))
        assertEquals(shown.revision, lifecycle.activeRevision())
        assertEquals(1, runtime.stops)

        val restored = requireNotNull(lifecycle.reconcile(focus, focus, NOW + 2_000))
        assertEquals(shown.revision, restored.revision)
        assertEquals(2, runtime.starts.size)
    }

    @Test fun projectionCompletionEndsWithoutChangingTheFocusedJourney() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val focus = focus("focus", pinned = false)
        requireNotNull(lifecycle.reconcile(focus, focus, NOW))

        assertNull(lifecycle.reconcile(focus, focus, ARRIVAL))
        assertNull(lifecycle.activeRevision())
        assertEquals(focus.trackerIdentity, store.value.suppressedIdentity)
        assertEquals(TravelTrackerSuppression.Completed, store.value.suppression)
        assertEquals(1, runtime.stops)
    }

    @Test fun recordedCompletionEndsBeforeTheTimetableAndAWithdrawnCompletionCanResume() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val focus = focus("focus", pinned = false)
        val active = requireNotNull(lifecycle.reconcile(focus, focus, NOW))

        assertNull(lifecycle.reconcile(focus, focus, NOW + 60_000, recordedComplete = true))
        assertFalse(lifecycle.accepts(active.revision))

        val resumed = requireNotNull(lifecycle.reconcile(focus, focus, NOW + 120_000, recordedComplete = false))
        assertTrue(resumed.revision.generation > active.revision.generation)
        assertEquals(2, runtime.starts.size)
    }

    @Test fun aRejectedServiceStartDoesNotBreakFocusAndCanRetryInTheForeground() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true, startSucceeds = false)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val focus = focus("focus", pinned = false)

        val presentation = requireNotNull(lifecycle.reconcile(focus, focus, NOW))
        assertTrue(lifecycle.accepts(presentation.revision))
        assertEquals(1, runtime.starts.size)

        runtime.startSucceeds = true
        lifecycle.reconcile(focus, focus, NOW + 1_000)
        assertEquals(2, runtime.starts.size)
    }

    private class FakeStore : TravelTrackerSessionStore {
        var value = TravelTrackerSession()
        override fun load() = value
        override fun save(session: TravelTrackerSession) { value = session }
    }

    private class FakeRuntime(var allowed: Boolean = false, var startSucceeds: Boolean = true) : TravelTrackerRuntime {
        val starts = mutableListOf<TravelTrackerRevision>()
        var stops = 0
        var haptics = 0
        override fun notificationsAllowed() = allowed
        override fun startService(revision: TravelTrackerRevision): Boolean { starts += revision; return startSucceeds }
        override fun stopService() { stops++ }
        override fun haptic() { haptics++ }
    }

    private fun connecting(name: String, missed: Boolean = false, cancelledLeg: Int? = null): FocusedJourney {
        val from = Station("from-$name", "From Station")
        val change = Station("change-$name", "Change Station")
        val to = Station("to-$name", "To Station")
        val first = Leg("T1", "train", "To", from, change, NOW - 60_000, CHANGE_ARRIVAL)
        val second = Leg("M1", "metro", "To", change, to,
            if (missed) NOW + 60_000 else ONWARD_DEPARTURE, ONWARD_ARRIVAL)
        val legs = listOf(first, second).mapIndexed { index, leg ->
            if (index == cancelledLeg) leg.copy(cancelled = true) else leg
        }
        val journey = Journey(legs)
        return FocusedJourney("trip-$name", false, journey, BoardData(from, to, listOf(journey), NOW, source = "live"), pinned = false)
    }

    private fun focus(name: String, pinned: Boolean, arrivalDelay: Long = 0): FocusedJourney =
        single(name, NOW - 60_000, ARRIVAL, arrivalDelay, pinned)

    private fun single(name: String, departure: Long, arrival: Long,
                       arrivalDelay: Long = 0, pinned: Boolean = false): FocusedJourney {
        val from = Station("from-$name", "From Station")
        val to = Station("to-$name", "To Station")
        val journey = Journey(listOf(Leg("T1", "train", "To", from, to, departure, arrival,
            estimatedArrival = if (arrivalDelay == 0L) null else arrival + arrivalDelay)))
        val board = BoardData(from, to, listOf(journey), NOW, source = "live")
        return FocusedJourney("trip-$name", false, journey, board, pinned)
    }

    @Test fun theLastLegCuesBeforeItsArrivalAndNeverAtDeparture() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = single("last-leg", NOW + 60_000, ARRIVAL)

        assertEquals(TravelTrackerStage.Boarding, requireNotNull(lifecycle.reconcile(trip, trip, NOW)).stage)
        lifecycle.reconcile(trip, trip, NOW + 30_000)
        assertEquals(TravelTrackerStage.Final,
            requireNotNull(lifecycle.reconcile(trip, trip, NOW + 60_000)).stage)
        assertEquals(0, runtime.haptics)

        lifecycle.observeUntil(trip, NOW + 60_000, ARRIVAL - LEAD - 1_000)
        assertEquals(0, runtime.haptics)
        lifecycle.observeUntil(trip, ARRIVAL - LEAD - 1_000, ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)
        lifecycle.observeUntil(trip, ARRIVAL - LEAD, ARRIVAL - 30_000)
        assertEquals(1, runtime.haptics)
        assertFalse(lifecycle.consumeCue())
    }

    @Test fun aLegShorterThanTheLeadCuesTheMomentItIsRidden() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = single("short", NOW + 60_000, NOW + 150_000)

        assertEquals(TravelTrackerStage.Boarding, requireNotNull(lifecycle.reconcile(trip, trip, NOW)).stage)
        lifecycle.reconcile(trip, trip, NOW + 30_000)
        assertEquals(0, runtime.haptics)

        assertEquals(TravelTrackerStage.Final,
            requireNotNull(lifecycle.reconcile(trip, trip, NOW + 60_000)).stage)
        assertEquals(1, runtime.haptics)
        lifecycle.observeUntil(trip, NOW + 60_000, NOW + 120_000)
        assertEquals(1, runtime.haptics)
    }

    @Test fun aChangeCuesBeforeItsArrivalWhileTransferAndFinalEntryStaySilent() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = connecting("change")

        assertEquals(TravelTrackerStage.Ride, requireNotNull(lifecycle.reconcile(trip, trip, NOW)).stage)
        lifecycle.observeUntil(trip, NOW, CHANGE_ARRIVAL - LEAD - 1_000)
        assertEquals(0, runtime.haptics)

        lifecycle.observeUntil(trip, CHANGE_ARRIVAL - LEAD - 1_000, CHANGE_ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)

        assertEquals(TravelTrackerStage.Transfer,
            requireNotNull(lifecycle.observeUntil(trip, CHANGE_ARRIVAL - LEAD, CHANGE_ARRIVAL + 20_000)).stage)
        assertEquals(TravelTrackerStage.Final,
            requireNotNull(lifecycle.observeUntil(trip, CHANGE_ARRIVAL + 20_000, ONWARD_DEPARTURE + 20_000)).stage)
        assertEquals(1, runtime.haptics)

        lifecycle.observeUntil(trip, ONWARD_DEPARTURE + 20_000, ONWARD_ARRIVAL - LEAD)
        assertEquals(2, runtime.haptics)
        lifecycle.observeUntil(trip, ONWARD_ARRIVAL - LEAD, ONWARD_ARRIVAL - 30_000)
        assertEquals(2, runtime.haptics)
    }

    @Test fun aFirstObservationInsideTheLeadRecordsTheBaselineAndTheNextGenerationCuesAgain() {
        val store = FakeStore()
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(store, runtime)
        lifecycle.activityResumed()
        val trip = focus("restore", pinned = false)

        lifecycle.reconcile(trip, trip, ARRIVAL - 60_000)
        lifecycle.observeUntil(trip, ARRIVAL - 60_000, ARRIVAL - 30_000)
        assertEquals(0, runtime.haptics)

        val restored = TravelTrackerLifecycle(store, runtime)
        restored.activityResumed()
        restored.reconcile(trip, trip, ARRIVAL - 20_000)
        assertEquals(0, runtime.haptics)

        val replacement = focus("restore-next", pinned = false)
        restored.reconcile(replacement, replacement, NOW)
        restored.observeUntil(replacement, NOW, ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)
    }

    @Test fun anObservationAfterASilentGapRecordsTheBaselineAndANewGenerationStillCues() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = connecting("gap")

        lifecycle.reconcile(trip, trip, NOW)
        lifecycle.observeUntil(trip, NOW, NOW + 120_000)
        assertEquals(0, runtime.haptics)

        lifecycle.reconcile(trip, trip, CHANGE_ARRIVAL - 30_000)
        lifecycle.reconcile(trip, trip, CHANGE_ARRIVAL - 20_000)
        assertEquals(0, runtime.haptics)
        assertFalse(lifecycle.consumeCue())

        val replacement = connecting("gap-next")
        replacement.let {
            lifecycle.reconcile(it, it, NOW)
            lifecycle.observeUntil(it, NOW, CHANGE_ARRIVAL - LEAD)
        }
        assertEquals(1, runtime.haptics)
    }

    @Test fun anEstimateMovingTheArrivalLaterDoesNotCueTheLegAgain() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = focus("delayed", pinned = false)

        lifecycle.reconcile(trip, trip, NOW)
        lifecycle.observeUntil(trip, NOW, ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)

        val slightly = focus("delayed", pinned = false, arrivalDelay = 4 * 60_000)
        lifecycle.observeUntil(slightly, ARRIVAL - LEAD, ARRIVAL - 30_000)
        assertEquals(1, runtime.haptics)

        val later = focus("delayed", pinned = false, arrivalDelay = 5 * 60_000)
        lifecycle.observeUntil(later, ARRIVAL - 30_000, ARRIVAL + 4 * 60_000)
        assertEquals("a five-minute arrival delay cues once", 2, runtime.haptics)

        val worse = focus("delayed", pinned = false, arrivalDelay = 9 * 60_000)
        lifecycle.observeUntil(worse, ARRIVAL + 4 * 60_000, ARRIVAL + 8 * 60_000)
        assertEquals(2, runtime.haptics)
    }

    @Test fun aRecoveredThenLostAgainArrivalCuesTheDelayTwice() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val onTime = single("rearm", NOW - 60_000, ARRIVAL + 20 * 60_000)
        val late = single("rearm", NOW - 60_000, ARRIVAL + 20 * 60_000, arrivalDelay = 6 * 60_000)

        lifecycle.reconcile(onTime, onTime, NOW)
        lifecycle.observeUntil(late, NOW, NOW + 60_000)
        assertEquals(1, runtime.haptics)
        lifecycle.observeUntil(onTime, NOW + 60_000, NOW + 120_000)
        assertEquals(1, runtime.haptics)
        lifecycle.observeUntil(late, NOW + 120_000, NOW + 180_000)
        assertEquals("a delay that recovers and returns cues again", 2, runtime.haptics)
    }

    @Test fun aChangeBecomingTightCuesOnceWhileRidingTowardIt() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val base = connecting("tightening")
        val roomyLegs = listOf(
            base.journey.legs[0].copy(arrival = NOW + 300_000),
            base.journey.legs[1].copy(departure = NOW + 600_000),
        )
        val roomy = base.copy(journey = Journey(roomyLegs))
        val tightened = base.copy(journey = Journey(listOf(
            roomyLegs[0].copy(estimatedArrival = NOW + 420_000), roomyLegs[1])))

        lifecycle.reconcile(roomy, roomy, NOW)
        lifecycle.observeUntil(roomy, NOW, NOW + 60_000)
        assertEquals(0, runtime.haptics)
        lifecycle.reconcile(tightened, tightened, NOW + 90_000)
        assertEquals("the change becoming tight cues on the observation that sees it", 1, runtime.haptics)
        lifecycle.observeUntil(tightened, NOW + 90_000, NOW + 180_000)
        assertEquals(1, runtime.haptics)
    }

    @Test fun aBackgroundCueWaitsForTheNextNotificationPostAndIsConsumedOnce() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityStopped()
        val trip = connecting("background")

        lifecycle.reconcile(trip, trip, NOW)
        lifecycle.observeUntil(trip, NOW, CHANGE_ARRIVAL - LEAD - 1_000)
        assertFalse(lifecycle.consumeCue())

        lifecycle.observeUntil(trip, CHANGE_ARRIVAL - LEAD - 1_000, CHANGE_ARRIVAL - LEAD + 30_000)
        assertEquals(0, runtime.haptics)
        assertTrue(lifecycle.consumeCue())
        assertFalse(lifecycle.consumeCue())
    }

    @Test fun aMissedConnectionAndACancellationEachCueOnce() {
        val runtime = FakeRuntime(allowed = true)
        val missedLifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        missedLifecycle.activityResumed()
        val missed = connecting("missed", missed = true)

        missedLifecycle.reconcile(missed, missed, NOW)
        assertEquals(TravelTrackerStage.Ride,
            requireNotNull(missedLifecycle.observeUntil(missed, NOW, CHANGE_ARRIVAL - 30_000)).stage)
        assertEquals(0, runtime.haptics)

        assertEquals(TravelTrackerStage.MissedTransfer,
            requireNotNull(missedLifecycle.observeUntil(missed, CHANGE_ARRIVAL - 30_000, CHANGE_ARRIVAL + 20_000)).stage)
        assertEquals(1, runtime.haptics)
        missedLifecycle.observeUntil(missed, CHANGE_ARRIVAL + 20_000, CHANGE_ARRIVAL + 80_000)
        assertEquals(1, runtime.haptics)

        val cancelledRuntime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), cancelledRuntime)
        lifecycle.activityResumed()
        val trip = connecting("cancelled")
        lifecycle.reconcile(trip, trip, NOW)
        val cancelled = connecting("cancelled", cancelledLeg = 1)
        assertEquals(TravelTrackerEventKind.Cancellation,
            requireNotNull(lifecycle.reconcile(cancelled, cancelled, NOW + 1_000)).event.kind)
        lifecycle.reconcile(cancelled, cancelled, NOW + 2_000)
        assertEquals(1, cancelledRuntime.haptics)
    }

    @Test fun aDeniedNotificationStillHapticsOnScreenWithoutLeavingABackgroundCue() {
        val runtime = FakeRuntime(allowed = false)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.attachActivity {}
        lifecycle.activityResumed()
        val trip = focus("denied", pinned = false)

        lifecycle.reconcile(trip, trip, NOW)
        lifecycle.observeUntil(trip, NOW, ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)
        assertTrue(runtime.starts.isEmpty())
        assertFalse(lifecycle.consumeCue())

        lifecycle.activityStopped()
        val background = focus("denied-background", pinned = false)
        lifecycle.reconcile(background, background, NOW)
        lifecycle.observeUntil(background, NOW, ARRIVAL - LEAD)
        assertEquals(1, runtime.haptics)
        assertFalse(lifecycle.consumeCue())
    }

    @Test fun theSettingOffSuppressesEveryCueAndTurningItOnDoesNotReplayOne() {
        val runtime = FakeRuntime(allowed = true)
        val lifecycle = TravelTrackerLifecycle(FakeStore(), runtime)
        lifecycle.activityResumed()
        val trip = connecting("off")

        lifecycle.reconcile(trip, trip, NOW, journeyAlerts = false)
        lifecycle.observeUntil(trip, NOW, ONWARD_ARRIVAL - LEAD, journeyAlerts = false)
        assertEquals(0, runtime.haptics)
        assertFalse(lifecycle.consumeCue())

        lifecycle.observeUntil(trip, ONWARD_ARRIVAL - LEAD, ONWARD_ARRIVAL - 30_000)
        assertEquals(0, runtime.haptics)
        assertFalse(lifecycle.consumeCue())
    }

    private fun TravelTrackerLifecycle.observeUntil(
        focus: FocusedJourney,
        from: Long,
        to: Long,
        journeyAlerts: Boolean = true,
    ): TravelTrackerState? {
        var at = from
        var state: TravelTrackerState? = null
        while (at < to) {
            at = minOf(to, at + TravelTrackerObservationGap)
            state = reconcile(focus, focus, at, journeyAlerts = journeyAlerts)
        }
        return state
    }

    private companion object {
        const val NOW = 1_000_000L
        const val ARRIVAL = NOW + 600_000L
        const val LEAD = 120_000L
        const val CHANGE_ARRIVAL = NOW + 600_000L
        const val ONWARD_DEPARTURE = NOW + 660_000L
        const val ONWARD_ARRIVAL = NOW + 1_800_000L
    }
}
