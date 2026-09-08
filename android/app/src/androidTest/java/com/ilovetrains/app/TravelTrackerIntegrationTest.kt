package com.ilovetrains.app

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class TravelTrackerIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as TrainApplication
    private val model get() = app.model
    private val notifications get() = context.getSystemService(NotificationManager::class.java)

    @After fun resetDebugOverrides() = onMain {
        model.debugSetTrackerClock(null)
        model.debugSetTrackerCaptureMode(false)
    }

    @Test fun productionLocationInferenceStartsTrackerAutomatically() {
        requireDriverStep("fresh-location-inference")
        grantNotifications()
        val focus = seedProductionInference("production-inference")
        launchActivity()
        onMain { model.debugSetTrackerCaptureMode(true) }
        assertNull(model.state.value.focus)
        onMain { model.location(Fix(-33.9000, 151.1900, System.currentTimeMillis(), speed = 10.0)) }
        val notification = waitForNotification()
        assertEquals(false, model.state.value.focus?.pinned)
        assertContains(notification, "Central", "P21", "P26", "Kellyville")
    }

    @Test fun productionInferenceRequestsNotificationPermissionOnce() {
        requireDriverStep("permission-prompt")
        require(Build.VERSION.SDK_INT >= 33) { "notification permission prompt requires API 33+" }
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        val focus = seedProductionInference("permission-prompt")
        shell("cmd statusbar collapse")
        launchActivity()
        onMain { model.debugSetTrackerCaptureMode(true) }
        onMain { model.location(Fix(-33.9000, 151.1900, System.currentTimeMillis(), speed = 10.0)) }
        val allow = waitForAccessibilityNode("notification permission prompt did not appear") { node ->
            node.viewIdResourceName?.endsWith(":id/permission_allow_button") == true ||
                node.text?.toString() == "Allow"
        }
        assertTrue("notification permission Allow action failed", allow.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        waitUntil("notification permission was not granted") {
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        }
        assertContains(waitForNotification(), "Central", "P21", "P26", "Kellyville")
        assertEquals(focus.trackerIdentity, model.state.value.focus?.trackerIdentity)
        assertTrue(context.getSharedPreferences("tracker-v1", Context.MODE_PRIVATE)
            .getBoolean("notificationPrompted", false))

        launchActivity()
        SystemClock.sleep(1_000)
        val repeated = instrumentation.uiAutomation.rootInActiveWindow?.let { root ->
            findDescendant(root) { node -> node.viewIdResourceName?.contains("permission_allow_button") == true }
        }
        assertNull("notification permission prompt repeated after relaunch", repeated)
        assertContains(requireNotNull(trackerNotification()), "Central", "Kellyville")
    }

    @Test fun productionInferenceDenialDoesNotPromptAgain() {
        requireDriverStep("permission-prompt-deny")
        require(Build.VERSION.SDK_INT >= 33) { "notification permission prompt requires API 33+" }
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        val focus = seedProductionInference("permission-prompt-deny")
        shell("cmd statusbar collapse")
        launchActivity()
        onMain { model.debugSetTrackerCaptureMode(true) }
        onMain { model.location(Fix(-33.9000, 151.1900, System.currentTimeMillis(), speed = 10.0)) }
        val deny = waitForAccessibilityNode("notification permission prompt did not appear") { node ->
            node.viewIdResourceName?.endsWith(":id/permission_deny_button") == true ||
                node.text?.toString() == "Don’t allow" || node.text?.toString() == "Don't allow"
        }
        assertTrue("notification permission denial action failed", deny.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        waitUntil("denied tracker started a notification") { trackerNotification() == null }
        assertServiceStopped()
        assertEquals(focus.trackerIdentity, model.state.value.focus?.trackerIdentity)
        assertTrue(context.getSharedPreferences("tracker-v1", Context.MODE_PRIVATE)
            .getBoolean("notificationPrompted", false))

        launchActivity()
        SystemClock.sleep(1_000)
        val repeated = instrumentation.uiAutomation.rootInActiveWindow?.let { root ->
            findDescendant(root) { node -> node.viewIdResourceName?.contains("permission_deny_button") == true }
        }
        assertNull("notification permission prompt repeated after denial", repeated)
        assertNull(trackerNotification())
        assertServiceStopped()
    }

    @Test fun lifecyclePinPolicyStartsInferredButNotPinAlone() {
        grantNotifications()
        launchActivity()
        clearFocus()

        val pinned = fixture("ride", "pin-only", pinned = true)
        setFocus(pinned)
        SystemClock.sleep(1_500)
        assertNull("a pin alone must not start tracking", trackerNotification())

        setFocus(pinned.copy(pinned = false))
        val notification = waitForNotification()
        assertContains(notification, "Central", "P21", "P26", "Kellyville")
    }

    @Test fun browsingDoesNotReplaceTrackerAndCurrentTapWins() {
        grantNotifications()
        launchActivity()
        clearFocus()

        val original = fixture("ride", "browse-original")
        setFocus(original)
        val originalNotification = waitForNotification()
        val originalRevision = requireNotNull(model.trackerActiveRevision())

        val browsed = replacementFocus("browse-only", "Rouse Hill Station")
        onMain { model.debugBrowseWithoutChangingTracker(savedTrip(browsed), browsed.board) }
        SystemClock.sleep(1_000)
        assertEquals(originalRevision, model.trackerActiveRevision())
        assertContains(requireNotNull(trackerNotification()), "Central", "Kellyville")

        val replacement = replacementFocus("replacement", "Rouse Hill Station")
        setFocus(replacement)
        val replacementNotification = waitForNotification { text(it).contains("Rouse Hill") }
        val replacementRevision = requireNotNull(model.trackerActiveRevision())
        assertTrue(originalRevision.identity != replacementRevision.identity)

        shell("input keyevent HOME")
        originalNotification.deleteIntent.send()
        SystemClock.sleep(1_500)
        assertEquals(replacementRevision, model.trackerActiveRevision())
        assertContains(requireNotNull(trackerNotification()) { "stale dismissal stopped replacement tracker" }, "Rouse Hill")

        context.startForegroundService(
            Intent(context, TravelTrackerService::class.java)
                .setAction(TravelTrackerService.ActionStart)
                .putTrackerRevision(originalRevision),
        )
        SystemClock.sleep(1_500)
        assertEquals(replacementRevision, model.trackerActiveRevision())
        assertContains(requireNotNull(trackerNotification()) { "stale start lost replacement tracker" }, "Rouse Hill")

        originalNotification.contentIntent.send()
        SystemClock.sleep(750)
        assertEquals(replacementRevision, model.trackerActiveRevision())
        assertTrue("stale tap restored the old trip", model.state.value.selectedTripId != original.tripId)
        assertEquals(replacement.tripId, model.state.value.focus?.tripId)

        replacementNotification.contentIntent.send()
        waitUntil("current notification did not open replacement detail") {
            model.state.value.screen == Screen.Detail &&
                model.state.value.selectedTripId == replacement.tripId &&
                model.state.value.focus?.trackerIdentity == replacement.trackerIdentity
        }
    }

    @Test fun dismissalSuppressesTheExactFocusAndAllowsReplacement() {
        grantNotifications()
        launchActivity()
        clearFocus()

        val dismissed = fixture("ride", "dismissed")
        setFocus(dismissed)
        waitForNotification().deleteIntent.send()
        waitUntil("dismissed notification remained active") { trackerNotification() == null }
        assertNull(model.trackerActiveRevision())

        setFocus(dismissed)
        SystemClock.sleep(1_500)
        assertNull("same focus was recreated after dismissal", trackerNotification())

        val replacement = replacementFocus("dismiss-replacement", "Rouse Hill Station")
        setFocus(replacement)
        assertContains(waitForNotification(), "Rouse Hill")
    }

    @Test fun systemUiSwipeDismissesAndSuppressesTheFocus() {
        grantNotifications()
        launchActivity()
        clearFocus()
        val focus = fixture("ride", "system-ui-dismiss")
        setFocus(focus)
        waitForNotification()
        shell("input keyevent HOME")
        shell("cmd statusbar expand-notifications")
        val row = waitForAccessibilityNode("tracker row did not reach notification shade") { node ->
            node.viewIdResourceName?.endsWith("expandableNotificationRow") == true &&
                accessibilityText(node).contains("ilovetrains")
        }
        val bounds = Rect().also(row::getBoundsInScreen)
        shell("input swipe ${bounds.left + bounds.width() / 4} ${bounds.centerY()} ${bounds.right - 1} ${bounds.centerY()} 300")
        waitUntil("System UI swipe did not dismiss tracker") { trackerNotification() == null }
        assertEquals(focus.trackerIdentity, model.state.value.focus?.trackerIdentity)
        waitUntil("System UI dismissal did not suppress the tracker") { model.trackerActiveRevision() == null }
        val persisted = context.getSharedPreferences("tracker-v1", Context.MODE_PRIVATE)
        assertEquals("Dismissed", persisted.getString("suppression", null))
        assertEquals(focus.tripId, persisted.getString("suppressedTripId", null))
        shell("cmd statusbar collapse")
    }

    @Test fun persistDismissedFocusForRelaunchCheck() {
        requireDriverStep("persist-dismiss")
        grantNotifications()
        launchActivity()
        clearFocus()
        val dismissed = fixture("ride", RelaunchTripId)
        setFocus(dismissed)
        waitForNotification().deleteIntent.send()
        waitUntil("dismissed notification remained active") { trackerNotification() == null }
        waitUntil("focus did not persist before relaunch") { model.state.value.focus?.tripId == RelaunchTripId }
        waitUntil("focus was not durable before relaunch") {
            runBlocking { DeviceStore(context).load().focus?.tripId == RelaunchTripId }
        }
        val persisted = context.getSharedPreferences("tracker-v1", Context.MODE_PRIVATE)
        assertEquals(RelaunchTripId, persisted.getString("suppressedTripId", null))
        assertEquals("Dismissed", persisted.getString("suppression", null))
        assertNull(persisted.getString("activeTripId", null))
    }

    @Test fun suppressionSurvivesRelaunch() {
        requireDriverStep("verify-dismiss")
        grantNotifications()
        waitReady()
        val focus = requireNotNull(model.state.value.focus) { "run persistDismissedFocusForRelaunchCheck first" }
        assertEquals(RelaunchTripId, focus.tripId)
        assertNull(model.trackerActiveRevision())
        onMain { model.debugSetTrackerFocus(focus) }
        onMain { model.activityResumed() }
        SystemClock.sleep(1_500)
        assertNull("same focus was recreated after process relaunch", trackerNotification())
    }

    @Test fun tapAfterTaskRemovalStartsMatchingDetail() {
        requireDriverStep("cold-tap")
        grantNotifications()
        val activity = launchActivity()
        val focus = requireNotNull(model.state.value.focus) { "seed a notification before this check" }
        val notification = waitForNotification()
        onMain { activity.finishAndRemoveTask() }
        waitUntil("tracker activity task remained after removal") {
            !shell("dumpsys activity activities ${context.packageName}").contains("com.ilovetrains.app/.MainActivity")
        }
        notification.contentIntent.send()
        waitUntil("notification did not cold-start matching detail") {
            model.state.value.screen == Screen.Detail &&
                model.state.value.focus?.trackerIdentity == focus.trackerIdentity &&
                model.state.value.selectedTripId == focus.tripId &&
                journeyServiceKey(model.state.value.detail) == journeyServiceKey(focus.journey)
        }
    }

    @Test fun deniedNotificationsKeepInAppFocusWithoutService() {
        requireDriverStep("permission-denied")
        require(Build.VERSION.SDK_INT >= 33) { "notification permission denial requires API 33+" }
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        clearFocus()
        onMain { model.activityResumed() }
        val focus = fixture("ride", "denied")
        setFocus(focus)
        SystemClock.sleep(1_500)
        assertEquals(focus.trackerIdentity, model.state.value.focus?.trackerIdentity)
        assertNull(trackerNotification())
        assertServiceStopped()
    }

    @Test fun blockedChannelKeepsInAppFocusWithoutService() {
        requireDriverStep("channel-blocked")
        grantNotifications()
        assertEquals(NotificationManager.IMPORTANCE_NONE,
            notifications.getNotificationChannel(TravelTrackerNotification.ChannelId)?.importance)
        clearFocus()
        onMain { model.activityResumed() }
        val focus = fixture("ride", "blocked-channel")
        setFocus(focus)
        SystemClock.sleep(1_500)
        assertEquals(focus.trackerIdentity, model.state.value.focus?.trackerIdentity)
        assertNull(trackerNotification())
        assertServiceStopped()
    }

    @Test fun backgroundServiceAdvancesStagesAndCompletes() {
        grantNotifications()
        launchActivity()
        clearFocus()
        val now = System.currentTimeMillis()
        val focus = shortJourney("background", now)
        setFocus(focus)
        assertContains(waitForNotification { text(it).contains("Central") }, "Central", "P21", "P26")
        shell("input keyevent HOME")
        assertContains(waitForNotification(8_000) { text(it).contains("M1 leaves") }, "M1 leaves", "P26")
        assertContains(waitForNotification(8_000) {
            text(it).contains("Kellyville in") && containsFragment(text(it), "P2")
        }, "Kellyville in", "Get off on P2")
        waitUntil("completed background tracker remained active", 10_000) { trackerNotification() == null }
        assertNull(model.trackerActiveRevision())
    }

    @Test fun lockedServiceAdvancesStagesAndCompletes() {
        grantNotifications()
        launchActivity()
        clearFocus()
        val now = System.currentTimeMillis()
        setFocus(shortJourney("locked", now))
        waitForNotification { text(it).contains("Central") }
        shell("input keyevent HOME")
        shell("input keyevent SLEEP")
        try {
            assertContains(waitForNotification(8_000) { text(it).contains("M1 leaves") }, "M1 leaves", "P26")
            assertContains(waitForNotification(8_000) {
                text(it).contains("Kellyville in") && containsFragment(text(it), "P2")
            }, "Kellyville in", "Get off on P2")
            waitUntil("completed locked tracker remained active", 10_000) { trackerNotification() == null }
        } finally {
            shell("input keyevent WAKEUP")
        }
    }

    @Test fun retainedTimesAndCancellationStayOnChosenService() {
        grantNotifications()
        launchActivity()
        clearFocus()
        val retained = fixture("offline-stale", "retained")
        setFocus(retained)
        assertContains(waitForNotification(), "Central", "P21", "P26", "Kellyville", "Offline")
        val retainedRevision = requireNotNull(model.trackerActiveRevision())

        val cancelledLegs = retained.journey.legs.mapIndexed { index, leg ->
            if (index == 1) leg.copy(cancelled = true) else leg
        }
        val cancelledJourney = retained.journey.copy(legs = cancelledLegs)
        val cancelled = retained.copy(journey = cancelledJourney,
            board = retained.board.copy(journeys = listOf(cancelledJourney)))
        setFocus(cancelled)
        val notification = waitForNotification { text(it).contains("cancelled", ignoreCase = true) }
        assertContains(notification, "M1 cancelled", "from Central", "Kellyville", "Cancelled (")
        assertFalse(text(notification).contains("Kellyville · about", ignoreCase = true))
        assertEquals(retainedRevision.identity, model.trackerActiveRevision()?.identity)
    }

    @Test fun everyAcceptedFixtureKeepsRequiredFacts() {
        grantNotifications()
        launchActivity()
        clearFocus()
        onMain { model.debugSetTrackerCaptureMode(true) }
        assertTrue(containsFragment("Get off on Platform 2", "Get off on P2"))
        assertFalse(containsFragment("Get off on P21", "Get off on P2"))
        assertFalse(containsFragment("Get off on Platform 26", "Get off on P2"))
        val expectations = mapOf(
            "ride" to listOf("Central", "P21", "P26", "Kellyville"),
            "transfer" to listOf("M1 leaves", "P26", "Kellyville"),
            "final" to listOf("Kellyville in", "Get off on P2"),
            "unknown-platform" to listOf("Kellyville", "Get off at Kellyville"),
            "tight-transfer" to listOf("M1 leaves", "P26", "Tight change", "Kellyville"),
            "offline-stale" to listOf("Central", "P21", "P26", "Kellyville", "Offline"),
            "long-content" to listOf("Bondi Junction", "Platform 21", "Platform 26", "Kellyville"),
        )
        expectations.forEach { (case, required) ->
            onMain { model.debugSetTrackerClock(reviewNow(case)) }
            val focus = fixture(case, "matrix-$case", fixedReview = true)
            setFocus(focus)
            val notification = waitForNotification { value -> required.all { containsFragment(text(value), it) } }
            assertContains(notification, *required.toTypedArray())
            if (Build.VERSION.SDK_INT >= 36) when (case) {
                "ride" -> assertProgressGeometry(notification, 360)
                "transfer" -> assertProgressGeometry(notification, 840)
                "final" -> assertProgressGeometry(notification, 3_660)
            }
        }
    }

    @Test fun progressMissedConnectionAndCancellationUseHonestTemplates() {
        grantNotifications()
        launchActivity()
        clearFocus()

        val ride = fixture("ride", "template-ride")
        setFocus(ride)
        val progressNotification = waitForNotification()
        if (Build.VERSION.SDK_INT >= 36) {
            val progress = Notification.Builder.recoverBuilder(context, progressNotification).style
            assertTrue("ordinary-length ride did not use ProgressStyle", progress is Notification.ProgressStyle)
            progress as Notification.ProgressStyle
            assertEquals("accepted line has one moving marker and no boundary dots", 0, progress.progressPoints.size)
            assertEquals(3, progress.progressSegments.size)
        }

        val missed = missedFocus("template-missed")
        setFocus(missed)
        val missedNotification = waitForNotification { text(it).contains("Planned") }
        assertTrue("missed connection must use expanded ordinary template",
            Notification.Builder.recoverBuilder(context, missedNotification).style is Notification.BigTextStyle)
        assertContains(missedNotification, "connection unavailable", "Planned", "Kellyville")

        setFocus(cancelledFocus("template-first-cancelled", 0))
        val firstCancelled = waitForNotification { text(it).contains("T8 cancelled") }
        assertFalse("first-leg cancellation struck destination ETA", hasStrike(firstCancelled))

        setFocus(cancelledFocus("template-final-cancelled", 1))
        val finalCancelled = waitForNotification { text(it).contains("M1 cancelled") }
        assertContains(finalCancelled, "Kellyville", "Cancelled (")
        assertFalse(text(finalCancelled).contains("Kellyville · about", ignoreCase = true))
        assertTrue("final-leg cancellation did not strike destination ETA", hasStrike(finalCancelled))
    }

    @Test fun olderAndroidUsesUsefulOrdinaryNotification() {
        assumeTrue("ordinary fallback needs an API 35 or older verification device", Build.VERSION.SDK_INT < 36)
        grantNotifications()
        launchActivity()
        clearFocus()
        setFocus(fixture("ride", "ordinary-fallback"))
        val notification = waitForNotification()
        assertTrue(Notification.Builder.recoverBuilder(context, notification).style is Notification.BigTextStyle)
        assertContains(notification, "Central", "Platform 21", "Platform 26", "Kellyville", "Updated")
        assertEquals(10_000, notification.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
        assertTrue(notification.extras.getInt(Notification.EXTRA_PROGRESS) in 850..920)
    }

    @Test fun seedSystemSurface() {
        grantNotifications()
        launchActivity()
        val arguments = InstrumentationRegistry.getArguments()
        val case = arguments.getString("trackerCase") ?: "ride"
        val deterministic = arguments.getString("trackerDeterministic") == "true"
        if (deterministic) onMain {
            model.debugSetTrackerCaptureMode(true)
            model.debugSetTrackerClock(reviewNow(if (case in SpecialCases) "ride" else case))
        }
        clearFocus()
        val focus = when (case) {
            "missed-connection" -> missedFocus("capture-$case", deterministic)
            "first-leg-cancelled" -> cancelledFocus("capture-$case", 0, deterministic)
            "final-leg-cancelled" -> cancelledFocus("capture-$case", 1, deterministic)
            else -> fixture(case, "capture-$case", fixedReview = deterministic)
        }
        setFocus(focus)
        val notification = waitForNotification()
        val required = when (case) {
            "ride" -> arrayOf("Central", "P21", "P26", "Kellyville")
            "offline-stale" -> arrayOf("Central", "P21", "P26", "Kellyville", "Offline")
            "transfer", "tight-transfer" -> arrayOf("M1 leaves", "P26", "Kellyville")
            "final" -> arrayOf("Kellyville in", "Get off on P2")
            "unknown-platform" -> arrayOf("Get off at Kellyville")
            "long-content" -> arrayOf("Bondi Junction", "Platform 21", "Platform 26", "Kellyville")
            "missed-connection" -> arrayOf("connection unavailable", "Planned", "Kellyville")
            "first-leg-cancelled" -> arrayOf("T8 cancelled", "from Mascot", "Kellyville")
            "final-leg-cancelled" -> arrayOf("M1 cancelled", "from Central", "Kellyville", "Cancelled (05:46)")
            else -> error("unknown trackerCase $case")
        }
        assertContains(notification, *required)
        println("TRACKER_CAPTURE_READY case=$case template=${notification.extras.getString(Notification.EXTRA_TEMPLATE)} text=${text(notification)}")
        val holdMillis = arguments.get("trackerHoldMillis")?.toString()?.toLongOrNull()?.coerceIn(0, 120_000) ?: 0
        val release = File(context.getExternalFilesDir(null), "tracker-capture.release")
        val end = SystemClock.elapsedRealtime() + holdMillis
        while (holdMillis > 0 && !release.exists() && SystemClock.elapsedRealtime() < end) SystemClock.sleep(100)
    }

    @Test fun captureSystemSurfaceMatrix() {
        enableInteractiveWindows()
        grantNotifications()
        launchActivity()
        val arguments = InstrumentationRegistry.getArguments()
        val cases = arguments.getString("trackerCases")?.split(',')?.filter { it.isNotBlank() } ?: listOf("ride")
        val schemes = arguments.getString("trackerSchemes")?.split(',')?.filter { it.isNotBlank() } ?: listOf("dark")
        val surfaces = arguments.getString("trackerSurfaces")?.split(',')?.filter { it.isNotBlank() } ?: listOf("shade")
        val directory = File(context.getExternalFilesDir(null), "tracker-system").also { it.deleteRecursively(); it.mkdirs() }
        onMain { model.debugSetTrackerCaptureMode(true) }
        clearFocus()

        schemes.forEach { scheme ->
            require(scheme == "dark" || scheme == "light") { "unknown tracker scheme $scheme" }
            shell("cmd uimode night ${if (scheme == "dark") "yes" else "no"}")
            SystemClock.sleep(1_000)
            surfaces.forEach { surface ->
                val firstCase = cases.firstOrNull() ?: error("trackerCases must not be empty")
                publishCaptureCase(firstCase, bringActivityForward = true)
                cases.forEachIndexed { index, case ->
                    if (index > 0) publishCaptureCase(case, bringActivityForward = surface == "shade")
                    if (index == 0 || surface == "lock") prepareSystemSurface(surface)
                    captureSystemSurface(directory, "tracker-$case-$scheme-$surface", surface, captureRequired(case))
                }
                if (surface == "lock") dismissKeyguard()
            }
        }
    }

    private fun publishCaptureCase(case: String, bringActivityForward: Boolean) {
        val clockCase = if (case in SpecialCases) "ride" else case
        val now = reviewNow(clockCase)
        onMain { model.debugSetTrackerClock(now) }
        if (bringActivityForward) {
            shell("am start -n ${context.packageName}/.MainActivity")
            instrumentation.waitForIdleSync()
            waitReady()
            SystemClock.sleep(500)
        }
        val focus = captureFocus(case, fixedReview = true)
        setFocus(focus)
        val required = captureRequired(case)
        var observed = "no tracker notification"
        try {
            waitForNotification(12_000) { notification ->
                observed = text(notification)
                required.all { containsFragment(observed, it) }
            }
        } catch (failure: AssertionError) {
            throw AssertionError("$case expected ${required.joinToString()} but observed $observed", failure)
        }
        println("TRACKER_SYSTEM_READY case=$case revision=${model.trackerActiveRevision()?.generation}")
    }

    private fun fixture(caseName: String, tripId: String, pinned: Boolean = false, fixedReview: Boolean = false): FocusedJourney {
        val root = fixtureRoot()
        val base = root.getJSONObject("base")
        val selected = (0 until root.getJSONArray("cases").length())
            .map { root.getJSONArray("cases").getJSONObject(it) }
            .single { it.getString("name") == caseName }
        val reviewNow = selected.getLong("now")
        val shift = if (fixedReview) 0 else System.currentTimeMillis() - reviewNow
        val legs = (0 until base.getJSONArray("legs").length()).map { index ->
            val value = base.getJSONArray("legs").getJSONObject(index)
            val from = station(value.getJSONObject("from"))
            val to = station(value.getJSONObject("to"))
            val change = selected.optString("changeName").takeIf { it.isNotEmpty() }
            val adjustedFrom = if (change != null && index == 1) from.copy(name = change) else from
            val adjustedTo = if (change != null && index == 0) to.copy(name = change) else to
            val departure = if (index == 1 && selected.has("onwardDeparture")) selected.getLong("onwardDeparture") else value.getLong("departure")
            val finalPlatform = if (index == 1 && selected.has("finalPlatform") && selected.isNull("finalPlatform")) null
                else value.optString("toPlatform").takeIf { it.isNotEmpty() }
            Leg(
                line = value.getString("line"), mode = value.getString("mode"), headsign = value.getString("headsign"),
                from = adjustedFrom, to = adjustedTo, departure = departure + shift, arrival = value.getLong("arrival") + shift,
                fromPlatform = value.optString("fromPlatform").takeIf { it.isNotEmpty() },
                toPlatform = if (index == 1) finalPlatform else value.optString("toPlatform").takeIf { it.isNotEmpty() },
            )
        }
        val journey = Journey(legs, retained = selected.optBoolean("retained"))
        val board = BoardData(
            from = legs.first().from, to = legs.last().to, journeys = listOf(journey),
            generatedAt = selected.optLong("generatedAt", reviewNow) + shift,
            source = base.optString("source", "live"), offline = selected.optBoolean("offline"),
        )
        return FocusedJourney(tripId, false, journey, board, pinned)
    }

    private fun replacementFocus(tripId: String, destination: String): FocusedJourney {
        val original = fixture("ride", tripId)
        val terminal = original.journey.legs.last().to.copy(id = "215520", name = destination)
        val legs = original.journey.legs.mapIndexed { index, leg -> if (index == original.journey.legs.lastIndex) leg.copy(to = terminal) else leg }
        val journey = original.journey.copy(legs = legs)
        return original.copy(journey = journey, board = original.board.copy(to = terminal, journeys = listOf(journey)))
    }

    private fun captureFocus(case: String, fixedReview: Boolean): FocusedJourney = when (case) {
        "missed-connection" -> missedFocus("capture-$case", fixedReview)
        "first-leg-cancelled" -> cancelledFocus("capture-$case", 0, fixedReview)
        "final-leg-cancelled" -> cancelledFocus("capture-$case", 1, fixedReview)
        else -> fixture(case, "capture-$case", fixedReview = fixedReview)
    }

    private fun captureRequired(case: String): Array<String> = when (case) {
        "ride" -> arrayOf("Central in", "P21", "P26", "7 min", "Kellyville", "05:46", "Updated 04:44")
        "offline-stale" -> arrayOf("Central in", "P21", "P26", "7 min", "Kellyville", "05:46", "Offline", "Updated 04:42")
        "transfer" -> arrayOf("M1 leaves", "P26", "Tallawong", "Departs 04:56", "Kellyville", "05:46", "Updated 04:52")
        "tight-transfer" -> arrayOf("M1 leaves", "P26", "Tallawong", "Tight change", "04:53", "Kellyville", "05:46", "Updated 04:52")
        "final" -> arrayOf("Kellyville in", "Get off on P2", "05:46", "Updated 05:39")
        "unknown-platform" -> arrayOf("Kellyville in", "Get off at Kellyville", "05:46", "Updated 05:39")
        "long-content" -> arrayOf("Bondi Junction in", "P21", "P26", "7 min", "Kellyville", "05:46", "Updated 04:44")
        "missed-connection" -> arrayOf("M1 connection unavailable", "M1 departure 04:41", "04:43 arrival", "Kellyville", "Planned 05:24", "Updated 04:44")
        "first-leg-cancelled" -> arrayOf("T8 cancelled", "from Mascot", "Kellyville", "05:46", "Updated 04:44")
        "final-leg-cancelled" -> arrayOf("M1 cancelled", "from Central", "Kellyville", "Cancelled (05:46)", "Updated 04:44")
        else -> error("unknown trackerCase $case")
    }

    private fun prepareSystemSurface(surface: String) {
        when (surface) {
            "shade" -> {
                dismissKeyguard()
                shell("input keyevent HOME")
            }
            "lock" -> {
                shell("cmd statusbar collapse")
                shell("input keyevent HOME")
                shell("input keyevent SLEEP")
                SystemClock.sleep(500)
                shell("input keyevent WAKEUP")
            }
            else -> error("unknown tracker surface $surface")
        }
        SystemClock.sleep(1_000)
    }

    private fun dismissKeyguard() {
        shell("input keyevent WAKEUP")
        shell("wm dismiss-keyguard")
        shell("input keyevent 82")
        SystemClock.sleep(500)
    }

    private fun captureSystemSurface(directory: File, stem: String, surface: String, required: Array<String>) {
        if (surface == "shade") shell("cmd statusbar expand-notifications")
        SystemClock.sleep(1_000)
        instrumentation.uiAutomation.waitForIdle(500, 5_000)
        var root: AccessibilityNodeInfo? = null
        var row: AccessibilityNodeInfo? = null
        val end = SystemClock.elapsedRealtime() + 5_000
        while (row == null && SystemClock.elapsedRealtime() < end) {
            val candidate = trackerWindow(required)
            root = candidate?.first ?: systemUiRoot() ?: instrumentation.uiAutomation.rootInActiveWindow
            row = candidate?.second
            if (row == null) {
                if (surface == "shade") shell("cmd statusbar expand-notifications")
                SystemClock.sleep(250)
            }
        }
        var capturedRoot = root
        var capturedRow = row
        var expand = capturedRow?.let { findDescendant(it) { node ->
            node.viewIdResourceName == "android:id/expand_button" &&
                node.contentDescription?.toString()?.contains("Expand", ignoreCase = true) == true
        } }
        var collapsedCaptured = false
        fun captureCollapsed() {
            val collapsedRow = capturedRow ?: return
            val collapsedRoot = capturedRoot ?: return
            val collapsedBounds = Rect().also(collapsedRow::getBoundsInScreen)
            File(directory, "$stem-collapsed.bounds").writeText(
                "${collapsedBounds.left} ${collapsedBounds.top} ${collapsedBounds.right} ${collapsedBounds.bottom}\n")
            File(directory, "$stem-collapsed.txt").writeText(accessibilityDump(collapsedRoot))
            File(directory, "$stem-collapsed-notification.txt").writeText(shell("dumpsys notification --noredact"))
            writeScreenshot(File(directory, "$stem-collapsed.png"), "$stem collapsed")
            collapsedCaptured = true
        }
        if (expand != null) captureCollapsed()
        var settledPixels: Bitmap? = null
        var pixelsStable = true
        var expanded = false
        val expandEnd = SystemClock.elapsedRealtime() + 3_000
        while (!expanded && SystemClock.elapsedRealtime() < expandEnd) {
            if (expand != null && !collapsedCaptured) captureCollapsed()
            expanded = expand?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            if (!expanded) {
                SystemClock.sleep(250)
                val candidate = trackerWindow(required)
                candidate?.let {
                    capturedRoot = it.first
                    capturedRow = it.second
                }
                expand = capturedRow?.let { row -> findDescendant(row) { node ->
                    node.viewIdResourceName == "android:id/expand_button" &&
                        node.contentDescription?.toString()?.contains("Expand", ignoreCase = true) == true
                } }
            }
        }
        var contentReady = false
        val contentEnd = SystemClock.elapsedRealtime() + 5_000
        while (!contentReady && SystemClock.elapsedRealtime() < contentEnd) {
            val candidate = trackerWindow(required)
            (candidate?.first ?: systemUiRoot())?.let { capturedRoot = it }
            candidate?.second?.let {
                capturedRow = it
                val rendered = accessibilityText(it)
                contentReady = required.all { fragment -> containsFragment(rendered, fragment) }
            }
            if (!contentReady) SystemClock.sleep(250)
        }
        val settlement = waitForStableSystemPixels()
        settledPixels = settlement.first
        pixelsStable = settlement.second
        trackerWindow(required)?.let {
            capturedRoot = it.first
            capturedRow = it.second
        }
        val expansionFailed = !expanded && (capturedRow == null || required.any { fragment ->
            !containsFragment(accessibilityText(requireNotNull(capturedRow)), fragment)
        })
        File(directory, "$stem-notification.txt").writeText(shell("dumpsys notification --noredact"))
        val screenshotWritten = writeScreenshot(File(directory, "$stem.png"), stem, settledPixels)
        if (capturedRoot == null) File(directory, "$stem.missing-root").writeText("System UI accessibility root absent\n")
        else File(directory, "$stem.txt").writeText(accessibilityDump(requireNotNull(capturedRoot)))
        if (capturedRow == null) File(directory, "$stem.missing").writeText("tracker row absent from System UI accessibility tree\n")
        if (!pixelsStable) File(directory, "$stem.unstable").writeText("System UI pixels did not settle\n")
        require(screenshotWritten) { "$stem System UI did not return a screenshot" }
        require(!expansionFailed) { "$stem could not expand to expose its required facts" }
        require(pixelsStable) { "$stem System UI pixels did not settle" }
        requireNotNull(capturedRoot) { "$stem has no System UI accessibility root" }
        val trackerRow = requireNotNull(capturedRow) { "ilovetrains notification missing from $stem System UI" }
        val rendered = accessibilityText(trackerRow)
        required.forEach { fragment ->
            require(containsFragment(rendered, fragment)) { "$stem System UI row lost '$fragment': $rendered" }
        }
        assertFinalCancellationText(stem, rendered)
        val bounds = Rect().also(trackerRow::getBoundsInScreen)
        require(bounds.width() > 0 && bounds.height() > 0) { "$stem tracker row has empty bounds $bounds" }
        File(directory, "$stem.bounds").writeText("${bounds.left} ${bounds.top} ${bounds.right} ${bounds.bottom}\n")
        if (surface == "shade") {
            shell("cmd statusbar collapse")
            shell("input keyevent HOME")
        }
    }

    private fun assertFinalCancellationText(stem: String, rendered: String) {
        if (!stem.contains("final-leg-cancelled")) return
        require(rendered.contains("Cancelled (05:46)", ignoreCase = true)) {
            "$stem did not label the destination arrival as cancelled: $rendered"
        }
        require(!rendered.contains("about 05:46", ignoreCase = true)) {
            "$stem presented an ordinary forecast for a cancelled arrival: $rendered"
        }
    }

    private fun writeScreenshot(file: File, label: String, captured: Bitmap? = null): Boolean {
        val bitmap = captured ?: instrumentation.uiAutomation.takeScreenshot() ?: return false
        try {
            FileOutputStream(file).use { output ->
                require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "$label PNG compression failed" }
            }
        } finally {
            bitmap.recycle()
        }
        return true
    }

    private fun waitForStableSystemPixels(): Pair<Bitmap?, Boolean> {
        var previous: Bitmap? = null
        val end = SystemClock.elapsedRealtime() + 5_000
        while (SystemClock.elapsedRealtime() < end) {
            val current = instrumentation.uiAutomation.takeScreenshot()
            if (current == null) {
                SystemClock.sleep(350)
                continue
            }
            if (previous?.sameAs(current) == true) {
                previous.recycle()
                return current to true
            }
            previous?.recycle()
            previous = current
            SystemClock.sleep(350)
        }
        return previous to false
    }

    private fun findTrackerRow(root: AccessibilityNodeInfo, required: Array<String>): AccessibilityNodeInfo? {
        fun search(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.viewIdResourceName?.endsWith("expandableNotificationRow") == true) {
                val value = accessibilityText(node)
                if (value.contains("ilovetrains", ignoreCase = true) ||
                    required.any { containsFragment(value, it) }) return node
            }
            for (index in 0 until node.childCount) search(node.getChild(index) ?: continue)?.let { return it }
            return null
        }
        return search(root)
    }

    private fun trackerWindow(required: Array<String>): Pair<AccessibilityNodeInfo, AccessibilityNodeInfo>? {
        instrumentation.uiAutomation.windows.forEach { window ->
            val root = window.root ?: return@forEach
            if (root.packageName?.toString() != "com.android.systemui") return@forEach
            findTrackerRow(root, required)?.let { return root to it }
        }
        return null
    }

    private fun enableInteractiveWindows() {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
    }

    private fun systemUiRoot(): AccessibilityNodeInfo? = instrumentation.uiAutomation.windows
        .mapNotNull { it.root }
        .firstOrNull { it.packageName?.toString() == "com.android.systemui" }

    private fun findDescendant(
        root: AccessibilityNodeInfo,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo? {
        if (predicate(root)) return root
        for (index in 0 until root.childCount) {
            findDescendant(root.getChild(index) ?: continue, predicate)?.let { return it }
        }
        return null
    }

    private fun waitForAccessibilityNode(
        message: String,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo {
        var found: AccessibilityNodeInfo? = null
        waitUntil(message) {
            instrumentation.uiAutomation.rootInActiveWindow?.let { findDescendant(it, predicate) }
                ?.also { found = it } != null
        }
        return requireNotNull(found)
    }

    private fun accessibilityText(root: AccessibilityNodeInfo): String = buildList {
        fun collect(node: AccessibilityNodeInfo) {
            node.text?.toString()?.takeIf { it.isNotBlank() }?.let(::add)
            node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let(::add)
            for (index in 0 until node.childCount) node.getChild(index)?.let(::collect)
        }
        collect(root)
    }.distinct().joinToString(" | ")

    private fun accessibilityDump(root: AccessibilityNodeInfo): String = buildString {
        fun appendNode(node: AccessibilityNodeInfo, depth: Int) {
            val bounds = Rect().also(node::getBoundsInScreen)
            val value = node.text?.toString()?.replace(Regex("[\\r\\n\\t]+"), " ").orEmpty()
            val description = node.contentDescription?.toString()?.replace(Regex("[\\r\\n\\t]+"), " ").orEmpty()
            append(depth).append('\t').append(node.viewIdResourceName.orEmpty()).append('\t')
                .append(value).append('\t').append(description).append('\t').append(bounds).append('\n')
            for (index in 0 until node.childCount) node.getChild(index)?.let { appendNode(it, depth + 1) }
        }
        appendNode(root, 0)
    }

    private fun missedFocus(tripId: String, fixedReview: Boolean = false): FocusedJourney {
        val focus = fixture("ride", tripId, fixedReview = fixedReview)
        val now = if (fixedReview) reviewNow("ride") else System.currentTimeMillis()
        val first = focus.journey.legs[0].copy(
            departure = now - 10 * 60_000, arrival = now - 60_000, estimatedArrival = now - 60_000)
        val onward = focus.journey.legs[1].copy(departure = now - 3 * 60_000, arrival = now + 40 * 60_000)
        val journey = focus.journey.copy(legs = listOf(first, onward))
        return focus.copy(journey = journey, board = focus.board.copy(generatedAt = now, journeys = listOf(journey)))
    }

    private fun cancelledFocus(tripId: String, legIndex: Int, fixedReview: Boolean = false): FocusedJourney {
        val focus = fixture("ride", tripId, fixedReview = fixedReview)
        val journey = focus.journey.copy(legs = focus.journey.legs.mapIndexed { index, leg ->
            if (index == legIndex) leg.copy(cancelled = true) else leg
        })
        return focus.copy(journey = journey, board = focus.board.copy(journeys = listOf(journey)))
    }

    private fun shortJourney(tripId: String, now: Long): FocusedJourney {
        val focus = fixture("ride", tripId)
        val first = focus.journey.legs[0].copy(departure = now - 4_000, arrival = now + 2_000)
        val second = focus.journey.legs[1].copy(departure = now + 5_000, arrival = now + 9_000)
        val journey = focus.journey.copy(legs = listOf(first, second))
        return focus.copy(journey = journey, board = focus.board.copy(generatedAt = now, journeys = listOf(journey)))
    }

    private fun savedTrip(focus: FocusedJourney) = SavedTrip(
        focus.tripId, focus.board.from, focus.board.to, lines = focus.journey.legs.map { it.line }.distinct())

    private fun seedProductionInference(tripId: String): FocusedJourney {
        val focus = fixture("ride", tripId)
        val from = focus.board.from.copy(lat = -33.9272, lon = 151.1873)
        val to = focus.board.to.copy(lat = -33.6979, lon = 150.9355)
        val legs = focus.journey.legs.mapIndexed { index, leg ->
            when (index) {
                0 -> leg.copy(from = from)
                focus.journey.legs.lastIndex -> leg.copy(to = to)
                else -> leg
            }
        }
        val journey = focus.journey.copy(legs = legs)
        val board = focus.board.copy(from = from, to = to, journeys = listOf(journey))
        val trip = SavedTrip(focus.tripId, from, to, lines = journey.legs.map { it.line }.distinct())
        runBlocking {
            DeviceStore(context).save(UserData(
                trips = listOf(trip),
                lastAnswer = LastAnswer(trip.id, false, journey.effectiveDeparture - 5 * 60_000, from.id, board, journey),
            ))
        }
        return focus.copy(journey = journey, board = board)
    }

    private fun journeyServiceKey(journey: Journey?): String? = journey?.legs?.joinToString("|") {
        "${it.from.id}:${it.to.id}:${it.line}:${it.departure}"
    }

    private fun station(value: JSONObject) = Station(value.getString("id"), value.getString("name"))

    private fun fixtureRoot() = JSONObject(instrumentation.context.assets.open("conformance/travel-tracker.json")
        .bufferedReader().use { it.readText() })

    private fun reviewNow(caseName: String): Long {
        val cases = fixtureRoot().getJSONArray("cases")
        return (0 until cases.length()).map { cases.getJSONObject(it) }.single { it.getString("name") == caseName }.getLong("now")
    }

    private fun launchActivity(): Activity {
        val activity = instrumentation.startActivitySync(
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        instrumentation.waitForIdleSync()
        waitReady()
        return activity
    }

    private fun waitReady() = waitUntil("application model did not become ready", 15_000) { model.state.value.ready }

    private fun clearFocus() {
        waitReady()
        onMain { model.unpinJourney() }
        waitUntil("prior tracker did not stop") { model.trackerActiveRevision() == null && trackerNotification() == null }
    }

    private fun setFocus(focus: FocusedJourney) {
        onMain { model.debugSetTrackerFocus(focus) }
        waitUntil("focused journey was not published") { model.state.value.focus?.trackerIdentity == focus.trackerIdentity }
    }

    private fun trackerNotification(): Notification? = notifications.activeNotifications
        .firstOrNull { it.id == TravelTrackerNotification.NotificationId }?.notification

    private fun waitForNotification(timeout: Long = 8_000, predicate: (Notification) -> Boolean = { true }): Notification {
        var found: Notification? = null
        waitUntil("tracker notification did not reach expected state", timeout) {
            trackerNotification()?.takeIf { !text(it).contains("Opening current journey") }
                ?.takeIf(predicate)?.also { found = it } != null
        }
        return requireNotNull(found)
    }

    private fun assertContains(notification: Notification, vararg fragments: String) {
        val rendered = text(notification)
        fragments.forEach { fragment ->
            assertTrue("notification lost '$fragment': $rendered", containsFragment(rendered, fragment))
        }
    }

    private fun containsFragment(rendered: String, fragment: String): Boolean {
        val platform = Regex("^(?:P|Platform )(\\d+)$", RegexOption.IGNORE_CASE).matchEntire(fragment)
        if (platform != null) {
            val number = Regex.escape(platform.groupValues[1])
            return Regex("(?i)(?<![A-Za-z0-9])(?:P|Platform\\s+)$number(?!\\d)").containsMatchIn(rendered)
        }
        return normalizePlatformTokens(rendered).contains(normalizePlatformTokens(fragment), ignoreCase = true)
    }

    private fun normalizePlatformTokens(value: String): String =
        Regex("(?i)(?<![A-Za-z0-9])(?:P|Platform\\s+)(\\d+)(?!\\d)")
            .replace(value) { "[[platform:${it.groupValues[1]}]]" }

    private fun text(notification: Notification): String = listOf(
        Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_SUB_TEXT,
        Notification.EXTRA_BIG_TEXT, Notification.EXTRA_TITLE_BIG, Notification.EXTRA_SUMMARY_TEXT,
    ).mapNotNull { notification.extras.getCharSequence(it)?.toString() }.distinct().joinToString(" | ")

    private fun hasStrike(notification: Notification): Boolean = listOf(
        Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT,
    ).mapNotNull { notification.extras.getCharSequence(it) as? Spanned }
        .any { value -> value.getSpans(0, value.length, StrikethroughSpan::class.java).isNotEmpty() }

    private fun assertProgressGeometry(notification: Notification, expectedProgress: Int) {
        val style = Notification.Builder.recoverBuilder(context, notification).style
        assertTrue("canonical fixture did not use ProgressStyle", style is Notification.ProgressStyle)
        style as Notification.ProgressStyle
        assertEquals(listOf(660, 420, 3_000), style.progressSegments.map { it.length })
        assertEquals(expectedProgress, style.progress)
    }

    private fun grantNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requireDriverStep(step: String) {
        assumeTrue(
            "$step is prepared and verified by tools/shoot-travel-tracker-android.sh",
            InstrumentationRegistry.getArguments().getString("trackerDriverStep") == step,
        )
    }

    private fun onMain(block: () -> Unit) = instrumentation.runOnMainSync(block)

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
        }

    private fun assertServiceStopped() {
        waitUntil("tracker foreground service remained active") {
            !shell("dumpsys activity services ${context.packageName}").contains(TravelTrackerService::class.java.name)
        }
    }

    private fun waitUntil(message: String, timeout: Long = 8_000, condition: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeout
        while (SystemClock.elapsedRealtime() < end) {
            if (condition()) return
            SystemClock.sleep(100)
        }
        assertTrue(message, condition())
    }

    companion object {
        private const val RelaunchTripId = "tracker-relaunch"
        private val SpecialCases = setOf("missed-connection", "first-leg-cancelled", "final-leg-cancelled")
    }
}
