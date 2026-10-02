package com.ilovetrains.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.lang.reflect.Proxy
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class BoardPastPagingTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val root = File(context.cacheDir, "past-paging-${UUID.randomUUID()}")
    private val owner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
    private val modes = setOf("ferry")
    private val minute = 60_000L

    @After fun release() {
        instrumentation.runOnMainSync { owner.viewModelStore.clear() }
        root.deleteRecursively()
    }

    @Test fun offlineBoardPagesTheRecentPastFromTheTimetableAndOpensAtNow() {
        val gap = departureGap()
        val closedPort = ServerSocket(0).use { it.localPort }
        val model = open(TransitApi("http://127.0.0.1:$closedPort"), gap)

        compose.waitUntil(30_000) { model.state.value.board?.journeys?.any { it.key == gap.departed.key } == true }
        compose.waitForIdle()
        assertEquals("the board opens at NOW", list().top, bounds("board-now").top, 1f)
        assertFalse("the departed service waits above NOW", shown("board-journey-${gap.departed.key}"))

        compose.onNodeWithTag("board-list").performTouchInput { swipeDown() }
        compose.waitForIdle()
        assertTrue("scrolling up reaches the departed service", shown("board-journey-${gap.departed.key}"))
        val reached = bounds("board-journey-${gap.departed.key}").top

        compose.waitUntil(30_000) {
            model.state.value.board?.journeys?.any { it.effectiveDeparture < gap.departed.effectiveDeparture } == true
        }
        compose.waitForIdle()
        assertEquals("an earlier page arrives above without moving the row", reached,
            bounds("board-journey-${gap.departed.key}").top, 1f)
    }

    @Test fun refreshesWhileAPastPageIsInFlightKeepItAndItsOnlineRowsWin() {
        val gap = departureGap()
        val departed = gap.departed
        val observed = Journey(departed.legs.map { it.copy(estimatedDeparture = it.departure + 2 * minute,
            estimatedArrival = it.arrival + 2 * minute) })
        val onlineOnly = Journey(departed.legs.map { it.copy(line = "F99", departure = it.departure + 5 * minute,
            arrival = it.arrival + 5 * minute, identity = null) })
        val page = Wire.board(BoardData(gap.from, gap.to, listOf(observed, onlineOnly), gap.now, source = "live")).toString()
        HeldPastPages(page).use { server ->
            val model = open(TransitApi("http://127.0.0.1:${server.port}"), gap)
            assertTrue("the online page is held", server.awaitHeld())
            assertEquals("the first past page starts 30 minutes ago", gap.now - 30 * minute, server.pastWindows.first())
            repeat(3) {
                instrumentation.runOnMainSync { model.refresh() }
                compose.waitUntil(5_000) { !model.state.value.refreshing }
            }
            compose.waitUntil(5_000) { model.state.value.board?.journeys?.any { it.key == departed.key } == true }
            assertFalse(model.state.value.board!!.journeys.single { it.key == departed.key }.realtime)

            server.release()
            compose.waitUntil(15_000) {
                model.state.value.board?.journeys?.single { it.key == departed.key }?.realtime == true
            }
            val journeys = model.state.value.board!!.journeys
            assertEquals(observed.effectiveDeparture, journeys.single { it.key == departed.key }.effectiveDeparture)
            assertTrue(journeys.any { it.key == onlineOnly.key })
        }
    }

    @Test fun theTopOfABoardWithoutPastRowsAsksForAPageAndEveryPullAsksAgain() {
        val now = System.currentTimeMillis()
        val a = Station("a", "Alpha"); val b = Station("b", "Bravo")
        val upcoming = (1..4).map { Journey(listOf(Leg("T1", "train", "Bravo", a, b, now + it * 10 * minute, now + it * 10 * minute + 20 * minute))) }
        val asked = AtomicInteger()
        val actions = Proxy.newProxyInstance(UiActions::class.java.classLoader, arrayOf(UiActions::class.java)) { proxy, method, args ->
            when (method.name) {
                "earlier" -> { asked.incrementAndGet(); null }
                "equals" -> proxy === args?.firstOrNull()
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "BoardActions"
                else -> null
            }
        } as UiActions
        val state = AppState(ready = true, screen = Screen.Board, now = now, board = BoardData(a, b, upcoming, now, source = "live"))
        compose.setContent { TrainApp(state, actions) }

        compose.waitUntil(5_000) { asked.get() == 1 }
        compose.onNodeWithTag("board-list").performTouchInput { swipeDown() }
        compose.waitUntil(5_000) { asked.get() > 1 }
        val afterFirstPull = asked.get()
        compose.onNodeWithTag("board-list").performTouchInput { swipeDown() }
        compose.waitUntil(5_000) { asked.get() > afterFirstPull }
    }

    private data class Gap(val now: Long, val departed: Journey, val from: Station, val to: Station)

    /** A moment when the last ferry left 15-30 minutes ago, read from the bundled timetable itself. */
    private fun departureGap(): Gap = runBlocking {
        val stations = DeviceStore(context).stations()
        val from = stations.first { it.id == "200020" }
        val to = stations.first { it.id == "209573" }
        val planner = OfflinePlanner(context, File(root, "search-timetable")).apply { initialize() }
        val manifest = JSONObject(context.assets.open("timetable-manifest.json").bufferedReader().use { it.readText() })
        val day = LocalDate.parse(manifest.getString("serviceDateFrom"), DateTimeFormatter.BASIC_ISO_DATE).plusDays(1)
        var at = day.atTime(17, 0).atZone(Sydney).toInstant().toEpochMilli()
        repeat(12) {
            val departures = planner.plan(from, to, at, modes, 30, 2).journeys.sortedBy { it.effectiveDeparture }
            for ((left, right) in departures.zipWithNext()) {
                if (right.effectiveDeparture - left.effectiveDeparture < 25 * minute) continue
                val now = left.effectiveDeparture + 20 * minute
                val board = planner.planWithRecommendation(from, to, now - 15 * minute, modes, 24, 2, recommendationAt = now).board
                val page = planner.plan(from, to, now - 30 * minute, modes, PastTimetableLimit, 2)
                if (board.journeys.none { it.effectiveDeparture < now } && page.journeys.any { it.key == left.key }) {
                    return@runBlocking Gap(now, left, from, to)
                }
            }
            at = (departures.lastOrNull()?.effectiveDeparture ?: at) + minute
        }
        error("The bundled timetable has no evening ferry gap to page into")
    }

    /** A fresh model holding one saved ferry trip, its board opened at the gap's moment. */
    private fun open(api: TransitApi, gap: Gap): TrainViewModel {
        val trip = SavedTrip("ferry", gap.from, gap.to)
        val application = IsolatedApplication(File(root, "app")).also { it.attachTo(context) }
        runBlocking { DeviceStore(application).save(UserData(trips = listOf(trip), modes = modes, useLocation = false)) }
        lateinit var model: TrainViewModel
        instrumentation.runOnMainSync {
            val factory = object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>): T = modelClass.cast(TrainViewModel(application, api))!!
            }
            model = ViewModelProvider(owner, factory)[TrainViewModel::class.java]
        }
        val opening = model.state.value.timetableStatus
        compose.waitUntil(60_000) { model.state.value.ready && model.state.value.timetableStatus != opening }
        instrumentation.runOnMainSync { model.debugSetTrackerClock(gap.now) }
        compose.setContent {
            val state by model.state.collectAsState()
            TrainApp(state, model)
        }
        instrumentation.runOnMainSync { model.openTrip(trip.id) }
        return model
    }

    private fun list(): Rect = bounds("board-list")
    private fun bounds(tag: String): Rect = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
    private fun shown(tag: String): Boolean {
        val list = list()
        return compose.onAllNodesWithTag(tag).fetchSemanticsNodes().any { node ->
            val box = node.boundsInRoot
            box.height > 1f && box.bottom > list.top + 1f && box.top < list.bottom - 1f
        }
    }

    /** Answers board requests with an error and holds every past page until released. */
    private class HeldPastPages(private val body: String) : AutoCloseable {
        private val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        private val held = CountDownLatch(1)
        private val released = CountDownLatch(1)
        val pastWindows = CopyOnWriteArrayList<Long>()
        val port = server.localPort
        private val acceptor = thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                thread(isDaemon = true) { answer(socket) }
            }
        }

        private fun answer(socket: Socket) = socket.use {
            val reader = socket.getInputStream().bufferedReader()
            val request = reader.readLine().orEmpty()
            while (!reader.readLine().isNullOrEmpty()) Unit
            val at = Regex("[?&]at=([^& ]+)").find(request)?.groupValues?.get(1)
            val past = request.contains("/api/v1/departures?") && at != null
            if (past) {
                pastWindows += Instant.parse(URLDecoder.decode(at, "UTF-8")).toEpochMilli()
                held.countDown()
                released.await(30, TimeUnit.SECONDS)
            }
            val (status, text) = if (past) "200 OK" to body else "503 Service Unavailable" to "{}"
            val bytes = text.toByteArray()
            socket.getOutputStream().write(("HTTP/1.1 $status\r\nContent-Type: application/json\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray() + bytes)
            socket.getOutputStream().flush()
        }

        fun awaitHeld() = held.await(15, TimeUnit.SECONDS)
        fun release() = released.countDown()
        override fun close() { released.countDown(); server.close(); acceptor.join(1_000) }
    }

    private class IsolatedApplication(private val root: File) : Application() {
        fun attachTo(context: Context) = attachBaseContext(context)
        override fun getApplicationContext(): Context = this
        override fun getFilesDir(): File = File(root, "files").apply(File::mkdirs)
        override fun getCacheDir(): File = File(root, "cache").apply(File::mkdirs)
        override fun getNoBackupFilesDir(): File = File(root, "no-backup").apply(File::mkdirs)
    }
}
