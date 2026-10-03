package com.ilovetrains.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.LocalDateTime
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class OfflinePlannerPerformanceInstrumentedTest {
    @Test
    fun coldWarmNewPairAndDefaultBoardStayResponsive() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val directory = File(context.cacheDir, "offline-performance-${UUID.randomUUID()}")
        try { measure(OfflinePlanner(context, directory)) } finally { directory.deleteRecursively() }
    }

    private suspend fun measure(planner: OfflinePlanner) {
        val (_, initializeMillis) = measured { planner.initialize() }
        val from = station("202010", "Mascot Station", "train")
        val to = station("2155382", "Kellyville Station", "metro")
        val central = station("200060", "Central Station", "train", "metro")
        val parramatta = station("215020", "Parramatta Station", "train")
        val (mixed, coldMillis) = measured { planner.plan(from, to, at, setOf("train", "metro"), limit = 4) }
        val (_, warmMillis) = measured { planner.plan(from, to, at, setOf("train", "metro"), limit = 4) }
        val (_, newRouteMillis) = measured { planner.plan(central, to, at, setOf("train", "metro"), limit = 4) }
        val (defaultBoard, defaultBoardMillis) = measured { planner.plan(central, parramatta, at, setOf("train"), limit = 24) }
        val (refreshedBoard, refreshMillis) = measured { planner.planBoard(central, parramatta, at, setOf("train"), maxTransfers = 2) }
        val trainOnly = planner.plan(from, to, at, setOf("train"), limit = 4)

        println("offline initialization=${initializeMillis}ms planning cold=${coldMillis}ms warm=${warmMillis}ms new=${newRouteMillis}ms default24=${defaultBoardMillis}ms refresh=${refreshMillis}ms")
        assertTrue("cold route took ${coldMillis}ms", coldMillis < 5_000)
        assertTrue("warm route took ${warmMillis}ms", warmMillis < 3_000)
        assertTrue("new route took ${newRouteMillis}ms", newRouteMillis < 3_000)
        assertTrue("default board took ${defaultBoardMillis}ms", defaultBoardMillis < 3_000)
        assertTrue("a board refresh's two plans took ${refreshMillis}ms", refreshMillis < 3_000)
        assertTrue(refreshedBoard.journeys.any { it.effectiveDeparture >= at })
        assertTrue(mixed.journeys.isNotEmpty())
        assertTrue(mixed.journeys.size <= 4)
        assertTrue(defaultBoard.journeys.size <= 24)
        assertEquals(emptyList<Journey>(), trainOnly.journeys)
    }

    private suspend fun <T> measured(block: suspend () -> T): Pair<T, Long> {
        val started = System.nanoTime()
        val result = block()
        return result to (System.nanoTime() - started) / 1_000_000
    }

    private fun station(id: String, name: String, vararg modes: String) = Station(id, name, modes = modes.toSet())

    companion object {
        private val at = LocalDateTime.of(2026, 10, 26, 10, 0).atZone(Sydney).toInstant().toEpochMilli()
    }
}
