package com.ilovetrains.app

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class FeedbackBoundaryTest {
    private val bodyLimit = 10_240
    private val messageLimit = 8192

    @Test fun theLargestBodyTheCapAcceptsIsExactlyTheCapAndOneByteMoreIsRefused() {
        val envelope = accepted { api -> api.feedback("x") }.toByteArray().size - 1
        val room = bodyLimit - envelope
        val message = "\"".repeat(room / 2) + "x".repeat(room % 2)
        assertTrue(message.toByteArray().size < messageLimit)

        val sent = accepted { api -> api.feedback(message) }
        assertEquals(bodyLimit, sent.toByteArray().size)
        assertEquals(message, JSONObject(sent).getString("feedback"))

        val refused = runCatching { accepted { api -> api.feedback(message + "x") } }
        assertTrue(refused.exceptionOrNull() is IllegalArgumentException)
    }

    @Test fun theLargestMultiByteMessageFitsTheBodyCap() {
        val message = "🚂".repeat(messageLimit / 4)
        assertEquals(messageLimit, message.toByteArray().size)
        val sent = accepted { api -> api.feedback(message) }
        assertTrue(sent.toByteArray().size <= bodyLimit)
    }

    @Test fun escapedWorstCasesFailBeforeTheTransport() {
        for (glyph in listOf("\"", "\\", "\n", "\u2028")) {
            val message = "x" + glyph.repeat((messageLimit - 2) / glyph.toByteArray().size) + "x"
            assertTrue(message.toByteArray().size <= messageLimit)
            val result = runCatching { accepted { api -> api.feedback(message) } }
            assertTrue(glyph, result.exceptionOrNull() is IllegalArgumentException)
        }
    }

    private fun accepted(use: suspend (TransitApi) -> Unit): String {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        var sent = ""
        val serving = thread(isDaemon = true) {
            runCatching {
                server.accept().use { socket ->
                    val input = socket.getInputStream()
                    val head = ByteArrayOutputStream()
                    while (!String(head.toByteArray(), Charsets.ISO_8859_1).endsWith("\r\n\r\n")) {
                        val byte = input.read()
                        if (byte < 0) break
                        head.write(byte)
                    }
                    val length = String(head.toByteArray(), Charsets.ISO_8859_1).lines()
                        .first { it.startsWith("Content-Length:", ignoreCase = true) }.substringAfter(':').trim().toInt()
                    val body = ByteArray(length)
                    var read = 0
                    while (read < length) {
                        val count = input.read(body, read, length - read)
                        if (count < 0) break
                        read += count
                    }
                    sent = String(body, 0, read)
                    socket.getOutputStream().write("HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    socket.getOutputStream().flush()
                }
            }
        }
        try {
            val base = "http://127.0.0.1:${server.localPort}"
            runBlocking { use(TransitApi(base, feedbackUrl = "$base/feedback")) }
        } finally {
            server.close(); serving.join(2000)
        }
        return sent
    }
}
