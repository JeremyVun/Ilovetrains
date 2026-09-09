package com.ilovetrains.app

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class TransitApiTest {
    private val alpha = Station("a", "Alpha")
    private val bravo = Station("b", "Bravo")
    private val board = """{"from":{"id":"a","name":"Alpha"},"to":{"id":"b","name":"Bravo"},"journeys":[],"generatedAt":1000}"""

    @Test fun responseReaderAcceptsTheLimitAndRejectsTheNextByte() {
        assertEquals("1234", readLimited(ByteArrayInputStream("1234".toByteArray()), 4))
        assertTrue(runCatching { readLimited(ByteArrayInputStream("12345".toByteArray()), 4) }.isFailure)
    }

    @Test fun baseUrlHasOnePathSeparator() {
        assertEquals("https://example.test", TransitApi("https://example.test/").baseUrl)
    }

    @Test fun boardRequestsCarryTheTransferLimitOnlyWhenTheCapIsOn() {
        val asked = served(board) { api ->
            api.departures(alpha, bravo, AllModes, transferLimit = 2)
            api.departures(alpha, bravo, AllModes)
        }
        assertEquals("/api/v1/departures?from=a&to=b&limit=10&modes=ferry%2Cmetro%2Ctrain&transferLimit=2", asked.first().path)
        assertEquals("/api/v1/departures?from=a&to=b&limit=10&modes=ferry%2Cmetro%2Ctrain", asked.last().path)
    }

    @Test fun theFollowedJourneyIsRefreshedWithoutATransferLimit() {
        val asked = served(board) { api -> api.focusedDepartures(alpha, bravo, 1_788_645_600_000L) }
        assertNull(asked.single().path.substringAfter('?').split('&').find { it.startsWith("transferLimit=") })
        assertTrue(asked.single().path.contains("modes=ferry%2Cmetro%2Ctrain"))
        assertTrue(asked.single().path.contains("at=2026-09-05T22%3A00%3A00Z"))
    }

    @Test fun directOnlyIsSentAsNumericZero() {
        val asked = served(board) { api -> api.departures(alpha, bravo, AllModes, transferLimit = 0) }
        assertTrue(asked.single().endsWith("&transferLimit=0"))
    }

    @Test fun cancelledPageDisconnectsItsBlockedHttpRequest() = runBlocking {
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val received = CompletableDeferred<Unit>()
        val serving = thread(isDaemon = true) {
            server.accept().use { socket ->
                socket.soTimeout = 3000
                val reader = socket.getInputStream().bufferedReader()
                while (!reader.readLine().isNullOrEmpty()) Unit
                received.complete(Unit)
                runCatching { reader.read() }
            }
        }
        try {
            val request = async { TransitApi("http://127.0.0.1:${server.localPort}").departures(alpha, bravo, AllModes) }
            withTimeout(2000) { received.await() }
            val before = System.nanoTime()
            request.cancelAndJoin()
            assertTrue("cancel waited for the socket timeout", (System.nanoTime() - before) / 1_000_000 < 2000)
        } finally { server.close(); serving.join(4000) }
    }

    @Test fun flagsReadBooleansAndIgnoreEverythingElse() {
        val body = """{"transferLimit":true,"tiny_train":false,"words":"yes","count":3}"""
        var read: Map<String, Boolean> = emptyMap()
        val asked = served(body) { api -> read = api.flags() }
        assertEquals("/api/v1/flags", asked.single().path)
        assertEquals(mapOf("transferLimit" to true, "tiny_train" to false), read)
        served("{}") { api -> assertTrue(api.flags().isEmpty()) }
    }

    @Test fun feedbackNamesThePlatformAndTheBuildVersion() {
        val calls = served("", status = "201 Created") { api -> api.feedback("The board froze on the platform.", "suggestion") }
        val sent = JSONObject(calls.single().body)
        assertEquals("/feedback", calls.single().path)
        assertEquals(setOf("project", "category", "feedback", "platform", "clientVersion"), sent.keys().asSequence().toSet())
        assertEquals("ilovetrains", sent.getString("project"))
        assertEquals("suggestion", sent.getString("category"))
        assertEquals("The board froze on the platform.", sent.getString("feedback"))
        assertEquals("android", sent.getString("platform"))
        assertEquals(BuildConfig.VERSION_NAME, sent.getString("clientVersion"))
        assertTrue(sent.getString("clientVersion").matches(Regex("""\d+\.\d+\.\d+""")))
    }

    @Test fun feedbackFailsWhenTheServiceDoesNotCreateTheRecord() {
        assertTrue(runCatching { served("", status = "200 OK") { api -> api.feedback("Accepted is not created.") } }.isFailure)
    }

    private data class Call(val path: String, val body: String)

    private fun served(body: String, status: String = "200 OK", use: suspend (TransitApi) -> Unit): List<Call> {
        val calls = mutableListOf<Call>()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val bytes = body.toByteArray()
        val serving = thread(isDaemon = true) {
            while (true) {
                val socket = try { server.accept() } catch (_: Exception) { return@thread }
                socket.use {
                    val reader = it.getInputStream().bufferedReader()
                    val request = reader.readLine() ?: return@use
                    var length = 0
                    while (true) {
                        val header = reader.readLine()
                        if (header.isNullOrEmpty()) break
                        if (header.startsWith("Content-Length:", ignoreCase = true)) length = header.substringAfter(':').trim().toInt()
                    }
                    val sent = CharArray(length)
                    var read = 0
                    while (read < length) {
                        val count = reader.read(sent, read, length - read)
                        if (count < 0) break
                        read += count
                    }
                    calls += Call(request.split(' ')[1], String(sent, 0, read))
                    it.getOutputStream().write(
                        ("HTTP/1.1 $status\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray() + bytes)
                    it.getOutputStream().flush()
                }
            }
        }
        try {
            val base = "http://127.0.0.1:${server.localPort}"
            runBlocking { use(TransitApi(base, feedbackUrl = "$base/feedback")) }
        } finally {
            server.close(); serving.join(2000)
        }
        return calls
    }
}
