package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.CancellationException
import java.time.Instant
import java.time.LocalDate

class OfflineRouterTest {
    private val alpha = Station("A", "Alpha Station")
    private val bravo = Station("B", "Bravo Station")
    private val central = Station("C", "Central Station")

    @Test
    fun returnsDirectServicesInDepartureOrderWithExactIdentity() {
        val connections = listOf(
            connection("later", alpha, bravo, 20, 30),
            connection("first", alpha, bravo, 10, 18),
        ).sortedBy { it.departure }
        val journeys = OfflineRouter().route(alpha, bravo, 0, connections, 12)

        assertEquals(listOf(10L, 20L), journeys.map { it.departure })
        assertEquals("first", journeys.first().legs.first().identity?.tripId)
        assertEquals("A-stop", journeys.first().legs.first().identity?.fromStopId)
        assertEquals("B-stop", journeys.first().legs.first().identity?.toStopId)
    }

    @Test
    fun requiresSafeTransferAndRespectsBoardingPermissions() {
        val first = connection("one", alpha, central, 10, 20)
        val tooTight = connection("tight", central, bravo, 20 + 299_999, 500_000)
        val safe = connection("safe", central, bravo, 20 + 300_000, 500_001)
        val forbidden = connection("forbidden", alpha, bravo, 11, 19, pickupType = 1)
        val journeys = OfflineRouter().route(alpha, bravo, 0, listOf(first, forbidden, tooTight, safe).sortedBy { it.departure }, 12)

        assertEquals(1, journeys.size)
        assertEquals(listOf("one", "safe"), journeys.single().legs.map { it.identity?.tripId })
    }

    @Test
    fun crossModeTransferUsesLongerFloorAndCancelledTripsDoNotRoute() {
        val train = connection("train", alpha, central, 10, 20, mode = "train")
        val shortMetro = connection("short", central, bravo, 20 + 7 * 60_000, 600_000, mode = "metro")
        val safeMetro = connection("safe", central, bravo, 20 + 8 * 60_000, 600_001, mode = "metro")
        val cancelled = connection("cancelled", alpha, bravo, 12, 22, cancelled = true)
        val journeys = OfflineRouter().route(alpha, bravo, 0, listOf(train, cancelled, shortMetro, safeMetro).sortedBy { it.departure }, 12)

        assertEquals(1, journeys.size)
        assertEquals("safe", journeys.single().legs.last().identity?.tripId)
        assertTrue(journeys.none { it.legs.any(Leg::cancelled) })
    }

    @Test
    fun dropsLongWaitOnlyWhenALaterServiceArrivesBeforeTheWaitEnds() {
        val first = connection("first", alpha, central, 10, 20)
        val later = connection("later", alpha, bravo, 30 * 60_000, 60 * 60_000)
        val longConnection = connection("connection", central, bravo, 2 * 60 * 60_000, 130 * 60_000)

        val withAlternative = OfflineRouter().route(alpha, bravo, 0, listOf(first, later, longConnection), 12)
        val lastOfNight = OfflineRouter().route(alpha, bravo, 0, listOf(first, longConnection), 12)

        assertEquals(listOf("later"), withAlternative.map { it.legs.first().identity?.tripId })
        assertEquals(listOf("first", "connection"), lastOfNight.single().legs.map { it.identity?.tripId })
    }

    @Test
    fun keepsLaterLowerTransferArrivalWhenEarlierPathCannotContinue() {
        val p = Station("P", "Papa")
        val q = Station("Q", "Quebec")
        val x = Station("X", "Xray")
        val connections = listOf(
            connection("early-1", alpha, p, 0, 60_000),
            connection("late-1", alpha, q, 1, 60_001),
            connection("early-2", p, q, 6 * 60_000, 7 * 60_000),
            connection("late-2", q, x, 6 * 60_000 + 1, 14 * 60_000),
            connection("early-3", q, x, 12 * 60_000, 13 * 60_000),
            connection("finish", x, bravo, 19 * 60_000, 20 * 60_000),
        ).sortedBy(ScheduledConnection::departure)

        val journey = OfflineRouter().route(alpha, bravo, 0, connections, 12).single()

        assertEquals("late-1", journey.legs.first().identity?.tripId)
        assertEquals("finish", journey.legs.last().identity?.tripId)
    }

