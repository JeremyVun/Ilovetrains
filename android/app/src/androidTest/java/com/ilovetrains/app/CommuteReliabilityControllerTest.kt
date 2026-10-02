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
import org.junit.Assert.assertNotNull
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
 * Commute-reliability rules 1 and 3-7 through the real view model with no network: every request fails, and
 * the bundled timetable plans every board, as on the owner's offline rides.
 */
@RunWith(AndroidJUnit4::class)
class CommuteReliabilityControllerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val root = File(context.cacheDir, "commute-reliability-${UUID.randomUUID()}")
    private val owner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
    private val minute = 60_000L
    private val stations by lazy { runBlocking { DeviceStore(context).stations() } }
    private val rhodes by lazy { stations.first { it.id == "213820" } }
    private val central by lazy { stations.first { it.id == "200060" } }
    private val townHall by lazy { stations.first { it.id == "200070" } }
    private val trip by lazy { SavedTrip("rhodes-central", rhodes, central) }
    private lateinit var application: IsolatedApplication
    @Volatile private var homeFixes = 0
    private var monitoringStarts = 0
    private var monitoringStops = 0

    @After fun release() {
        instrumentation.runOnMainSync { owner.viewModelStore.clear() }
        root.deleteRecursively()
    }

    @Test fun theOpenRaceKeepsThePlatformRecordAndEntersOffline() {
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), morningDeparture() - 2 * minute)
        val seen = seenOnThePlatform(model)
        val departure = seen.journey.effectiveDeparture

        onMain { model.activityStopped(); model.pause(); model.backgrounded() }
        val opened = departure + 3 * minute
        val asked = homeFixes
        onMain { model.debugSetTrackerClock(opened); model.activityResumed(); model.permission(granted = true, denied = false); model.resume() }
        waitFor("the open's own refresh to answer") { model.state.value.board?.journeys?.isNotEmpty() == true && !model.state.value.refreshing }
        settle()
        assertEquals("the open's unsighted record cannot replace the platform record", seen, stored().lastAnswer)
        assertTrue("the open asked for a Home fix", homeFixes > asked)

        onMain { model.location(Fix(along(0.25).first, along(0.25).second, opened, accuracyMetres = 10.0)) }
        val focus = requireNotNull(model.state.value.focus) { "the fix after the open's refresh did not enter trip mode" }
        assertFalse(focus.pinned)
        assertEquals(trip.id, focus.tripId)
        assertEquals(seen.journey.key, focus.journey.key)
    }

    @Test fun homeLeftOpenThroughADepartureEntersFromTheHeldRecordOnATickFix() {
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), morningDeparture() - 2 * minute)
        val seen = seenOnThePlatform(model)
        val departure = seen.journey.effectiveDeparture

        onMain { model.debugSetTrackerClock(departure + 30_000); model.refresh() }
        waitFor("the tick after departure to answer") { !model.state.value.refreshing && model.state.value.now == departure + 30_000 }
        settle()
        assertEquals("a platform fix from before departure cannot replace the departed train", seen, stored().lastAnswer)

        val asked = homeFixes
        onMain { model.debugSetTrackerClock(departure + minute); model.refreshTick() }
        assertEquals("the tick after a shown departure takes a fix", asked + 1, homeFixes)
        assertFalse("the tick's fix refreshes in its place", model.state.value.refreshing)

        val (lat, lon) = along(0.15)
        onMain { model.location(Fix(lat, lon, departure + minute, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central))) }
        val focus = requireNotNull(model.state.value.focus) { "the moving tick fix did not enter from the held record" }
        assertFalse(focus.pinned)
        assertEquals(seen.journey.key, focus.journey.key)
    }

    @Test fun aFixOnBoardEntersTheRunningServiceFromTheOfflineTimetable() {
        val running = morningDirect()
        val now = running.effectiveDeparture + (running.effectiveArrival - running.effectiveDeparture) / 2
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), now)

        val (lat, lon) = along(0.5)
        onMain { model.location(Fix(lat, lon, now, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central))) }
        waitFor("on-board entry from the timetable", 60_000) { model.state.value.focus != null }
        val focus = requireNotNull(model.state.value.focus)
        assertFalse(focus.pinned)
        assertEquals(trip.id, focus.tripId)
        assertFalse(focus.reverse)
        assertEquals(running.key, focus.journey.key)
        assertEquals("schedule", focus.board.source)
    }

    @Test fun theEvidenceWaitHoldsAnOverdueTripFor45SecondsAndAProviderRestartDoesNotExtendIt() {
        val now = System.currentTimeMillis()
        val journey = Journey(listOf(Leg("T9", "train", "Hornsby", rhodes, central, now - 20 * minute, now - 4 * minute)))
        val focus = FocusedJourney(trip.id, false, journey, BoardData(rhodes, central, listOf(journey), now - 4 * minute, source = "live"),
            pinned = false, arrivalGuard = ArrivalGuard(armed = true, retainedAt = now - 20 * minute))
        val model = model(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true, focus = focus), now)
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
        onMain { model.arrivalMonitoringFailed(SetupLocationStatus.ServicesDisabled); model.permission(granted = true, denied = false) }
        assertTrue("monitoring restarted after the provider failure", model.arrivalMonitoringActive)
        standing(now + 44_999)
        assertEquals("still inside the wait", ArrivalState.CheckingArrival, model.state.value.arrival?.state)
        standing(now + 45_000)
        assertEquals("the restart did not extend the wait", ArrivalState.Arrived, model.state.value.arrival?.state)
        assertEquals(ArrivalBasis.Estimate, model.state.value.arrival?.basis)
        assertTrue(model.state.value.focusComplete)
    }

    /** The web flashed the ended trip as `Now AGO` with its estimate sign before the way back loaded. */
    @Test fun theWayBackAfterAnEstimateEndingCarriesNoArrivalDecision() {
        val now = System.currentTimeMillis()
        val journey = Journey(listOf(Leg("T9", "train", "Hornsby", rhodes, central, now - 30 * minute, now - 4 * minute)))
        val focus = FocusedJourney(trip.id, false, journey, BoardData(rhodes, central, listOf(journey), now - 4 * minute, source = "live"))
        val model = model(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true, focus = focus), now)
        waitFor("the model to load") { model.state.value.ready }
        onMain {
            model.attachActivity(Any(), {}, {}, {}, {}, { beforeStart -> beforeStart(); true }, {}, {})
            model.activityResumed()
            model.permission(granted = true, denied = false)
        }
        waitFor("the estimate ending") { model.state.value.arrival?.state == ArrivalState.Arrived }
        assertEquals(ArrivalBasis.Estimate, model.state.value.arrival?.basis)

        onMain { model.showReturn() }
        val returning = model.state.value
        assertNull(returning.focus)
        assertNull("the ended trip's decision outlived it", returning.arrival)
        assertFalse(returning.focusComplete)
        assertTrue(returning.reverse)
        assertNull("the ended trip's board stayed on Home", returning.homeBoard)
    }

    @Test fun aGuessedTripStoppedOfflineIsDeclinedAndTheNextFixCannotGuessItAgain() {
        val running = morningDirect()
        val now = running.effectiveDeparture + (running.effectiveArrival - running.effectiveDeparture) / 2
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), now)
        val guessed = enterOnBoard(model, now, 0.5)
        waitFor("entered_inferred") { events().contains("entered_inferred") }

        onMain { model.stopTrip() }
        assertNull(model.state.value.focus)
        assertEquals(Screen.Home, model.state.value.screen)
        waitFor("the stop to persist") { stored().focus == null && stored().inferenceDeclined != null }
        val saved = stored()
        assertTrue("stopping records no ride", saved.rides.isEmpty())
        assertEquals(InferenceDecline(trip.id, false, now, guessed.journey.departureKey, guessed.composed.effectiveArrival), saved.inferenceDeclined)
        waitFor("declined_inferred") { events().count { it == "declined_inferred" } == 1 }

        val later = now + minute
        val (lat, lon) = along(0.55)
        onMain {
            model.debugSetTrackerClock(later)
            model.location(Fix(lat, lon, later, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central)))
        }
        settle()
        assertNull("the declined trip was guessed again one fix later", model.state.value.focus)
    }

    /** Ruling 23: a rider who stops a trip they started while still riding is not guessed back in by the next fix. */
    @Test fun aStartedTripStoppedOfflineIsDeclinedUnreportedAndTheNextFixCannotGuessItAgain() {
        val running = morningDirect()
        val now = running.effectiveDeparture + (running.effectiveArrival - running.effectiveDeparture) / 2
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), now)
        onMain { model.openTrip(trip.id) }
        waitFor("the board to plan the running service", 60_000) { model.state.value.board?.journeys?.any { it.key == running.key } == true }
        onMain { model.boardRowTapped(model.state.value.board!!.journeys.first { it.key == running.key }) }
        val started = requireNotNull(model.state.value.focus).also { assertTrue(it.pinned) }

        onMain { model.stopTrip() }
        assertNull(model.state.value.focus)
        waitFor("the stop to persist") { stored().focus == null && stored().inferenceDeclined != null }
        assertEquals(InferenceDecline(trip.id, false, now, started.journey.departureKey, started.composed.effectiveArrival),
            stored().inferenceDeclined)
        assertTrue(stored().rides.isEmpty())

        val later = now + minute
        val (lat, lon) = along(0.55)
        onMain {
            model.debugSetTrackerClock(later)
            model.location(Fix(lat, lon, later, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central)))
        }
        settle()
        assertNull("the stopped trip was guessed again one fix later", model.state.value.focus)
        assertFalse("stopping a started trip is not reported as a declined guess", events().contains("declined_inferred"))
    }

    @Test fun aRunningRowStartsTheTripOfflineAndAnUpcomingRowOpensDetail() {
        val running = morningDirect()
        val now = running.effectiveDeparture + 5 * minute
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), now)
        val upcoming = upcomingOnTheBoard(model, now)
        onMain { model.boardRowTapped(upcoming) }
        assertEquals(Screen.Detail, model.state.value.screen)
        assertNull(model.state.value.focus)

        onMain { model.back() }
        val row = requireNotNull(model.state.value.board?.journeys?.find { it.key == running.key }) { "the running service is not on the board" }
        onMain { model.boardRowTapped(row) }
        assertEquals(Screen.Home, model.state.value.screen)
        val focus = requireNotNull(model.state.value.focus)
        assertTrue(focus.pinned)
        assertEquals(running.key, focus.journey.key)
        waitFor("the started trip to persist") { stored().focus?.journey?.key == running.key }
    }

    @Test fun startingTheGuessedJourneyFromItsRunningRowKeepsItsGuardAndMonitoring() {
        val running = morningDirect()
        val now = running.effectiveDeparture + (running.effectiveArrival - running.effectiveDeparture) / 2
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), now, monitoring = true)
        enterOnBoard(model, now, 0.5)
        val guard = requireNotNull(model.state.value.focus?.arrivalGuard)
        assertEquals(true, guard.armed)
        assertTrue(model.arrivalMonitoringActive)
        val monitoring = monitoringStarts to monitoringStops

        onMain { model.openTrip(trip.id) }
        waitFor("the board to plan the guessed service") { model.state.value.board?.journeys?.any { it.key == running.key } == true }
        onMain { model.boardRowTapped(model.state.value.board!!.journeys.first { it.key == running.key }) }
        assertEquals(Screen.Home, model.state.value.screen)
        val focus = requireNotNull(model.state.value.focus)
        assertTrue(focus.pinned)
        assertEquals(running.key, focus.journey.key)
        assertEquals(guard, focus.arrivalGuard)
        assertTrue(model.arrivalMonitoringActive)
        assertEquals("monitoring carried on without a restart", monitoring, monitoringStarts to monitoringStops)
    }

    @Test fun aReturnAfterTenMinutesIsANewOpenOnHomeWithTheSelectionCleared() {
        val other = SavedTrip("rhodes-town-hall", rhodes, townHall)
        val at = morningDeparture() - 2 * minute
        val model = open(UserData(trips = listOf(trip, other), modes = setOf("train"), useLocation = true), at)
        val predicted = model.state.value.selectedTripId to model.state.value.reverse
        val browsed = if (predicted.first == trip.id) other else trip
        onMain { model.openTrip(browsed.id) }
        assertEquals(Screen.Board, model.state.value.screen)

        val asked = homeFixes
        away(model, at, 10 * minute)
        assertEquals(Screen.Home, model.state.value.screen)
        assertEquals("the explicit selection was cleared", predicted, model.state.value.selectedTripId to model.state.value.reverse)
        assertNull(model.state.value.detail)
        assertTrue("the new open asked for a Home fix", homeFixes > asked)
        waitFor("the new open's refresh") { !model.state.value.refreshing && model.state.value.board?.from?.id == rhodes.id &&
            model.state.value.board?.to?.id == (if (predicted.first == trip.id) central.id else townHall.id) }
    }

    @Test fun aReturnAfterNineMinutesKeepsTheBoard() {
        val other = SavedTrip("rhodes-town-hall", rhodes, townHall)
        val at = morningDeparture() - 2 * minute
        val model = open(UserData(trips = listOf(trip, other), modes = setOf("train"), useLocation = true), at)
        val browsed = if (model.state.value.selectedTripId == trip.id) other else trip
        onMain { model.openTrip(browsed.id) }

        away(model, at, 9 * minute)
        assertEquals(Screen.Board, model.state.value.screen)
        assertEquals(browsed.id, model.state.value.selectedTripId)
    }

    @Test fun aTrackerTapBeforeTheResumeAfterTenMinutesStillOpensTheTrackedJourney() {
        val at = morningDeparture() - 2 * minute
        val model = open(UserData(trips = listOf(trip), modes = setOf("train"), useLocation = true), at)
        val journey = upcomingOnTheBoard(model, at)
        onMain { model.boardRowTapped(journey); model.startTrip(journey) }
        assertEquals(Screen.Home, model.state.value.screen)
        val revision = requireNotNull(model.trackerActiveRevision()) { "starting the trip opened no tracker session" }

        onMain { model.activityStopped(); model.pause(); model.backgrounded() }
        onMain {
            model.debugSetTrackerClock(at + 12 * minute)
            model.openTrackedJourney(revision)
            model.activityResumed(); model.permission(granted = true, denied = false); model.resume()
        }
        assertEquals(Screen.Detail, model.state.value.screen)
        assertEquals(journey.key, model.state.value.detail?.key)
        assertEquals(trip.id, model.state.value.selectedTripId)
    }

    /** Ruling 24: at the peak on a busy corridor the last 15 minutes alone fill a plan of 24, and the board still offers trains to take. */
    @Test fun aBusyCorridorAtThePeakOffersUpcomingTrainsOffline() {
        val parramatta = stations.first { it.id == "215020" }
        val peak = weekday(8, 0)
        val model = open(UserData(trips = listOf(SavedTrip("central-parramatta", central, parramatta)), modes = setOf("train"),
            useLocation = true), peak)
        val board = requireNotNull(model.state.value.board)
        assertEquals(central.id, board.from.id)
        assertTrue("the board lost the services of the last 15 minutes", board.journeys.any { it.effectiveDeparture in peak - 15 * minute until peak })
        assertTrue("the board offers no train still to leave", board.journeys.any { it.effectiveDeparture >= peak })
        val lead = requireNotNull(nextHomeJourney(board, peak)) { "Home has no train to offer" }
        assertTrue("Home's train has left", lead.effectiveDeparture >= peak)
    }

    /** A fix at train speed [share] of the way from Rhodes to Central enters the service the timetable has running. */
    private fun enterOnBoard(model: TrainViewModel, now: Long, share: Double): FocusedJourney {
        val (lat, lon) = along(share)
        onMain { model.location(Fix(lat, lon, now, speed = 15.0, accuracyMetres = 10.0, bearing = bearing(lat, lon, central))) }
        waitFor("on-board entry from the timetable", 60_000) { model.state.value.focus != null }
        return requireNotNull(model.state.value.focus).also { assertFalse(it.pinned) }
    }

    /** The trip's board, planned offline, and its first service still to leave. */
    private fun upcomingOnTheBoard(model: TrainViewModel, now: Long): Journey {
        onMain { model.openTrip(trip.id) }
        waitFor("the board to plan", 60_000) {
            !model.state.value.refreshing && model.state.value.board?.journeys?.any { it.effectiveDeparture > now } == true
        }
        return model.state.value.board!!.journeys.first { it.effectiveDeparture > now && journeyAllowed(it, setOf("train")) }
    }

    private fun away(model: TrainViewModel, from: Long, absence: Long) {
        onMain { model.activityStopped(); model.pause(); model.backgrounded() }
        onMain {
            model.debugSetTrackerClock(from + absence)
            model.activityResumed(); model.permission(granted = true, denied = false); model.resume()
        }
    }

    private fun events(): List<String> = application.analytics.ledger.map { it.t }

    /** Home opened two minutes before a train with a fix on Rhodes's platform: a real refresh writes the sighted record. */
    private fun seenOnThePlatform(model: TrainViewModel): LastAnswer {
        val at = model.state.value.now
        onMain { model.location(Fix(rhodes.lat, rhodes.lon, at, accuracyMetres = 10.0)) }
        waitFor("the platform refresh to write a sighted record", 60_000) { stored().lastAnswer?.stationId == rhodes.id }
        val seen = requireNotNull(stored().lastAnswer)
        assertEquals(trip.id, seen.tripId)
        assertTrue("the shown train leaves within 15 minutes of the sighting", seen.journey.effectiveDeparture - seen.at in 0..15 * minute)
        assertNotNull(model.state.value.board)
        return seen
    }

    private fun open(data: UserData, at: Long, monitoring: Boolean = false): TrainViewModel {
        val model = model(data, at)
        waitFor("the model and its timetable", 120_000) { model.state.value.ready && model.state.value.timetableStatus != "Opening offline timetable" }
        onMain {
            model.attachActivity(Any(), {}, { homeFixes++ }, {}, {},
                { beforeStart -> if (monitoring) { monitoringStarts++; beforeStart() }; monitoring }, { monitoringStops++ }, {})
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

    /** A clock on the first weekday the bundled timetable covers. */
    private fun weekday(hour: Int, minute: Int): Long {
        val manifest = JSONObject(context.assets.open("timetable-manifest.json").bufferedReader().use { it.readText() })
        var day = LocalDate.parse(manifest.getString("serviceDateFrom"), DateTimeFormatter.BASIC_ISO_DATE).plusDays(1)
        while (day.dayOfWeek == DayOfWeek.SATURDAY || day.dayOfWeek == DayOfWeek.SUNDAY) day = day.plusDays(1)
        return day.atTime(hour, minute).atZone(Sydney).toInstant().toEpochMilli()
    }

    /** The first direct T9 from Rhodes to Central after 07:50 on a weekday the bundled timetable covers. */
    private fun morningDirect(): Journey = runBlocking {
        val after = weekday(7, 50)
        val planner = OfflinePlanner(context, File(root, "search-timetable")).apply { initialize() }
        planner.plan(rhodes, central, after, setOf("train"), 30, 2).journeys
            .filter { it.legs.size == 1 && it.effectiveDeparture >= after }.minBy { it.effectiveDeparture }
    }

    /** A point [share] of the straight line from Rhodes to Central. */
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
