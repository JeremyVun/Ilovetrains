package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferRecoveryConformanceTest {
    private val keys = listOf(
        "followedChanges", "composedChanges", "recoveryAnchor", "search", "candidate", "composed",
        "status", "pinIcon", "changeLabels", "receipt", "instruction", "arrival", "figure",
        "provenance", "alert",
    )

    @Test fun everyTransferRecoveryCaseCarriesTheWholeSeam() {
        val fixture = JSONObject(resource("/transfer-recovery.json"))
        assertTrue(fixture.getString("notes").contains("printed clock minutes"))
        assertTrue(fixture.getJSONObject("base").getJSONArray("legs").length() >= 2)
        val cases = fixture.getJSONArray("cases")
        assertTrue(cases.length() > 0)
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val name = case.getString("name")
            assertTrue(name, case.has("now") && case.has("fresh"))
            assertTrue(name, case.getString("by") in listOf("focus", "inferred"))
            assertTrue(name, case.has("searches"))
            val expected = case.getJSONObject("expected")
            assertEquals(name, keys.sorted(), expected.keys().asSequence().sorted().toList())
        }
    }

    private fun resource(name: String) =
        requireNotNull(javaClass.getResourceAsStream(name)).bufferedReader().use { it.readText() }
}