    @Test
    fun incomingModeIsPartOfStationDominanceState() {
        val p = Station("P", "Papa")
        val x = Station("X", "Xray")
        val connections = listOf(
            connection("seed", alpha, p, 0, 60_000, fromSequence = 1, toSequence = 2),
            connection("seed", p, x, 2 * 60_000, 10 * 60_000, fromSequence = 2, toSequence = 3),
            connection("metro-in", p, x, 9 * 60_000, 11 * 60_000, mode = "metro"),
            connection("metro-out", x, bravo, 16 * 60_000, 20 * 60_000, mode = "metro"),
        )

        val journey = OfflineRouter().route(alpha, bravo, 0, connections, 12).single()

        assertEquals(listOf("seed", "metro-in", "metro-out"), journey.legs.map { it.identity?.tripId })
    }

    @Test
    fun threeChangeRouteAppearsOnlyWhenTheCallerRaisesTheTransferBound() {
        val delta = Station("D", "Delta Station")
        val echo = Station("E", "Echo Station")
        val minute = 60_000L
        val chain = listOf(
            connection("one", alpha, central, 0, 10 * minute),
            connection("two", central, delta, 16 * minute, 26 * minute),
            connection("three", delta, echo, 32 * minute, 42 * minute),
            connection("four", echo, bravo, 48 * minute, 58 * minute),
        )

        assertTrue(OfflineRouter().route(alpha, bravo, 0, chain, 12).isEmpty())
        assertTrue(OfflineRouter().route(alpha, bravo, 0, chain, 12, maxTransfers = 2).isEmpty())

        val uncapped = OfflineRouter().route(alpha, bravo, 0, chain, 12, maxTransfers = 4).single()
        assertEquals(listOf("one", "two", "three", "four"), uncapped.legs.map { it.identity?.tripId })
        assertEquals(4, uncapped.legs.size)
    }

    @Test
    fun recommendationKeepsSameSeedAlternativeUntilLongWaitsAreResolved() {
        val x = Station("X", "Xray")
        val y = Station("Y", "Yankee")
        val z = Station("Z", "Zulu")
        val q = Station("Q", "Quebec")
        val minute = 60_000L
        val connections = listOf(
            connection("seed", alpha, central, 0, 5 * minute, fromSequence = 1, toSequence = 2),
            connection("later-1", alpha, x, 6 * minute, 12 * minute),
            connection("later-2", x, y, 18 * minute, 24 * minute),
            connection("later-3", y, z, 30 * minute, 36 * minute),
            connection("later-4", z, q, 42 * minute, 48 * minute),
            connection("later-5", q, bravo, 54 * minute, 69 * minute),
            connection("wait", central, bravo, 70 * minute, 75 * minute),
            connection("seed", central, bravo, 80 * minute, 85 * minute, fromSequence = 2, toSequence = 3),
        ).sortedBy(ScheduledConnection::departure)

        val recommendation = requireNotNull(OfflineRouter().recommend(alpha, bravo, 0, connections, maxTransfers = 4))

        assertEquals(listOf("seed"), recommendation.legs.map { it.identity?.tripId })
        assertEquals(85 * minute, recommendation.effectiveArrival)
    }

    @Test
    fun visitedStationsRemainPartOfWeightedContinuationState() {
        val p = Station("P", "Papa")
        val x = Station("X", "Xray")
        val y = Station("Y", "Yankee")
        val minute = 60_000L
        val connections = listOf(
            connection("seed", alpha, p, 0, minute),
            connection("early", p, y, 6 * minute, 10 * minute, fromSequence = 1, toSequence = 2),
            connection("later", p, x, 6 * minute, 21 * minute),
            connection("early", y, x, 11 * minute, 20 * minute, fromSequence = 2, toSequence = 3),
            connection("finish", x, y, 26 * minute, 30 * minute, fromSequence = 1, toSequence = 2),
            connection("finish", y, bravo, 31 * minute, 40 * minute, fromSequence = 2, toSequence = 3),
        ).sortedBy(ScheduledConnection::departure)

        val recommendation = requireNotNull(OfflineRouter().recommend(alpha, bravo, 0, connections))

        assertEquals(listOf("seed", "later", "finish"), recommendation.legs.map { it.identity?.tripId })
    }

