package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TinyTrainTest {
    private val sources = File("src/main/java/com/ilovetrains/app").listFiles()!!.filter { it.extension == "kt" }

    @Test fun theToyReadsTheFlagsAnswerAndRequiresLiteralTrue() {
        fun flag(raw: String) = Wire.user(JSONObject(raw)).flags[TinyTrainFlag] == true
        assertTrue(flag("""{"flags":{"tiny_train":true,"unrelated":"value"}}"""))
        for (raw in listOf("{}", """{"flags":{}}""", """{"flags":{"tiny_train":false}}""",
                """{"flags":{"tiny_train":"true"}}""", """{"flags":{"tiny_train":1}}""")) {
            assertFalse(raw, flag(raw))
        }
    }

    @Test fun onlyTheApiClientReachesTheFlagsEndpoint() {
        assertTrue(sources.size > 10)
        for (source in sources.filter { it.name != "TransitApi.kt" }) {
            assertFalse(source.name, source.readText().contains("/api/v1/flags"))
        }
        assertFalse(source("TinyTrain.kt").contains("HttpURLConnection"))
    }

    /* One answer per open, resume and tick feeds both flags. A second request
       for the toy is the regression this guards. */
    @Test fun oneFlagsRequestFeedsTheToyAndTheTransferCap() {
        val model = source("TrainViewModel.kt")
        assertEquals(1, Regex("""api\.flags\(\)""").findAll(model).count())
        assertEquals(3, Regex("""(?<!fun )readFlags\(\)""").findAll(model).count())
        assertTrue(model.contains("copy(tinyTrain = flags?.get(TinyTrainFlag) == true)"))
        assertTrue(model.contains("if (flags == null || flags == data.flags) return@launch"))
        assertTrue(source("UiApp.kt").contains("CompositionLocalProvider(LocalTinyTrainFlag provides state.tinyTrain)"))
    }

    private fun source(name: String) = sources.single { it.name == name }.readText()
}
