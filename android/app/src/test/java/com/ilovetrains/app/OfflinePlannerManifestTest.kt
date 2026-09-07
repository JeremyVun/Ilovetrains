package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class OfflinePlannerManifestTest {
    @Test
    fun acceptsBoundedNetworkManifestWithOrderedCompactDates() {
        val info = OfflinePlanner.parseManifest(JSONObject(manifest()))

        assertEquals("20260901", info.serviceDateFrom)
        assertEquals("20260930", info.serviceDateTo)
    }

    @Test
    fun rejectsOversizedAndMalformedManifestMetadata() {
        assertInvalid(manifest(bytes = 300L * 1_024 * 1_024 + 1))
        assertInvalid(manifest(from = "20260931"))
        assertInvalid(manifest(from = "20260901+0100"))
        assertInvalid(manifest(from = "20261001", to = "20260930"))
        assertInvalid(manifest(sha = "A".repeat(64)))
    }

    private fun assertInvalid(json: String) {
        assertThrows(IllegalArgumentException::class.java) {
            OfflinePlanner.parseManifest(JSONObject(json))
        }
    }

    private fun manifest(
        bytes: Long = 1,
        from: String = "20260901",
        to: String = "20260930",
        sha: String = "a".repeat(64),
    ) = """{"schemaVersion":1,"generatedAt":"2026-09-01T00:00:00Z","packages":[{"source":"network","schemaVersion":1,"sha256":"$sha","url":"/timetable.zip","bytes":$bytes,"serviceDateFrom":"$from","serviceDateTo":"$to"}]}"""
}