    @Test
    fun invalidOriginServicesDoNotConsumeTheWeightedSeedBudget() {
        val invalid = (0 until 72).map { index ->
            connection("invalid-$index", alpha, bravo, index.toLong(), index - 1L)
        }
        val valid = connection("valid", alpha, bravo, 100, 200)

        val recommendation = requireNotNull(OfflineRouter().recommend(alpha, bravo, 0, invalid + valid))

        assertEquals("valid", recommendation.legs.single().identity?.tripId)
    }

    @Test(expected = CancellationException::class)
    fun weightedScanChecksCancellationInsideALongSeed() {
        val x = Station("X", "Xray")
        val seed = connection("seed", alpha, x, 0, 1)
        val irrelevant = (1..300).map { index -> connection("other-$index", central, bravo,
            index.toLong() * 1_000, index.toLong() * 1_000 + 100) }
        var polls = 0

        OfflineRouter().recommend(alpha, bravo, 0, listOf(seed) + irrelevant, cancelled = { ++polls >= 2 })
    }

    @Test
    fun gtfsCivilTimesHandleSpringDstAndAfterMidnightService() {
        assertEquals(
            Instant.parse("2026-10-03T16:30:00Z").toEpochMilli(),
            OfflinePlanner.gtfsEpochMillis(LocalDate.of(2026, 10, 4), 3 * 3600 + 30 * 60),
        )
        assertEquals(
            Instant.parse("2026-10-03T15:10:00Z").toEpochMilli(),
            OfflinePlanner.gtfsEpochMillis(LocalDate.of(2026, 10, 3), 25 * 3600 + 10 * 60),
        )
    }

    @Test fun unconditionalWinnerBoundsLateSeedWork() {
        val first = connection("winner", alpha, bravo, 0, 60_000)
        val irrelevant = (1..1000).map { connection("late-$it", alpha, bravo, it * 120_000L, it * 120_000L + 60_000) }
        var polls = 0
        val winner = OfflineRouter().recommend(alpha, bravo, 0, listOf(first) + irrelevant, cancelled = { polls++; false })
        assertEquals("winner", winner?.legs?.single()?.identity?.tripId)
        // Reachability and compact identifiers index connections and trips before the bounded seed scan.
        val graphPolls = 3 * ((irrelevant.size + 1 + 255) / 256)
        assertTrue("scanned seeds beyond a proven winner", polls <= graphPolls + 3)
    }

    @Test fun visitedStationsStayDistinctAcrossBitsetWords() {
        val stops = listOf(alpha) + (0 until 70).map { Station("stop-$it", "Stop $it") }
        val extra = Station("extra", "Extra")
        val minute = 60_000L
        val chain = stops.zipWithNext().mapIndexed { index, (from, to) ->
            connection("seed", from, to, index * minute, (index + 1) * minute,
                fromSequence = index + 1, toSequence = index + 2).copy(dropOffType = if (index == 69) 0 else 1)
        }
        val connections = chain + listOf(
            connection("loop", stops.last(), stops[1], 76 * minute, 77 * minute, fromSequence = 1, toSequence = 2),
            connection("loop", stops[1], bravo, 78 * minute, 79 * minute, fromSequence = 2, toSequence = 3),
            connection("valid", stops.last(), extra, 80 * minute, 81 * minute, fromSequence = 1, toSequence = 2),
            connection("valid", extra, bravo, 82 * minute, 83 * minute, fromSequence = 2, toSequence = 3),
        )
        val winner = requireNotNull(OfflineRouter().recommend(alpha, bravo, 0, connections))
        assertEquals(listOf("seed", "valid"), winner.legs.map { it.identity?.tripId })
    }

    private fun connection(
        trip: String,
        from: Station,
        to: Station,
        departure: Long,
        arrival: Long,
        pickupType: Int = 0,
        mode: String = "train",
        cancelled: Boolean = false,
        fromSequence: Int = 1,
        toSequence: Int = 2,
    ) = ScheduledConnection(
        source = "source",
        tripId = trip,
        serviceDate = "20260906",
        fromSequence = fromSequence,
        toSequence = toSequence,
        fromStopId = "${from.id}-stop",
        toStopId = "${to.id}-stop",
        fromStationId = from.id,
        toStationId = to.id,
        fromStation = from,
        toStation = to,
        departure = departure,
        arrival = arrival,
        pickupType = pickupType,
        dropOffType = 0,
        fromPlatform = "1",
        toPlatform = "2",
        line = "T1",
        mode = mode,
        headsign = to.name,
        cancelled = cancelled,
    )
}
