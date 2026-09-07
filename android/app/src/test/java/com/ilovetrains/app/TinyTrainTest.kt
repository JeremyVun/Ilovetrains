package com.ilovetrains.app

import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking

class TinyTrainTest {
    @Test fun publicFlagRequiresLiteralTrue() {
        assertTrue(tinyTrainEnabled("""{"tiny_train":true,"unrelated":"value"}"""))
        for (raw in listOf("{}", """{"tiny_train":false}""", """{"tiny_train":"true"}""", """{"tiny_train":1}""", """{"tiny_train":null}""")) {
            assertFalse(raw, tinyTrainEnabled(raw))
        }
    }

    @Test fun failedOrMalformedPublicResponsesDisableTheFeature() = runBlocking {
        for ((status, body, expected) in listOf(
            Triple(200, """{"tiny_train":true}""", true),
            Triple(503, """{"tiny_train":true}""", false),
            Triple(200, "invalid JSON", false),
            Triple(200, """{"tiny_train":"true"}""", false))) {
            ServerSocket(0).use { server ->
                val request = mutableListOf<String>()
                val responder = thread {
                    server.accept().use { socket ->
                        val reader = socket.getInputStream().bufferedReader()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            request += line
                        }
                        val bytes = body.toByteArray()
                        socket.getOutputStream().write(("HTTP/1.1 $status Test\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray() + bytes)
                    }
                }
                assertEquals(expected, fetchTinyTrainFlag("http://127.0.0.1:${server.localPort}"))
                responder.join(5000)
                assertFalse(responder.isAlive)
                assertEquals("GET /api/v1/flags HTTP/1.1", request.first())
                assertFalse(request.any { it.startsWith("Authorization:", ignoreCase = true) })
                assertTrue(request.any { it.equals("Cache-Control: no-store", ignoreCase = true) })
            }
        }
    }
}
