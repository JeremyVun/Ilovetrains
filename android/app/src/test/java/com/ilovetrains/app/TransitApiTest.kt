package com.ilovetrains.app

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        assertEquals("/api/v1/departures?from=a&to=b&limit=10&modes=ferry%2Cmetro%2Ctrain&transferLimit=2", asked.first())
        assertEquals("/api/v1/departures?from=a&to=b&limit=10&modes=ferry%2Cmetro%2Ctrain", asked.last())
    }

    @Test fun theFollowedJourneyIsRefreshedWithoutATransferLimit() {
        val asked = served(board) { api -> api.focusedDepartures(alpha, bravo, 1_788_645_600_000L) }
        assertNull(asked.single().substringAfter('?').split('&').find { it.startsWith("transferLimit=") })
        assertTrue(asked.single().contains("modes=ferry%2Cmetro%2Ctrain"))
        assertTrue(asked.single().contains("at=2026-09-05T22%3A00%3A00Z"))
    }

    @Test fun flagsReadBooleansAndIgnoreEverythingElse() {
        val body = """{"transferLimit":true,"tiny_train":false,"words":"yes","count":3}"""
        var read: Map<String, Boolean> = emptyMap()
        val asked = served(body) { api -> read = api.flags() }
        assertEquals("/api/v1/flags", asked.single())
        assertEquals(mapOf("transferLimit" to true, "tiny_train" to false), read)
        served("{}") { api -> assertTrue(api.flags().isEmpty()) }
    }

    private fun served(body: String, use: suspend (TransitApi) -> Unit): List<String> {
        val asked = mutableListOf<String>()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val bytes = body.toByteArray()
        val serving = thread(isDaemon = true) {
            while (true) {
                val socket = try { server.accept() } catch (_: Exception) { return@thread }
                socket.use {
                    val reader = it.getInputStream().bufferedReader()
                    val request = reader.readLine() ?: return@use
                    asked += request.split(' ')[1]
                    while (!reader.readLine().isNullOrEmpty()) Unit
                    it.getOutputStream().write(
                        ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray() + bytes)
                    it.getOutputStream().flush()
                }
            }
        }
        try {
            runBlocking { use(TransitApi("http://127.0.0.1:${server.localPort}")) }
        } finally {
            server.close(); serving.join(2000)
        }
        return asked
    }
}
