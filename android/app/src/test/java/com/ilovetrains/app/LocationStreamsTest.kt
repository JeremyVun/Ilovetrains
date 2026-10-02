package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationStreamsTest {
    private class FakeSource : LocationSource {
        val enabled = mutableSetOf(FixProvider.Gps, FixProvider.Network)
        val listening = linkedMapOf<FixListener, MutableList<Pair<FixProvider, Long>>>()
        private val timers = mutableListOf<Pair<Long, () -> Unit>>()
        var clock = 0L
        var wall = 1_788_645_600_000L

        override fun enabled(provider: FixProvider) = provider in enabled
        override fun request(provider: FixProvider, intervalMillis: Long, listener: FixListener): Boolean {
            listening.getOrPut(listener) { mutableListOf() } += provider to intervalMillis
            return true
        }
        override fun remove(listener: FixListener) { listening.remove(listener) }
        override fun after(delayMillis: Long, action: () -> Unit): () -> Unit {
            val timer = clock + delayMillis to action
            timers += timer
            return { timers.remove(timer) }
        }
        override fun now() = wall
        override fun elapsed() = clock

        fun advance(millis: Long) {
            clock += millis; wall += millis
            timers.filter { it.first <= clock }.forEach { timers.remove(it); it.second() }
        }
        fun deliver(provider: FixProvider, fix: Fix = fix()) {
            listening.filterValues { registrations -> registrations.any { it.first == provider } }.keys.toList()
                .forEach { it.fix(provider, fix) }
        }
        fun disable(provider: FixProvider) {
            enabled -= provider
            listening.filterValues { registrations -> registrations.any { it.first == provider } }.keys.toList()
                .forEach { it.disabled(provider) }
        }
        fun fix(accuracy: Double? = 10.0, bearing: Double? = null) = Fix(-33.87, 151.2, wall, 12.0, accuracy, bearing)
    }

    @Test fun theFusedProviderIsTheOnlyStreamWhenItIsEnabled() {
        assertEquals(listOf(FixProvider.Fused), fixProviders { true })
        assertEquals(listOf(FixProvider.Gps, FixProvider.Network), fixProviders { it != FixProvider.Fused })
        assertEquals(listOf(FixProvider.Network), fixProviders { it == FixProvider.Network })
        assertEquals(emptyList<FixProvider>(), fixProviders { false })
    }

    @Test fun aNetworkFixIsUsedOnlyWhenNoGpsFixArrivedInTheLastTwentySeconds() {
        val gate = NetworkFixGate()
        assertTrue("network may lead before any GPS fix", gate.accept(FixProvider.Network, 0))
        assertTrue(gate.accept(FixProvider.Gps, 1_000))
        assertFalse(gate.accept(FixProvider.Network, 20_999))
        assertTrue(gate.accept(FixProvider.Network, 21_000))
        assertTrue(gate.accept(FixProvider.Gps, 25_000))
        assertFalse(gate.accept(FixProvider.Network, 30_000))
        assertTrue(gate.accept(FixProvider.Fused, 30_000))
    }

    @Test fun arrivalMonitoringIsOneStreamWithNetworkOnlyFillingGpsSilences() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        val samples = mutableListOf<Long>()
        assertTrue(streams.startArrival({ true }, { samples += source.clock }, {}))
        assertEquals(listOf(FixProvider.Gps to ArrivalFixIntervalMillis, FixProvider.Network to ArrivalFixIntervalMillis),
            source.listening.values.single())

        source.deliver(FixProvider.Gps)
        source.advance(10_000); source.deliver(FixProvider.Network)
        source.advance(10_000); source.deliver(FixProvider.Network)
        source.advance(5_000); source.deliver(FixProvider.Gps)
        assertEquals(listOf(0L, 20_000L, 25_000L), samples)
    }

    @Test fun arrivalMonitoringUsesTheFusedProviderAloneWhenItCan() {
        val source = FakeSource().apply { enabled += FixProvider.Fused }
        val streams = LocationStreams(source)
        val bearings = mutableListOf<Double?>()
        assertTrue(streams.startArrival({ true }, { bearings += it.bearing }, {}))
        assertEquals(listOf(FixProvider.Fused to ArrivalFixIntervalMillis), source.listening.values.single())
        source.deliver(FixProvider.Fused, source.fix(bearing = 271.5))
        assertEquals(listOf<Double?>(271.5), bearings)
    }

    @Test fun cancellingTheSetupLookupLeavesArrivalMonitoringRunning() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        val samples = mutableListOf<Fix>()
        assertTrue(streams.startArrival({ true }, { samples += it }, {}))
        var lookup: Fix? = null
        assertTrue(streams.single(SingleFix.Lookup) { lookup = it })
        assertEquals(2, source.listening.size)

        streams.cancel(SingleFix.Lookup)
        assertFalse(streams.locating(SingleFix.Lookup))
        assertTrue(streams.monitoring)
        assertEquals(1, source.listening.size)
        source.deliver(FixProvider.Gps)
        assertEquals(1, samples.size)
        assertNull(lookup)
    }

    @Test fun repeatedHomeFixesNeverDisturbArrivalMonitoring() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        var samples = 0
        assertTrue(streams.startArrival({ true }, { samples++ }, {}))
        val homeFixes = mutableListOf<Fix?>()
        repeat(2) {
            assertTrue(streams.single(SingleFix.Home) { homeFixes += it })
            assertTrue("a running Home fix is left to finish", streams.single(SingleFix.Home) { homeFixes += it })
            source.deliver(FixProvider.Gps)
            assertFalse(streams.locating(SingleFix.Home))
            assertTrue(streams.monitoring)
        }
        assertEquals(2, homeFixes.filterNotNull().size)
        assertEquals(2, samples)
        assertEquals(1, source.listening.size)
    }

    @Test fun aSingleFixKeepsTheBestAnswerAndGivesUpAfterFifteenSeconds() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        val answers = mutableListOf<Fix?>()
        streams.single(SingleFix.Home) { answers += it }
        source.deliver(FixProvider.Network, source.fix(accuracy = 900.0))
        source.deliver(FixProvider.Network, source.fix(accuracy = 1_500.0))
        source.advance(2_000)
        assertEquals(listOf(900.0), answers.map { it?.accuracyMetres })

        streams.single(SingleFix.Lookup) { answers += it }
        source.advance(15_000)
        assertEquals(null, answers.last())
        assertTrue(source.listening.isEmpty())
    }

    @Test fun monitoringIsLostOnlyWhenEveryProviderItUsesIsDisabled() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        var lost = 0
        streams.startArrival({ true }, {}, { lost++ })
        source.disable(FixProvider.Gps)
        assertEquals(0, lost)
        assertTrue(streams.monitoring)
        source.disable(FixProvider.Network)
        assertEquals(1, lost)
        assertFalse(streams.monitoring)
        assertTrue(source.listening.isEmpty())
        assertFalse(streams.startArrival({ true }, {}, {}))
    }

    @Test fun aDeclinedStartSubscribesNothing() {
        val source = FakeSource()
        val streams = LocationStreams(source)
        assertFalse(streams.startArrival({ false }, {}, {}))
        assertFalse(streams.monitoring)
        assertTrue(source.listening.isEmpty())
    }
}
