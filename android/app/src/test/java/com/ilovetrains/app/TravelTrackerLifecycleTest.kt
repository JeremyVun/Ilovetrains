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
        override fun notificationsAllowed() = allowed
        override fun startService(revision: TravelTrackerRevision): Boolean { starts += revision; return startSucceeds }
        override fun stopService() { stops++ }
    }

    private fun focus(name: String, pinned: Boolean): FocusedJourney {
        val from = Station("from-$name", "From Station")
        val to = Station("to-$name", "To Station")
        val journey = Journey(listOf(Leg("T1", "train", "To", from, to, NOW - 60_000, ARRIVAL)))
        val board = BoardData(from, to, listOf(journey), NOW, source = "live")
        return FocusedJourney("trip-$name", false, journey, board, pinned)
    }

    private companion object {
        const val NOW = 1_000_000L
        const val ARRIVAL = NOW + 600_000L
    }
}
