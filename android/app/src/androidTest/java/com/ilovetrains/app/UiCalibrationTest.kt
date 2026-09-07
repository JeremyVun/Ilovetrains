package com.ilovetrains.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class UiCalibrationTest {
    @get:Rule val compose = createComposeRule()
    private var viewportMetrics = ""

    @Test fun captureCanonicalScreens() {
        val fixture = Fixtures()
        val state = mutableStateOf(fixture.home)
        compose.setContent {
            val density = LocalDensity.current
            val configuration = LocalConfiguration.current
            val layoutDirection = LocalLayoutDirection.current
            val safe = WindowInsets.safeDrawing
            SideEffect {
                val left = safe.getLeft(density, layoutDirection) / density.density
                val right = safe.getRight(density, layoutDirection) / density.density
                val top = safe.getTop(density) / density.density
                val bottom = safe.getBottom(density) / density.density
                viewportMetrics = "root=${configuration.screenWidthDp}x${configuration.screenHeightDp}dp\n" +
                    "safeDrawing=${left.toInt()},${top.toInt()},${right.toInt()},${bottom.toInt()}dp\n" +
                    "content=${(configuration.screenWidthDp - left - right).toInt()}x${(configuration.screenHeightDp - top - bottom).toInt()}dp\n"
            }
            TrainApp(state.value, NoActions)
        }
        capture("home")
        compose.runOnIdle { state.value = fixture.boardState }
        capture("board")
        compose.onRoot().performTouchInput { swipeUp() }
        compose.onRoot().performTouchInput { swipeUp() }
        capture("board-end")
        compose.runOnIdle { state.value = fixture.detailState }
        capture("detail")
        compose.runOnIdle { state.value = fixture.setupState }
        capture("setup")
        compose.runOnIdle { state.value = fixture.settingsState }
        capture("settings")
        compose.runOnIdle { state.value = fixture.delayedState }
        capture("board-delayed")
        compose.runOnIdle { state.value = fixture.cancelledState }
        capture("detail-cancelled")
        compose.runOnIdle { state.value = fixture.twoChangesState }
        capture("detail-two-changes")
        compose.runOnIdle { state.value = fixture.activePinnedState }
        capture("home-active-pinned")
        compose.runOnIdle { state.value = fixture.activePinnedState.copy(appearance = Appearance.Light) }
        capture("home-active-pinned-light")
        compose.runOnIdle { state.value = fixture.activePinnedState.copy(screen = Screen.Board, focus = null) }
        capture("board-transfer")
        compose.runOnIdle {
            state.value = fixture.activePinnedState.copy(
                screen = Screen.Board,
                focus = null,
                appearance = Appearance.Light,
            )
        }
        capture("board-transfer-light")
        compose.runOnIdle { state.value = fixture.activeInferredState }
        capture("home-active-inferred")
        compose.runOnIdle { state.value = fixture.completedState }
        capture("home-completed")
        compose.runOnIdle { state.value = fixture.longNamesState }
        capture("home-long-names")
        compose.runOnIdle { state.value = fixture.home.copy(appearance = Appearance.Light) }
        capture("home-light")
        compose.runOnIdle { state.value = fixture.boardState.copy(appearance = Appearance.Light) }
        capture("board-light")
        compose.runOnIdle { state.value = fixture.settingsState.copy(appearance = Appearance.Light) }
        capture("settings-light")
        compose.runOnIdle { state.value = fixture.homeNowState }
        capture("home-now")
        compose.runOnIdle { state.value = fixture.boardNowState }
        capture("board-now")
        compose.runOnIdle { state.value = fixture.homeNowState.copy(appearance = Appearance.Light) }
        capture("home-now-light")
        compose.runOnIdle { state.value = fixture.boardNowState.copy(appearance = Appearance.Light) }
        capture("board-now-light")
        compose.runOnIdle { state.value = fixture.offlineDepartedT9State.copy(screen = Screen.Home) }
        capture("home-offline-retained-t9")
        compose.runOnIdle { state.value = fixture.offlineDepartedT9State }
        val retainedT9 = checkNotNull(fixture.offlineDepartedT9State.board).journeys.first()
        compose.onNode(hasScrollAction()).performScrollToNode(hasTestTag("board-journey-${retainedT9.key}"))
        capture("board-offline-retained-t9")
        compose.runOnIdle { state.value = fixture.ferryState }
        capture("detail-f1-manly")
        compose.runOnIdle { state.value = fixture.pyrmontTransferState }
        capture("detail-pyrmont-double-bay")
        compose.runOnIdle { state.value = fixture.twoTripsState }
        compose.onNodeWithTag("trip-${fixture.beachTrip.id}").performTouchInput {
            down(centerRight); moveBy(Offset(-width * 0.6f, 0f))
        }
        capture("home-deleting")
        compose.onNodeWithTag("trip-${fixture.beachTrip.id}").performTouchInput { cancel() }
        compose.runOnIdle { state.value = fixture.deletedState }
        capture("home-deleted")
    }

    @Test fun swipeDeletesRowAndUndoRestoresIt() {
        val fixture = Fixtures()
        val state = mutableStateOf(fixture.twoTripsState)
        val actions = object : UiActions by NoActions {
            val deleted = mutableListOf<String>()
            override fun deleteTrip(id: String) {
                deleted += id
                state.value = state.value.copy(trips = state.value.trips.filter { it.id != id }, totalTrips = state.value.trips.size - 1,
                    message = "Rhodes → Bondi Junction deleted", undoAvailable = true)
            }
            override fun undoDelete() { state.value = fixture.twoTripsState }
        }
        compose.setContent { TrainApp(state.value, actions) }
        val row = "trip-${fixture.beachTrip.id}"

        compose.onNodeWithTag(row).performTouchInput { swipeLeft(centerRight.x, centerRight.x - width * 0.25f, durationMillis = 2_000) }
        compose.waitForIdle()
        assertEquals(emptyList<String>(), actions.deleted)
        compose.onNodeWithTag(row).assertIsDisplayed()

        compose.onNodeWithTag(row).performTouchInput { swipeLeft(centerRight.x, centerRight.x - width * 0.75f, durationMillis = 2_000) }
        compose.waitUntil(5_000) { actions.deleted.isNotEmpty() }
        assertEquals(listOf(fixture.beachTrip.id), actions.deleted)
        compose.onNodeWithText("UNDO").assertIsDisplayed()
        compose.onNodeWithText("Rhodes → Bondi Junction deleted").assertIsDisplayed()
        compose.onNodeWithTag(row).assertDoesNotExist()

        compose.onNodeWithText("UNDO").performClick()
        compose.onNodeWithTag(row).assertIsDisplayed()
        compose.onNodeWithText("UNDO").assertDoesNotExist()

        compose.onNodeWithTag(row).performTouchInput { swipeLeft(centerRight.x, centerRight.x - width * 0.75f, durationMillis = 2_000) }
        compose.waitUntil(5_000) { actions.deleted.size == 2 }
        compose.onNodeWithTag(row).assertDoesNotExist()
    }

    @Test fun tripListStillScrollsVertically() {
        val fixture = Fixtures()
        val trips = (0 until 8).map { i -> fixture.beachTrip.copy(id = "$i") }
        compose.setContent { TrainApp(fixture.home.copy(trips = trips, totalTrips = trips.size), NoActions) }
        compose.onNodeWithTag("trip-7").assertIsNotDisplayed()
        compose.onNodeWithTag("trip-0").performTouchInput { swipeUp() }
        compose.onNodeWithTag("trip-7").assertIsDisplayed()
    }

    @Test fun pagesEarlierAfterPastRowsArrive() {
        val fixture = Fixtures()
        val original = fixture.boardState
        val board = checkNotNull(original.board)
        val state = mutableStateOf(original.copy(board = board.copy(journeys = board.journeys.take(3))))
        val actions = object : UiActions by NoActions {
            var earlierCalls = 0
            override fun earlier() { earlierCalls++ }
        }
        compose.setContent { TrainApp(state.value, actions) }
        compose.waitForIdle()

        val offset = -10 * 60_000L
        val past = Journey(board.journeys.first().legs.map { leg ->
            leg.copy(
                departure = leg.departure + offset,
                arrival = leg.arrival + offset,
                estimatedDeparture = leg.estimatedDeparture?.plus(offset),
                estimatedArrival = leg.estimatedArrival?.plus(offset),
            )
        })
        compose.runOnIdle { state.value = original.copy(board = board.copy(journeys = listOf(past) + board.journeys)) }
        compose.onNode(hasScrollAction()).performScrollToNode(hasTestTag("board-journey-${past.key}"))
        compose.waitUntil(2_000) { actions.earlierCalls > 0 }
    }

    @Test fun offlineBoardKeepsDepartedDelayedServiceReachable() {
        val fixture = Fixtures()
        compose.setContent { TrainApp(fixture.offlineDepartedT9State, NoActions) }
        val journey = checkNotNull(fixture.offlineDepartedT9State.board).journeys.first()

        compose.onNode(hasScrollAction()).performScrollToNode(hasTestTag("board-journey-${journey.key}"))
        compose.onNodeWithTag("board-journey-${journey.key}").assertIsDisplayed()
    }

    @Test fun settingsUseOnlyPlainServiceStates() {
        val fixture = Fixtures()
        compose.setContent { TrainApp(fixture.settingsState, NoActions) }

        compose.onAllNodesWithText("ON").assertCountEquals(3)
        compose.onAllNodesWithText("OFF").assertCountEquals(1)
        // The personal location row keeps its compact status glyph; service choices do not.
        compose.onAllNodesWithText("✓  ON").assertCountEquals(1)
        compose.onAllNodesWithText("○  OFF").assertCountEquals(0)
    }

    @Test fun feedbackSuccessDismissesButErrorRemains() {
        val fixture = Fixtures()
        val success = "Feedback sent. Thank you."
        val error = "Couldn’t send feedback. Check your connection and try again."
        val state = mutableStateOf(fixture.settingsState.copy(message = success))
        val actions = object : UiActions by NoActions {
            override fun dismissMessage() { state.value = state.value.copy(message = null) }
        }
        compose.mainClock.autoAdvance = false
        compose.setContent { TrainApp(state.value, actions) }

        compose.onNodeWithText(success).assertIsDisplayed()
        compose.mainClock.advanceTimeBy(4_100)
        compose.runOnIdle { }
        compose.onNodeWithText(success).assertIsNotDisplayed()

        compose.runOnIdle { state.value = state.value.copy(message = error) }
        compose.mainClock.advanceTimeBy(10_000)
        compose.runOnIdle { }
        compose.onNodeWithText(error).assertIsDisplayed()
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "calibration").also { it.mkdirs() }
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        if (name == "home") File(directory, "metrics.txt").writeText(viewportMetrics + "capture=${bitmap.width}x${bitmap.height}px\n")
        FileOutputStream(File(directory, "$name.png")).use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}

