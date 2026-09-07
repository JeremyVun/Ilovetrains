package com.ilovetrains.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SetupLocationControllerTest {
    // Keep the model's personal state and timetable outside the installed user's directories.
    private class TestApplication(context: Context, private val directory: File) : Application() {
        init { attachBaseContext(context) }
        override fun getApplicationContext(): Context = this
        override fun getFilesDir() = File(directory, "files").apply { mkdirs() }
        override fun getNoBackupFilesDir() = File(directory, "no-backup").apply { mkdirs() }
    }
    @Test fun explicitLookupAndManualEditsRespectCurrentIntent() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "location-test-${UUID.randomUUID()}")
        val application = TestApplication(context, directory)
        val owner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
        try {
            val model = withContext(Dispatchers.Main) {
                ViewModelProvider(owner, ViewModelProvider.AndroidViewModelFactory(application))[TrainViewModel::class.java]
            }
            withTimeout(15_000) { while (!model.state.value.ready) delay(20) }
            withContext(Dispatchers.Main) {
                var requests = 0
                model.onLocationRequest = { requests++ }
                val central = model.state.value.stations.first { it.id == "200060" }
                val townHall = model.state.value.stations.first { it.id == "200070" }
                fun fix(accuracy: Double = 25.0) = Fix(townHall.lat, townHall.lon, System.currentTimeMillis(), accuracyMetres = accuracy)
                assertEquals(0, requests)
                model.requestLocation(); model.requestLocation()
                assertEquals(1, requests)
                assertEquals(SetupLocationStatus.Locating, model.state.value.setupLocationStatus)
                model.setupOriginQueryChanged(); model.location(fix()); model.locationFailed(SetupLocationStatus.Unavailable)
                assertNull(model.state.value.setupFrom)
                assertEquals(SetupLocationStatus.Idle, model.state.value.setupLocationStatus)
                model.requestLocation(); model.location(fix())
                assertEquals(townHall.id, model.state.value.setupFrom?.id)
                model.clearSetupFrom(); model.requestLocation(); model.location(fix(1_000.0))
                assertNull(model.state.value.setupFrom)
                assertEquals(SetupLocationStatus.ChooseStation, model.state.value.setupLocationStatus)
                model.location(fix())
                assertNull("A later silent fix cannot replace an offered station choice", model.state.value.setupFrom)
                model.chooseSetupFrom(central); model.location(fix())
                assertEquals(central.id, model.state.value.setupFrom?.id)
                model.saveTrip(central, townHall)
                model.newTrip(); model.location(fix())
                assertNull("A silent lookup must not prefill an additional trip", model.state.value.setupFrom)
                model.requestLocation(); model.locationFailed(SetupLocationStatus.Denied)
                assertEquals(SetupLocationStatus.Denied, model.state.value.setupLocationStatus)
                model.requestLocation(); model.location(fix())
                assertEquals(townHall.id, model.state.value.setupFrom?.id)
                model.clearSetupFrom(); model.requestLocation(); model.back(); model.locationFailed(SetupLocationStatus.Unavailable)
                assertEquals(SetupLocationStatus.Idle, model.state.value.setupLocationStatus)
                model.pause()
            }
        } finally {
            withContext(Dispatchers.Main) { owner.viewModelStore.clear() }
            directory.deleteRecursively()
        }
    }
}
