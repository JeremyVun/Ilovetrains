package com.ilovetrains.app

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal class OfflinePackageStore(private val directory: File) {
    private val activeManifest = File(directory, "active-manifest.json")

    fun database(sha256: String) = File(directory, "timetable-$sha256.sqlite3")

    fun manifests(): List<String> {
        val active = activeManifest.takeIf(File::isFile)?.let { runCatching { it.readText() }.getOrNull() }
        val retained = directory.listFiles { file -> file.name.startsWith("manifest-") && file.name.endsWith(".json") }
            .orEmpty().sortedByDescending(File::lastModified).mapNotNull { runCatching { it.readText() }.getOrNull() }
        return listOfNotNull(active).plus(retained).distinct()
    }

    fun activate(candidateDatabase: File, manifest: String, sha256: String) {
        directory.mkdirs()
        val installed = database(sha256)
        if (candidateDatabase != installed) {
            Files.move(candidateDatabase.toPath(), installed.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }
        writeAtomically(File(directory, "manifest-$sha256.json"), manifest)
        writeAtomically(activeManifest, manifest)
    }

    fun retain(vararg sha256: String?) {
        val keep = sha256.filterNotNull().toSet()
        directory.listFiles { file ->
            (file.name.startsWith("timetable-") && file.name.endsWith(".sqlite3")) ||
                (file.name.startsWith("manifest-") && file.name.endsWith(".json"))
        }.orEmpty().forEach { file ->
            if (keep.none { file.name.contains(it) }) file.delete()
        }
    }

    private fun writeAtomically(destination: File, text: String) {
        val temporary = File(directory, ".${destination.name}.tmp")
        temporary.writeText(text)
        Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}