private class Fixtures {
    private val context = InstrumentationRegistry.getInstrumentation().context
    private val calibration = JSONObject(context.assets.open("conformance/calibration.json").bufferedReader().use { it.readText() })
    private fun board(name: String): BoardData {
        val body = calibration.getJSONObject(name).getJSONObject("body")
        return Wire.board(body, api = true).also {
            check(it.journeys.size == body.getJSONArray("journeys").length()) { "$name fixture lost journeys in Wire.board" }
        }
    }
    private fun now(name: String): Long = calibration.getJSONObject(name).getLong("now")

    private val centralNow = now("central")
    private val centralBoard = board("central")
    private val transferNow = now("transfer")
    private val transferDepartedNow = calibration.getJSONObject("transfer").getLong("departedNow")
    private val transferBoard = board("transfer")
    private val threeLegBoard = board("threeLeg")
    private val ferryNow = now("ferry")
    private val ferryBoard = board("ferry")
    private val pyrmontBoardSource = Wire.board(JSONObject(
        context.assets.open("departures_pyrmont_doublebay.json").bufferedReader().use { it.readText() }), api = true)
    private val pyrmontNow = pyrmontBoardSource.journeys.first().effectiveDeparture - 5 * 60_000
    private val pyrmontBoard = pyrmontBoardSource.copy(generatedAt = pyrmontNow)

