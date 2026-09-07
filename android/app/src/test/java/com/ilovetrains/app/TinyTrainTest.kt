package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TinyTrainTest {
    private val sources = File("src/main/java/com/ilovetrains/app").listFiles()!!.filter { it.extension == "kt" }

    @Test fun theToyReadsTheFlagsAnswerAndRequiresLiteralTrue() {
        fun flag(raw: String) = flagsOf(JSONObject(raw))[TinyTrainFlag] == true
        assertTrue(flag("""{"tiny_train":true,"unrelated":"value"}"""))
        for (raw in listOf("{}", """{"tiny_train":false}""", """{"tiny_train":"true"}""", """{"tiny_train":1}""")) {
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

    /* One answer feeds both flags: a second request for the toy is the regression. */
    @Test fun oneFlagsRequestFeedsTheToyAndTheTransferCap() {
        assertEquals(1, Regex("""api\.flags\(\)""").findAll(source("TrainViewModel.kt")).count())
    }

    private fun source(name: String) = sources.single { it.name == name }.readText()
}
