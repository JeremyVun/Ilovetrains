package com.ilovetrains.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files

class OfflinePackageStoreTest {
    @Test
    fun interruptedStagingLeavesTheActiveGenerationSelected() {
        val directory = Files.createTempDirectory("timetable-store").toFile()
        try {
            val store = OfflinePackageStore(directory)
            val old = "a".repeat(64)
            val newer = "b".repeat(64)
            val oldCandidate = directory.resolve("old-candidate")
            oldCandidate.writeText("valid-old")
            store.activate(oldCandidate, manifest(old), old)
            directory.resolve("candidate-$newer.sqlite3").writeText("partial")

            assertEquals(old, selected(store))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun corruptActiveGenerationFallsBackToRetainedPreviousGeneration() {
        val directory = Files.createTempDirectory("timetable-store").toFile()
        try {
            val store = OfflinePackageStore(directory)
            val old = "a".repeat(64)
            val newer = "b".repeat(64)
            directory.resolve("old").also { it.writeText("valid-old"); store.activate(it, manifest(old), old) }
            directory.resolve("new").also { it.writeText("valid-new"); store.activate(it, manifest(newer), newer) }
            store.database(newer).writeText("corrupt")

            assertEquals(old, selected(store))
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun selected(store: OfflinePackageStore): String? = store.manifests().firstNotNullOfOrNull { text ->
        val sha = JSONObject(text).getJSONArray("packages").getJSONObject(0).getString("sha256")
        sha.takeIf { store.database(it).readText().startsWith("valid") }
    }

    private fun manifest(sha: String) = """{"schemaVersion":1,"packages":[{"sha256":"$sha"}]}"""
}