    private val centralTrip = SavedTrip("central-parramatta", centralBoard.from, centralBoard.to, lines = listOf("T1"))
    private fun state(now: Long = centralNow, board: BoardData = centralBoard) = AppState(
        ready = true, screen = Screen.Home, trips = listOf(centralTrip), totalTrips = 1,
        selectedTripId = centralTrip.id, board = board, homeBoard = board, now = now,
        appearance = Appearance.Dark, enabledModes = AllModes, locationGranted = true,
    )

    val home = state()
    val boardState = home.copy(screen = Screen.Board)
    private val nowBoard = centralBoard.copy(generatedAt = centralBoard.journeys.first().effectiveDeparture)
    val homeNowState = state(nowBoard.generatedAt, nowBoard)
    val boardNowState = homeNowState.copy(screen = Screen.Board)
    val detailState = state(transferNow, transferBoard).copy(
        screen = Screen.Detail, detail = transferBoard.journeys.first())
    val setupState = home.copy(
        screen = Screen.Setup, setupFrom = centralBoard.from, setupTo = null,
        stations = listOf(centralBoard.to, transferBoard.from, transferBoard.to, ferryBoard.from, ferryBoard.to),
        recentTo = listOf(centralBoard.to),
    )
    val settingsState = home.copy(
        screen = Screen.Settings, home = centralBoard.from, automaticHome = centralBoard.from,
        timetableStatus = "5 Sep – 4 Oct 2026", version = "1.0.0", appearance = Appearance.System,
    )

