package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class OfflineRealtimeTest {
    private val from = Station("A", "Alpha")
    private val to = Station("B", "Bravo")

    @Test
    fun exactUpdateAppliesNoDataArrivalAndAssignedPlatform() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        val arrival = now + 20 * 60_000
        realtime.accept(snapshot(now, "scheduled", """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"noData"},
          {"stopId":"B-stop","stopSequence":2,"assignedStopId":"B-new","arrivalMs":$arrival,"scheduleRelationship":"scheduled"}
        """), "source", now)

        val result = realtime.overlay(connection(now)) { _, stop -> if (stop == "B-new") StopAssignment("9", "B") else null }

        assertTrue(result.matched)
        assertNull(result.value.estimatedDeparture)
        assertEquals(arrival, result.value.estimatedArrival)
        assertEquals("9", result.value.toPlatform)
    }

    @Test
    fun replacementCannotReuseAStaticStopMissingFromItsPattern() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        realtime.accept(snapshot(now, "replacement", """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"scheduled"}
        """), "source", now)

        assertTrue(realtime.overlay(connection(now)) { _, _ -> null }.value.cancelled)
    }

    @Test
    fun expiredOrMissingExactUpdateClearsFocusedEstimates() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        assertFalse(realtime.accept(snapshot(now - 180_000, "scheduled", ""), "source", now))
        val scheduled = connection(now)
        val leg = Leg("T1", "train", "Bravo", from, to, scheduled.departure, scheduled.arrival,
            estimatedDeparture = scheduled.departure + 60_000, estimatedArrival = scheduled.arrival + 60_000,
            identity = TripIdentity("source", "trip", "20260907", "A-stop", "B-stop"))

        val result = realtime.overlay(Journey(listOf(leg))) { _, _ -> null }

        assertFalse(result.matched)
        assertNull(result.value.legs.single().estimatedDeparture)
        assertNull(result.value.legs.single().estimatedArrival)
    }

    @Test
    fun sparseDelayCarriesAcrossFollowingStopsAndNoDataSuppressesItsStop() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        val json = snapshot(now, "scheduled", """
          {"stopId":"A-stop","stopSequence":1,"departureDelaySeconds":300,"scheduleRelationship":"scheduled"},
          {"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"noData"}
        """).replace("\"delaySeconds\":60,", "")
        realtime.accept(json, "source", now)
        val first = connection(now)
        val third = Station("C", "Charlie")
        val second = first.copy(
            fromSequence = 2, toSequence = 3,
            fromStopId = "B-stop", toStopId = "C-stop",
            fromStationId = "B", toStationId = "C", fromStation = to, toStation = third,
            departure = first.arrival + 60_000, arrival = first.arrival + 10 * 60_000,
        )

        val overlaid = realtime.overlay(listOf(first, second)) { _, _ -> null }

        assertEquals(first.departure + 300_000, overlaid[0].estimatedDeparture)
        assertNull(overlaid[0].estimatedArrival)
        assertNull(overlaid[1].estimatedDeparture)
        assertEquals(second.arrival + 300_000, overlaid[1].estimatedArrival)
    }

    @Test
    fun crossHubStopAssignmentInvalidatesStaticConnection() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        realtime.accept(snapshot(now, "scheduled", """
          {"stopId":"A-stop","stopSequence":1,"assignedStopId":"other","scheduleRelationship":"scheduled"}
        """), "source", now)

        val result = realtime.overlay(connection(now)) { _, _ -> StopAssignment("4", "OTHER") }

        assertTrue(result.value.cancelled)
    }

    @Test
    fun focusedLoopTripMatchesRepeatedStopBySequence() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        realtime.accept(snapshot(now, "scheduled", """
          {"stopId":"A-stop","stopSequence":1,"departureDelaySeconds":60,"scheduleRelationship":"scheduled"},
          {"stopId":"A-stop","stopSequence":3,"arrivalDelaySeconds":300,"scheduleRelationship":"scheduled"}
        """), "source", now)
        val leg = Leg(
            "T1", "train", "Alpha", from, from, now + 10 * 60_000, now + 30 * 60_000,
            identity = TripIdentity("source", "trip", "20260907", "A-stop", "A-stop", 1, 3),
        )

        val result = realtime.overlay(Journey(listOf(leg))) { _, _ -> null }

        assertEquals(leg.departure + 60_000, result.value.legs.single().estimatedDeparture)
        assertEquals(leg.arrival + 300_000, result.value.legs.single().estimatedArrival)
    }

    @Test
    fun scheduledFocusBaselineClearsExpiredAssignmentAndEstimates() {
        val leg = Leg(
            "T1", "train", "Bravo", from, to, 10, 20,
            estimatedDeparture = 11, estimatedArrival = 21, fromPlatform = "9", toPlatform = "8", cancelled = true,
            identity = TripIdentity("source", "trip", "20260907", "A-stop", "B-stop", 1, 2),
        )

        val result = OfflinePlanner.scheduledFocusBaseline(Journey(listOf(leg))) { _, stop -> if (stop == "A-stop") "1" else "2" }

        assertNull(result.legs.single().estimatedDeparture)
        assertNull(result.legs.single().estimatedArrival)
        assertEquals("1", result.legs.single().fromPlatform)
        assertEquals("2", result.legs.single().toPlatform)
        assertFalse(result.legs.single().cancelled)
    }

    private fun snapshot(header: Long, status: String, stops: String): String {
        val stopArray = if (stops.isBlank()) "[]" else "[$stops]"
        return """{
          "schemaVersion":1,"source":"source",
          "headerTimestamp":"${Instant.ofEpochMilli(header)}",
          "generatedAt":"${Instant.ofEpochMilli(header + 1_000)}",
          "expiresAt":"${Instant.ofEpochMilli(header + 90_000)}",
          "updates":[{"tripId":"trip","serviceDate":"20260907","status":"$status","delaySeconds":60,"stopUpdates":$stopArray}]
        }"""
    }

    private fun connection(now: Long) = ScheduledConnection(
        source = "source", tripId = "trip", serviceDate = "20260907", fromSequence = 1, toSequence = 2,
        fromStopId = "A-stop", toStopId = "B-stop", fromStationId = "A", toStationId = "B",
        fromStation = from, toStation = to, departure = now + 10 * 60_000, arrival = now + 19 * 60_000,
        pickupType = 0, dropOffType = 0, fromPlatform = "1", toPlatform = "2", line = "T1", mode = "train", headsign = "Bravo",
    )
}
