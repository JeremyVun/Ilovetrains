package com.ilovetrains.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ControllerParityInstrumentedTest {
    private var owner: TestOwner? = null

    @After
    fun releaseModel() {
        owner?.viewModelStore?.clear()
        owner = null
    }

    @Test
    fun automaticallyAddedTripLosesItsMarkAfterExplicitSelection() = runBlocking {
        val central = Station("200060", "Central Station", -33.8832, 151.2067, setOf("train"))
        val parramatta = Station("215020", "Parramatta Station", -33.8173, 151.0053, setOf("train"))
        val model = model(UserData(trips = listOf(SavedTrip("existing", central, parramatta)),
            home = central, useLocation = true))

        model.location(Fix(-33.8736, 151.2069, System.currentTimeMillis(), accuracyMetres = 50.0))

        val added = requireNotNull(model.state.value.justAddedTripId)
        assertEquals(added, model.state.value.selectedTripId)
        model.openTrip(added)
        model.back()
        assertEquals(Screen.Home, model.state.value.screen)
        assertNull(model.state.value.justAddedTripId)
    }

    @Test
    fun feedbackDraftAndCategorySurviveSettingsNavigation() = runBlocking {
        val model = model(UserData(trips = listOf(primaryTrip), useLocation = false))
        model.openSettings()
        model.setFeedbackDraft("Keep this unsent draft")
        model.setFeedbackCategory("suggestion")

        model.back()
        assertDraft(model, Screen.Home)

        model.openTrip(primaryTrip.id)
        assertEquals(Screen.Board, model.state.value.screen)
        model.openSettings()
        model.back()
        assertDraft(model, Screen.Board)

        model.newTrip()
        assertEquals(Screen.Setup, model.state.value.screen)
        model.openSettings()
        model.back()
        assertDraft(model, Screen.Setup)

        model.back()
        assertDraft(model, Screen.Home)
    }

    @Test
    fun inferredRedirectPreservesSavedDirectionalCoordinates() = runBlocking {
        listOf(false, true).forEach { reverse ->
            releaseModel()
            val now = System.currentTimeMillis()
            val directionalFrom = if (reverse) primaryTrip.to else primaryTrip.from
            val directionalTo = if (reverse) primaryTrip.from else primaryTrip.to
            val apiFrom = directionalFrom.copy(lat = 0.0, lon = 0.0)
            val apiTo = directionalTo.copy(lat = 0.0, lon = 0.0)
            val journey = journey(apiFrom, apiTo, now - 120_000, now + 1_200_000, "T1")
            val board = BoardData(apiFrom, apiTo, listOf(journey), now - 10_000, source = "live")
            val answer = LastAnswer(primaryTrip.id, reverse, now - 300_000, directionalFrom.id, board, journey)
            val model = model(UserData(
                trips = listOf(primaryTrip),
                lastTripId = primaryTrip.id,
                lastReverse = reverse,
                lastAnswer = answer,
                modes = setOf("train"),
                useLocation = true,
            ))

            assertEquals(0.0, journey.legs.first().from.lat, 0.0)
            val longitude = if (reverse) 151.08 else 151.02
            model.location(Fix(-33.86, longitude, System.currentTimeMillis()))
            val inferred = model.state.value.focus
            assertNotNull(inferred)
            assertFalse(inferred!!.pinned)
            assertEquals(reverse, inferred.reverse)

            model.newTrip()
            val setupFrom = model.state.value.setupFrom
            assertEquals(directionalFrom, setupFrom)
            val newDestination = Station(
                id = if (reverse) "new-reverse" else "new-forward",
                name = "New destination",
                lat = -33.88,
                lon = 151.15,
                modes = setOf("train"),
            )
            model.chooseSetupTo(newDestination)
            model.saveTrip(requireNotNull(setupFrom), newDestination)

            val saved = model.state.value.trips.single { it.from.id == directionalFrom.id && it.to.id == newDestination.id }
            assertEquals(directionalFrom.lat, saved.from.lat, 0.0)
            assertEquals(directionalFrom.lon, saved.from.lon, 0.0)
            val persisted = storedAfterWrites().trips.single { it.from.id == directionalFrom.id && it.to.id == newDestination.id }
            assertEquals(directionalFrom.lat, persisted.from.lat, 0.0)
            assertEquals(directionalFrom.lon, persisted.from.lon, 0.0)
        }
    }

    @Test
    fun focusedAndAlternativeOpeningsKeepIndependentBoardProvenance() = runBlocking {
        val now = System.currentTimeMillis()
        val focusedJourney = journey(primaryTrip.from, primaryTrip.to, now + 600_000, now + 1_800_000, "T1")
        val duplicateKey = journey(primaryTrip.from, primaryTrip.to, now + 600_000, now + 1_860_000, "T1")
        val alternative = journey(primaryTrip.from, primaryTrip.to, now + 1_200_000, now + 2_400_000, "T2")
        val focusedBoard = BoardData(primaryTrip.from, primaryTrip.to, listOf(focusedJourney), now - 12_345, source = "live")
        val alternatives = BoardData(primaryTrip.from, primaryTrip.to, listOf(duplicateKey, alternative), now - 54_321, source = "schedule", offline = true)
        val focus = FocusedJourney(primaryTrip.id, false, focusedJourney, focusedBoard, pinned = true, alternatives = alternatives)
        val seeded = UserData(trips = listOf(primaryTrip), focus = focus, useLocation = false)

        val focusedModel = model(seeded)
        focusedModel.openJourney(focusedJourney)
        assertEquals(Screen.Detail, focusedModel.state.value.screen)
        assertEquals("live", focusedModel.state.value.board?.source)
        assertEquals(focusedBoard.generatedAt, focusedModel.state.value.board?.generatedAt)
        assertTrue(focusedModel.state.value.focus?.pinned == true)
        assertEquals(focusedBoard.generatedAt, focusedModel.state.value.focus?.board?.generatedAt)

        releaseModel()
        val alternativeModel = model(seeded)
        alternativeModel.openJourney(alternative)
        assertEquals(Screen.Detail, alternativeModel.state.value.screen)
        assertEquals("schedule", alternativeModel.state.value.board?.source)
        assertEquals(alternatives.generatedAt, alternativeModel.state.value.board?.generatedAt)
        assertTrue(alternativeModel.state.value.focus?.pinned == true)
        assertEquals(focusedBoard.generatedAt, alternativeModel.state.value.focus?.board?.generatedAt)
    }

    @Test
    fun browsingAnotherTripPreservesLastAnswer() = runBlocking {
        val now = System.currentTimeMillis()
        val answeredJourney = journey(primaryTrip.from, primaryTrip.to, now + 600_000, now + 1_800_000, "T1")
        val answeredBoard = BoardData(primaryTrip.from, primaryTrip.to, listOf(answeredJourney), now - 5_000, source = "live")
        val lastAnswer = LastAnswer(primaryTrip.id, false, now - 10_000, primaryTrip.from.id, answeredBoard, answeredJourney)
        val focus = FocusedJourney(primaryTrip.id, false, answeredJourney, answeredBoard)
        val model = model(UserData(
            trips = listOf(primaryTrip, secondaryTrip),
            lastTripId = primaryTrip.id,
            focus = focus,
            lastAnswer = lastAnswer,
            useLocation = false,
        ))

        model.openTrip(secondaryTrip.id)
        assertEquals(Screen.Board, model.state.value.screen)
        assertEquals(secondaryTrip.id, model.state.value.selectedTripId)
        model.setAppearance(Appearance.Light)

        val persisted = storedAfterWrites()
        assertEquals(Appearance.Light, persisted.appearance)
        assertEquals(lastAnswer, persisted.lastAnswer)
    }

    private suspend fun model(data: UserData): TrainViewModel {
        application = IsolatedApplication(File(root, "scenario-${UUID.randomUUID()}"))
            .also { it.attachTo(InstrumentationRegistry.getInstrumentation().targetContext) }
        DeviceStore(application).save(data)
        val nextOwner = TestOwner()
        owner = nextOwner
        val factory = ViewModelProvider.AndroidViewModelFactory(application)
        val model = ViewModelProvider(nextOwner, factory)[TrainViewModel::class.java]
        withTimeout(10_000) { model.state.first { it.ready } }
        return model
    }

    private suspend fun storedAfterWrites(): UserData {
        delay(750)
        return DeviceStore(application).load()
    }

    private fun assertDraft(model: TrainViewModel, screen: Screen) {
        assertEquals(screen, model.state.value.screen)
        assertEquals("Keep this unsent draft", model.state.value.feedbackDraft)
        assertEquals("suggestion", model.state.value.feedbackCategory)
    }

    private class TestOwner : ViewModelStoreOwner {
        override val viewModelStore = ViewModelStore()
    }

    companion object {
        private lateinit var root: File
        private lateinit var application: IsolatedApplication
        private val primaryTrip = SavedTrip(
            "primary",
            Station("origin", "Origin Station", -33.86, 151.0, setOf("train")),
            Station("destination", "Destination Station", -33.86, 151.1, setOf("train")),
        )
        private val secondaryTrip = SavedTrip(
            "secondary",
            Station("second-origin", "Second Origin Station", -33.90, 151.2, setOf("train")),
            Station("second-destination", "Second Destination Station", -33.95, 151.25, setOf("train")),
        )

        @JvmStatic
        @BeforeClass
        fun createApplication() {
            val target = InstrumentationRegistry.getInstrumentation().targetContext
            root = File(target.cacheDir, "controller-parity-${UUID.randomUUID()}")
        }

        @JvmStatic
        @AfterClass
        fun removeApplicationState() {
            root.deleteRecursively()
        }

        private fun journey(from: Station, to: Station, departure: Long, arrival: Long, line: String): Journey = Journey(listOf(
            Leg(
                line = line,
                mode = "train",
                headsign = to.name,
                from = from,
                to = to,
                departure = departure,
                arrival = arrival,
                identity = TripIdentity("test", "$line-$departure", "20260908", from.id, to.id, 1, 2),
            ),
        ))
    }

    private class IsolatedApplication(private val root: File) : Application() {
        fun attachTo(context: Context) = attachBaseContext(context)

        override fun getApplicationContext(): Context = this
        override fun getFilesDir(): File = File(root, "files").apply(File::mkdirs)
        override fun getCacheDir(): File = File(root, "cache").apply(File::mkdirs)
        override fun getNoBackupFilesDir(): File = File(root, "no-backup").apply(File::mkdirs)
    }
}
