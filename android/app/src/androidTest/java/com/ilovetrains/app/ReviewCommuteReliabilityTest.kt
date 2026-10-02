package com.ilovetrains.app

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ServerSocket
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Adversarial probes for commute-reliability rules 1 and 3 through the real view model with no network, as the owner
 * rides. Each test states what design.md and client-storage.md require; a failure is a defect (REVIEW.md).
 */
@RunWith(AndroidJUnit4::class)
class ReviewCommuteReliabilityTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val root = File(context.cacheDir, "review-commute-reliability-${UUID.randomUUID()}")
    private val owner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
    private val minute = 60_000L
    private val stations by lazy { runBlocking { DeviceStore(context).stations() } }
    private val rhodes by lazy { stations.first { it.id == "213820" } }
    private val central by lazy { stations.first { it.id == "200060" } }
    private val trip by lazy { SavedTrip("rhodes-central", rhodes, central) }
    private lateinit var application: IsolatedApplication
    @Volatile private var homeFixes = 0

    @After fun release() {
        instrumentation.runOnMainSync { owner.viewModelStore.clear() }
        root.deleteRecursively()
    }

    /**
     * Findings 1 and 2. Ruling 2: seen at the platform again after the shown train left means the rider did not board
     * it. That sighting retires the snapshot the visit began with, and offline it re-records the departed train after
     * its departure, which the 0 <= D - at bound keeps from entering. Neither record enters the departed train when
     * the rider boards the next one; on-board entry finds that one.
     */
    @Test fun aPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo() {
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), morningDeparture() - 2 * minute)
        val seen = seenOnThePlatform(model)
        val departure = seen.journey.effectiveDeparture

        // A quick app switch a minute before the train: the return (not a new open) snapshots the stored record.
        onMain { model.activityStopped(); model.pause(); model.backgrounded() }
        onMain { model.debugSetTrackerClock(departure - minute); model.activityResumed(); model.permission(granted = true, denied = false); model.resume() }
        waitFor("the return's refresh", 60_000) { !model.state.value.refreshing && model.state.value.board != null }
        settle()
        assertEquals("the return's refresh keeps the platform record", seen.journey.key, stored().lastAnswer?.journey?.key)

        // Seventy seconds after it left, the rider is still on the platform: the tick fix is at Rhodes.
        val stillThere = departure + 70_000
        onMain { model.debugSetTrackerClock(stillThere); model.refreshTick() }
        onMain { model.location(Fix(rhodes.lat, rhodes.lon, stillThere, accuracyMetres = 10.0)) }
        waitFor("the refresh after the sighting", 60_000) { !model.state.value.refreshing }
        settle()
        val afterSighting = requireNotNull(stored().lastAnswer) { "the sighting after departure left no record" }
        assertEquals("offline Home re-records the departed train it keeps as its answer", seen.journey.key, afterSighting.journey.key)
        assertEquals(stillThere, afterSighting.at)
        val boarding = nextService(model, departure)

        // The rider boards the next train; a fix at train speed where that train is four minutes after it leaves.
        val riding = boarding.effectiveDeparture + 4 * minute
        onMain { model.debugSetTrackerClock(riding); model.refreshTick() }
        val (lat, lon) = along((riding - boarding.effectiveDeparture).toDouble() / (boarding.effectiveArrival - boarding.effectiveDeparture))
        var platformEntry: FocusedJourney? = null
        onMain {
            model.location(Fix(lat, lon, riding, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central)))
            platformEntry = model.state.value.focus
        }
        assertNull("a record entered the train the rider was seen not to board (record after the sighting: " +
            "${afterSighting.journey.key} at ${afterSighting.at - departure} ms past its departure)", platformEntry)
        waitFor("on-board entry", 60_000) { model.state.value.focus != null }
        val focus = requireNotNull(model.state.value.focus)
        assertFalse(focus.pinned)
        assertEquals("on-board entry found the train the rider boarded", boarding.departureKey, focus.journey.departureKey)
    }

    /** The first service the offline board offers after [departure], the one a rider left on the platform boards next. */
    private fun nextService(model: TrainViewModel, departure: Long): Journey =
        requireNotNull(model.state.value.board?.journeys?.filter { !it.cancelled && it.effectiveDeparture > departure }
            ?.minByOrNull { it.effectiveDeparture }) { "the board offers nothing after the departed train" }

    /**
     * Rule 1: the evidence wait starts once per focus and foreground visit; a restart within the visit does not extend
     * it. A service toggle in Settings restarts monitoring and must not hold Checking arrival another 45 s.
     */
    @Test fun aPreferenceChangeWithinTheVisitDoesNotExtendTheEvidenceWait() {
        val now = System.currentTimeMillis()
        val journey = Journey(listOf(Leg("T9", "train", "Hornsby", rhodes, central, now - 20 * minute, now - 4 * minute)))
        val focus = FocusedJourney(trip.id, false, journey, BoardData(rhodes, central, listOf(journey), now - 4 * minute, source = "live"),
            pinned = false, arrivalGuard = ArrivalGuard(armed = true, retainedAt = now - 20 * minute))
        val model = model(UserData(trips = listOf(trip), modes = AllModes, useLocation = true, focus = focus), now)
        waitFor("the model to load") { model.state.value.ready }
        onMain {
            model.attachActivity(Any(), {}, {}, {}, {}, { beforeStart -> beforeStart(); true }, {}, {})
            model.activityResumed()
            model.permission(granted = true, denied = false)
        }
        assertTrue(model.arrivalMonitoringActive)
        assertEquals(ArrivalState.CheckingArrival, model.state.value.arrival?.state)

        fun standing(at: Long) = onMain {
            model.debugSetTrackerClock(at)
            model.arrivalLocation(Fix(rhodes.lat, rhodes.lon, at, speed = 0.0, accuracyMetres = 10.0))
        }
        standing(now + 30_000)
        onMain { model.debugSetTrackerClock(now + 31_000); model.setMode("ferry", false) }
        assertTrue("monitoring carries on after the preference change", model.arrivalMonitoringActive)
        standing(now + 44_000)
        assertEquals("still inside the wait", ArrivalState.CheckingArrival, model.state.value.arrival?.state)
        standing(now + 46_000)
        assertEquals("a preference change within the visit extended the wait", ArrivalState.Arrived, model.state.value.arrival?.state)
        assertEquals(ArrivalBasis.Estimate, model.state.value.arrival?.basis)
    }

    /** Home opened two minutes before a train with a fix on Rhodes's platform: a real refresh writes the sighted record. */
    private fun seenOnThePlatform(model: TrainViewModel): LastAnswer {
        val at = model.state.value.now
        onMain { model.location(Fix(rhodes.lat, rhodes.lon, at, accuracyMetres = 10.0)) }
        waitFor("the platform refresh to write a sighted record", 60_000) { stored().lastAnswer?.stationId == rhodes.id }
        val seen = requireNotNull(stored().lastAnswer)
        assertEquals(trip.id, seen.tripId)
        assertTrue("the shown train leaves within 15 minutes of the sighting", seen.journey.effectiveDeparture - seen.at in 0..15 * minute)
        return seen
    }

    private fun open(data: UserData, at: Long): TrainViewModel {
        val model = model(data, at)
        waitFor("the model and its timetable", 120_000) { model.state.value.ready && model.state.value.timetableStatus != "Opening offline timetable" }
        onMain {
            model.attachActivity(Any(), {}, { homeFixes++ }, {}, {}, { _ -> false }, {}, {})
            model.activityResumed()
            model.permission(granted = true, denied = false)
            model.resume()
        }
        waitFor("the opening refresh", 60_000) { !model.state.value.refreshing && model.state.value.board != null }
        return model
    }

    private fun model(data: UserData, at: Long): TrainViewModel {
        application = IsolatedApplication(File(root, "app")).also { it.attachTo(context) }
        runBlocking { DeviceStore(application).save(data) }
        val closedPort = ServerSocket(0).use { it.localPort }
        lateinit var model: TrainViewModel
        onMain {
            val factory = object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    modelClass.cast(TrainViewModel(application, TransitApi("http://127.0.0.1:$closedPort")))!!
            }
            model = ViewModelProvider(owner, factory)[TrainViewModel::class.java]
            model.debugSetTrackerClock(at)
        }
        return model
    }

    private fun morningDeparture(): Long = morningDirect().effectiveDeparture

    /** The first direct T9 from Rhodes to Central after 07:50 on a weekday the bundled timetable covers. */
    private fun morningDirect(): Journey = runBlocking {
        val manifest = JSONObject(context.assets.open("timetable-manifest.json").bufferedReader().use { it.readText() })
        var day = LocalDate.parse(manifest.getString("serviceDateFrom"), DateTimeFormatter.BASIC_ISO_DATE).plusDays(1)
        while (day.dayOfWeek == DayOfWeek.SATURDAY || day.dayOfWeek == DayOfWeek.SUNDAY) day = day.plusDays(1)
        val after = day.atTime(7, 50).atZone(Sydney).toInstant().toEpochMilli()
        val planner = OfflinePlanner(context, File(root, "search-timetable")).apply { initialize() }
        planner.plan(rhodes, central, after, setOf("train"), 30, 2).journeys
            .filter { it.legs.size == 1 && it.effectiveDeparture >= after }.minBy { it.effectiveDeparture }
    }

    private fun along(share: Double) =
        (rhodes.lat + (central.lat - rhodes.lat) * share) to (rhodes.lon + (central.lon - rhodes.lon) * share)

    private fun bearing(lat: Double, lon: Double, to: Station): Double {
        val rad = Math.PI / 180
        val dLon = (to.lon - lon) * rad
        val y = sin(dLon) * cos(to.lat * rad)
        val x = cos(lat * rad) * sin(to.lat * rad) - sin(lat * rad) * cos(to.lat * rad) * cos(dLon)
        return (atan2(y, x) / rad + 360) % 360
    }

    private fun stored(): UserData = runBlocking { DeviceStore(application).load() }

    /** A refresh caches its board before writing the record; give that write its turn on the main thread. */
    private fun settle() {
        Thread.sleep(1_500)
        onMain {}
    }

    private fun onMain(block: () -> Unit) = instrumentation.runOnMainSync(block)

    private fun waitFor(what: String, timeoutMillis: Long = 15_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (!condition()) {
            check(System.currentTimeMillis() < deadline) { "Timed out waiting for $what" }
            Thread.sleep(50)
        }
    }

    private class IsolatedApplication(private val root: File) : TrainApplication() {
        fun attachTo(context: Context) = attachBaseContext(context)
        override fun getApplicationContext(): Context = this
        override fun getFilesDir(): File = File(root, "files").apply(File::mkdirs)
        override fun getCacheDir(): File = File(root, "cache").apply(File::mkdirs)
        override fun getNoBackupFilesDir(): File = File(root, "no-backup").apply(File::mkdirs)
    }
}
