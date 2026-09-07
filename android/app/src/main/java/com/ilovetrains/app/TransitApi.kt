package com.ilovetrains.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

class TransitApi(baseUrl: String = BuildConfig.API_BASE) {
    val baseUrl = baseUrl.trimEnd('/')
    suspend fun departures(from: Station, to: Station, modes: Set<String>, at: Long? = null, transferLimit: Int? = null): BoardData = withContext(Dispatchers.IO) {
        val args = linkedMapOf("from" to from.id, "to" to to.id, "limit" to "10", "modes" to modes.sorted().joinToString(","))
        at?.let { args["at"] = Instant.ofEpochMilli(it).toString() }
        transferLimit?.let { args["transferLimit"] = it.toString() }
        val query = args.entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }
        val connection = open("/api/v1/departures?$query")
        try {
            check(connection.responseCode == 200) { "Live departures are unavailable" }
            val raw = readLimited(connection.inputStream, 2_000_000)
            Wire.board(JSONObject(raw), api = true).copy(from = from, to = to, serverStale = connection.getHeaderField("X-Data-Stale") == "true")
        } finally { connection.disconnect() }
    }
    /** The followed journey is answered whole: every mode, and never a cap that could hide it. */
    suspend fun focusedDepartures(from: Station, to: Station, at: Long?): BoardData = departures(from, to, AllModes, at)
    suspend fun flags(): Map<String, Boolean> = withContext(Dispatchers.IO) {
        val connection = open("/api/v1/flags")
        try {
            check(connection.responseCode == 200) { "Flags are unavailable" }
            flagsOf(JSONObject(readLimited(connection.inputStream, 64_000)).optJSONObject("flags"))
        } finally { connection.disconnect() }
    }
    private fun open(path: String): HttpURLConnection {
        val connection = URI("$baseUrl$path").toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 5000; connection.readTimeout = 12_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        return connection
    }
    suspend fun feedback(message: String, category: String = "problem") = withContext(Dispatchers.IO) {
        require(message.isNotBlank() && message.toByteArray().size <= 8192 && !message.contains('\u0000') && category in setOf("problem", "suggestion", "other"))
        val connection = URI("https://analytics.jeremyvun.com/feedback").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.connectTimeout = 5000; connection.readTimeout = 12_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Content-Type", "application/json")
        try {
            val body = JSONObject().put("project", "ilovetrains").put("category", category).put("feedback", message).toString()
            require(body.toByteArray().size <= 10_240)
            connection.outputStream.use { it.write(body.toByteArray()) }
            check(connection.responseCode == 201) { "Couldn’t send feedback. Check your connection and try again." }
        } finally { connection.disconnect() }
    }
}

internal fun readLimited(input: InputStream, limit: Int): String = input.use {
    val output = java.io.ByteArrayOutputStream(minOf(limit, 16_384))
    val buffer = ByteArray(8192)
    var total = 0
    while (true) {
        val count = it.read(buffer)
        if (count < 0) break
        total += count
        require(total <= limit) { "Response is too large" }
        output.write(buffer, 0, count)
    }
    output.toString(Charsets.UTF_8.name())
}
