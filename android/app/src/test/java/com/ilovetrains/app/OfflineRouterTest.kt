package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
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