    // Stress delta: the real first Central service runs six minutes late.
    private val delayedJourney = centralBoard.journeys.first().let { journey ->
        Journey(journey.legs.map { leg -> leg.copy(
            estimatedDeparture = leg.departure + 6 * 60_000,
            estimatedArrival = leg.arrival + 6 * 60_000,
        ) })
    }
    val delayedState = boardState.copy(board = centralBoard.copy(
        journeys = listOf(delayedJourney) + centralBoard.journeys.drop(1)))

    // Stress delta: the real T9/T4 transfer is five minutes late and retained after departure.
    private val departedT9 = transferBoard.journeys.first().let { journey ->
        Journey(journey.legs.map { leg -> leg.copy(
            estimatedDeparture = leg.departure + 5 * 60_000,
            estimatedArrival = leg.arrival + 5 * 60_000,
        ) }, retained = true)
    }
    val offlineDepartedT9State = state(
        now = departedT9.effectiveDeparture + 5 * 60_000,
        board = transferBoard.copy(
            journeys = listOf(departedT9) + transferBoard.journeys.drop(1),
            offline = true,
            homeJourneyKey = departedT9.key,
        ),
    ).copy(screen = Screen.Board)

    // Stress delta: the real first T9 leg is cancelled, preserving its transfer.
    private val cancelledJourney = transferBoard.journeys.first().let { journey ->
        Journey(journey.legs.mapIndexed { index, leg -> leg.copy(cancelled = index == 0) })
    }
    val cancelledState = state(transferNow, transferBoard).copy(
        screen = Screen.Detail, detail = cancelledJourney,
        board = transferBoard.copy(journeys = listOf(cancelledJourney)),
    )
    val twoChangesState = state(now("threeLeg"), threeLegBoard).copy(
        screen = Screen.Detail, detail = threeLegBoard.journeys.first())

    private val activeBoard = transferBoard.copy(generatedAt = transferDepartedNow)
    private val activeJourney = activeBoard.journeys.first()
    val activePinnedState = state(transferDepartedNow, activeBoard).copy(
        trips = listOf(SavedTrip("rhodes-bondi", activeBoard.from, activeBoard.to, lines = listOf("T9", "T4"))),
        selectedTripId = "rhodes-bondi",
        focus = FocusedJourney("rhodes-bondi", false, activeJourney, activeBoard, pinned = true),
    )
    val activeInferredState = activePinnedState.copy(
        focus = activePinnedState.focus?.copy(pinned = false))
    val completedState = activePinnedState.copy(focusComplete = true)

    val beachTrip = SavedTrip("rhodes-bondi", transferBoard.from, transferBoard.to, lines = listOf("T9", "T4"))
    val twoTripsState = home.copy(trips = listOf(centralTrip, beachTrip), totalTrips = 2)
    val deletedState = home.copy(message = "Rhodes → Bondi Junction deleted", undoAvailable = true)
    val longNamesState = state(pyrmontNow, pyrmontBoard).copy(
        trips = listOf(SavedTrip("pyrmont-double-bay", pyrmontBoard.from, pyrmontBoard.to, lines = listOf("F4", "F7"))),
        totalTrips = 1, selectedTripId = "pyrmont-double-bay",
        tripMetadata = mapOf("pyrmont-double-bay" to "6.8 km away · Last ridden Wednesday"),
    )
    val ferryState = state(ferryNow, ferryBoard).copy(
        screen = Screen.Detail, detail = ferryBoard.journeys.first { it.legs.first().line == "F1" })
    val pyrmontTransferState = state(pyrmontNow, pyrmontBoard).copy(
        screen = Screen.Detail, detail = pyrmontBoard.journeys.first())
}
private object NoActions : UiActions {
    override fun back() {} ; override fun openTrip(id: String, reverse: Boolean) {} ; override fun reverseTrip() {}
    override fun openJourney(journey: Journey) {} ; override fun pinJourney(journey: Journey) {} ; override fun unpinJourney() {}
    override fun showReturn() {} ; override fun newTrip() {} ; override fun chooseSetupFrom(station: Station) {}
    override fun clearSetupFrom() {} ; override fun chooseSetupTo(station: Station) {} ; override fun clearSetupTo() {}
    override fun saveTrip(from: Station, to: Station) {} ; override fun deleteTrip(id: String) {} ; override fun undoDelete() {} ; override fun openSettings() {}
    override fun setAppearance(value: Appearance) {} ; override fun setMode(mode: String, enabled: Boolean) {}
    override fun setUseLocation(enabled: Boolean) {} ; override fun requestLocation() {} ; override fun chooseHome() {}
    override fun setHome(station: Station?) {} ; override fun refresh() {} ; override fun earlier() {}
    override fun updateTimetable() {} ; override fun feedback(text: String, category: String) {} ; override fun dismissMessage() {}
}
