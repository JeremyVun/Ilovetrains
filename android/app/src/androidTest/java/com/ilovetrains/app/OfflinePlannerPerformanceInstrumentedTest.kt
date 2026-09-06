package com.ilovetrains.app

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.time.LocalDateTime

@RunWith(AndroidJUnit4::class)
class OfflinePlannerPerformanceInstrumentedTest {
    @Test
    fun coldWarmNewPairAndDefaultBoardStayResponsive() = runBlocking {
        val planner = OfflinePlanner(ApplicationProvider.getApplicationContext())
        val (_, initializeMillis) = measured { planner.initialize() }
        val from = station("202010", "Mascot Station", "train")
        val to = station("2155382", "Kellyville Station", "metro")
        val (mixed, coldMillis) = measured { planner.plan(from, to, at, setOf("train", "metro"), limit = 4) }
        val (_, warmMillis) = measured { planner.plan(from, to, at, setOf("train", "metro"), limit = 4) }
        val (_, newRouteMillis) = measured {
            planner.plan(station("200060", "Central Station", "train", "metro"), to, at, setOf("train", "metro"), limit = 4)
        }
        val (defaultBoard, defaultBoardMillis) = measured {
            planner.plan(
                station("200060", "Central Station", "train", "metro"),
                station("215020", "Parramatta Station", "train"),
                at,
                setOf("train"),
                limit = 24,
            )
        }
        val trainOnly = planner.plan(from, to, at, setOf("train"), limit = 4)

        println("offline initialization=${initializeMillis}ms planning cold=${coldMillis}ms warm=${warmMillis}ms new=${newRouteMillis}ms default24=${defaultBoardMillis}ms")
        assertTrue("cold route took ${coldMillis}ms", coldMillis < 5_000)
        assertTrue("warm route took ${warmMillis}ms", warmMillis < 3_000)
        assertTrue("new route took ${newRouteMillis}ms", newRouteMillis < 3_000)
        assertTrue("default board took ${defaultBoardMillis}ms", defaultBoardMillis < 3_000)
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
        private val at = LocalDateTime.of(2026, 9, 7, 10, 0).atZone(Sydney).toInstant().toEpochMilli()
    }
}
