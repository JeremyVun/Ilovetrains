package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class TransitApiTest {
    @Test fun responseReaderAcceptsTheLimitAndRejectsTheNextByte() {
        assertEquals("1234", readLimited(ByteArrayInputStream("1234".toByteArray()), 4))
        assertTrue(runCatching { readLimited(ByteArrayInputStream("12345".toByteArray()), 4) }.isFailure)
    }

    @Test fun baseUrlHasOnePathSeparator() {
        assertEquals("https://example.test", TransitApi("https://example.test/").baseUrl)
    }
}
