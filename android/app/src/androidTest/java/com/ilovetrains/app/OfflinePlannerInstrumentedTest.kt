package com.ilovetrains.app

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import java.time.LocalDateTime

@RunWith(AndroidJUnit4::class)
class OfflinePlannerInstrumentedTest {
    @Test
    fun bundledPackageRoutesTrainMetroMixedAndFerryJourneys() = runBlocking {
        val train = planner.plan(station("200060", "Central Station", "train", "metro"), station("215020", "Parramatta Station", "train"), at, setOf("train"))
        val metro = planner.plan(station("2155384", "Tallawong Station", "metro"), station("206710", "Chatswood Station", "train", "metro"), metroAt, setOf("metro"))
        val mixed = planner.plan(station("202010", "Mascot Station", "train"), station("2155382", "Kellyville Station", "metro"), metroAt, setOf("train", "metro"))
        val ferry = planner.plan(station("200020", "Circular Quay", "train", "ferry"), station("209573", "Manly Wharf", "ferry"), at, setOf("ferry"))

        println("train=${train.journeys.firstOrNull()?.legs} mixed=${mixed.journeys.firstOrNull()?.legs} ferry=${ferry.journeys.firstOrNull()?.legs}")
        assertTrue(train.journeys.isNotEmpty())
        val capturedDirect = train.journeys.first { it.departure == Instant.parse("2026-09-06T00:11:01Z").toEpochMilli() }
        assertEquals("2026-09-06T00:43:00Z", Instant.ofEpochMilli(capturedDirect.arrival).toString())
        assertEquals("T1", capturedDirect.legs.single().line)
        assertTrue(metro.journeys.isNotEmpty())
        assertTrue(mixed.journeys.any { journey -> journey.legs.map(Leg::mode).containsAll(listOf("train", "metro")) })
        mixed.journeys.forEach { journey ->
            journey.legs.zipWithNext().forEach { (first, second) ->
                val floor = if (first.mode == second.mode) 5 * 60_000L else 8 * 60_000L
                assertTrue(second.departure - first.arrival >= floor)
            }
        }
        assertTrue(ferry.journeys.isNotEmpty())
        assertTrue((train.journeys + metro.journeys + mixed.journeys + ferry.journeys).flatMap(Journey::legs).all { it.identity != null })
    }

    @Test
    fun ferryScheduleMatchesCapturedF1AndIncludesMff() = runBlocking {
        val circularQuay = station("200020", "Circular Quay", "train", "ferry")
        val manly = station("209573", "Manly Wharf", "ferry")
        val capturedAt = LocalDateTime.of(2026, 9, 5, 21, 40).atZone(Sydney).toInstant().toEpochMilli()
        val captured = planner.plan(circularQuay, manly, capturedAt, setOf("ferry"))
        val sunday = planner.plan(circularQuay, manly, at, setOf("ferry"))

        val f1 = captured.journeys.first { it.departure == Instant.parse("2026-09-05T11:50:00Z").toEpochMilli() }
        assertEquals("F1", f1.legs.single().line)
        assertEquals("2026-09-05T12:12:00Z", Instant.ofEpochMilli(f1.arrival).toString())
        assertTrue(sunday.journeys.any { it.legs.first().line == "MFF" })
    }

    @Test
    fun missingSundayMetroUsesBoundedNextServiceSearch() = runBlocking {
        val started = System.nanoTime()
        val board = planner.plan(
            station("202010", "Mascot Station", "train"),
            station("2155382", "Kellyville Station", "metro"),
            at,
            setOf("train", "metro"),
            limit = 4,
        )
        val elapsedMillis = (System.nanoTime() - started) / 1_000_000

        assertTrue("next-service search took ${elapsedMillis}ms", elapsedMillis < 12_000)
        assertTrue(board.journeys.isNotEmpty())
        assertTrue(board.journeys.all { it.departure >= at })
    }

    companion object {
        private lateinit var planner: OfflinePlanner
        private val at = LocalDateTime.of(2026, 9, 6, 10, 0).atZone(Sydney).toInstant().toEpochMilli()
        private val metroAt = LocalDateTime.of(2026, 9, 7, 10, 0).atZone(Sydney).toInstant().toEpochMilli()

        @JvmStatic
        @BeforeClass
        fun initialize() = runBlocking {
            planner = OfflinePlanner(ApplicationProvider.getApplicationContext())
            val (_, initializeMillis) = measured { planner.initialize() }
            println("offline initialization=${initializeMillis}ms")
            assertEquals("5 Sep 2026–4 Oct 2026", planner.coverageDescription)
        }

        private fun station(id: String, name: String, vararg modes: String) = Station(id, name, modes = modes.toSet())

        internal suspend fun <T> measured(block: suspend () -> T): Pair<T, Long> {
            val started = System.nanoTime()
            val result = block()
            return result to (System.nanoTime() - started) / 1_000_000
        }
    }
}
