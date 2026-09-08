package com.ilovetrains.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
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

        val result = realtime.overlay(listOf(connection(now))) { _, stop -> if (stop == "B-new") StopAssignment("9", "B") else null }.single()

        assertNull(result.estimatedDeparture)
        assertEquals(arrival, result.estimatedArrival)
        assertEquals("9", result.toPlatform)
    }

    @Test
    fun replacementCannotReuseAStaticStopMissingFromItsPattern() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        realtime.accept(snapshot(now, "replacement", """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"scheduled"}
        """), "source", now)

        assertTrue(realtime.overlay(listOf(connection(now))) { _, _ -> null }.single().cancelled)
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
        assertTrue(result.matchedLegIndices.isEmpty())
        assertNull(result.value.legs.single().estimatedDeparture)
        assertNull(result.value.legs.single().estimatedArrival)
    }

    @Test
    fun focusedPartialSourceRefreshRetainsUnmatchedObservationsUntilEveryLegIsFresh() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        val middle = Station("B", "Bravo")
        val destination = Station("C", "Charlie")
        val first = Leg(
            "T8", "train", "Bravo", from, middle, now + 10 * 60_000, now + 20 * 60_000,
            estimatedDeparture = now + 11 * 60_000,
            estimatedArrival = now + 21 * 60_000,
            fromPlatform = "21",
            toPlatform = "16",
            identity = TripIdentity("sydneytrains", "rail", "20260907", "A-stop", "B-stop", 1, 2),
        )
        val second = Leg(
            "M1", "metro", "Charlie", middle, destination, now + 24 * 60_000, now + 40 * 60_000,
            estimatedDeparture = now + 29 * 60_000,
            estimatedArrival = now + 45 * 60_000,
            fromPlatform = "9",
            toPlatform = "8",
            cancelled = true,
            identity = TripIdentity("metro", "metro-trip", "20260907", "B-stop", "C-stop", 1, 2),
        )
        val priorJourney = Journey(listOf(first, second))
        val oldGeneratedAt = now - 60_000
        val focus = FocusedJourney(
            "mixed", false, priorJourney,
            BoardData(from, destination, listOf(priorJourney), oldGeneratedAt, source = "live"),
        )
        assertTrue(realtime.accept(
            snapshot(now, "scheduled", "", source = "sydneytrains", tripId = "rail", delaySeconds = 120),
            "sydneytrains",
            now,
        ))

        val firstBaseline = OfflinePlanner.scheduledFocusBaseline(priorJourney) { _, stop ->
            mapOf("A-stop" to "1", "B-stop" to "2", "C-stop" to "3")[stop]
        }
        val firstOverlay = realtime.overlay(firstBaseline) { _, _ -> null }
        val partial = focusAfterRefresh(
            focus,
            FocusedRefresh(
                firstOverlay.value,
                firstOverlay.observedAt,
                live = false,
                matchedLegIndices = firstOverlay.matchedLegIndices,
            ),
            alternatives = null,
        )

        assertEquals(setOf(0), firstOverlay.matchedLegIndices)
        assertTrue(partial.board.offline)
        assertEquals(first.departure + 120_000, partial.journey.legs[0].estimatedDeparture)
        assertEquals(second.estimatedDeparture, partial.journey.legs[1].estimatedDeparture)
        assertEquals(second.estimatedArrival, partial.journey.legs[1].estimatedArrival)
        assertEquals("9", partial.journey.legs[1].fromPlatform)
        assertEquals("8", partial.journey.legs[1].toPlatform)
        assertTrue(partial.journey.legs[1].cancelled)
        assertTrue(partial.journey.retained)
        assertEquals(oldGeneratedAt, partial.board.generatedAt)

        assertTrue(realtime.accept(
            snapshot(now + 1_000, "scheduled", "", source = "metro", tripId = "metro-trip", delaySeconds = 180),
            "metro",
            now,
        ))
        val secondBaseline = OfflinePlanner.scheduledFocusBaseline(partial.journey) { _, stop ->
            mapOf("A-stop" to "1", "B-stop" to "2", "C-stop" to "3")[stop]
        }
        val secondOverlay = realtime.overlay(secondBaseline) { _, _ -> null }
        val restored = focusAfterRefresh(
            partial,
            FocusedRefresh(
                secondOverlay.value,
                secondOverlay.observedAt,
                live = true,
                matchedLegIndices = secondOverlay.matchedLegIndices,
            ),
            alternatives = null,
        )

        assertEquals(setOf(0, 1), secondOverlay.matchedLegIndices)
        assertEquals(second.departure + 180_000, restored.journey.legs[1].estimatedDeparture)
        assertEquals(second.arrival + 180_000, restored.journey.legs[1].estimatedArrival)
        assertEquals("2", restored.journey.legs[1].fromPlatform)
        assertEquals("3", restored.journey.legs[1].toPlatform)
        assertFalse(restored.journey.legs[1].cancelled)
        assertFalse(restored.journey.retained)
        assertFalse(restored.board.offline)
        assertEquals("live", restored.board.source)
        assertEquals(now, restored.board.generatedAt)
    }

    @Test
    fun partialObservationCannotBorrowANewerTimetableCaptureTime() {
        val realtime = OfflineRealtime()
        val now = System.currentTimeMillis()
        val observedAt = now - 20_000
        val capturedAt = now - 10_000
        val destination = Station("C", "Charlie")
        val first = Leg("T8", "train", "Bravo", from, to, now + 60_000, now + 600_000,
            identity = TripIdentity("sydneytrains", "rail", "20260907", "A-stop", "B-stop", 1, 2))
        val second = Leg("M1", "metro", "Charlie", to, destination, now + 900_000, now + 1_800_000,
            identity = TripIdentity("metro", "metro-trip", "20260907", "B-stop", "C-stop", 1, 2))
        val journey = Journey(listOf(first, second))
        val focus = FocusedJourney("scheduled", false, journey,
            BoardData(from, destination, listOf(journey), capturedAt, source = "schedule", offline = true))
        assertTrue(realtime.accept(
            snapshot(observedAt, "scheduled", "", source = "sydneytrains", tripId = "rail", delaySeconds = 120),
            "sydneytrains", now,
        ))
        val overlay = realtime.overlay(journey) { _, _ -> null }

        val partial = focusAfterRefresh(focus,
            FocusedRefresh(overlay.value, overlay.observedAt, false, overlay.matchedLegIndices), null)

        assertEquals(setOf(0), overlay.matchedLegIndices)
        assertEquals(first.departure + 120_000, partial.journey.legs[0].estimatedDeparture)
        assertEquals(observedAt, partial.board.generatedAt)
        assertTrue(partial.journey.retained)
        assertTrue(partial.board.offline)
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

        val result = realtime.overlay(listOf(connection(now))) { _, _ -> StopAssignment("4", "OTHER") }.single()

        assertTrue(result.cancelled)
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

    @Test
    fun skippedIntermediateStopKeepsThroughServiceButBlocksEndpoints() {
        val now = System.currentTimeMillis()
        val realtime = OfflineRealtime()
        realtime.accept(snapshot(now, "scheduled", """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"scheduled"},
          {"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"skipped"},
          {"stopId":"C-stop","stopSequence":3,"scheduleRelationship":"scheduled"}
        """), "source", now)
        val first = connection(now)
        val charlie = Station("C", "Charlie")
        val second = first.copy(
            fromSequence = 2, toSequence = 3,
            fromStopId = "B-stop", toStopId = "C-stop",
            fromStationId = "B", toStationId = "C", fromStation = to, toStation = charlie,
            departure = first.arrival + 60_000, arrival = first.arrival + 10 * 60_000,
        )

        val connections = realtime.overlay(listOf(first, second)) { _, _ -> null }
        val router = OfflineRouter()

        assertFalse(connections.any(ScheduledConnection::cancelled))
        assertEquals(1, router.route(from, charlie, now, connections, 4).size)
        assertTrue(router.route(from, to, now, connections, 4).isEmpty())
        assertTrue(router.route(to, charlie, now, connections, 4).isEmpty())
        assertTrue(realtime.overlay(Journey(listOf(first.asLeg))) { _, _ -> null }.value.legs.single().cancelled)
    }

    @Test
    fun rejectsOlderFutureAndInvalidRealtimeSnapshotsAndCapsExpiryAtHeaderAge() {
        val now = System.currentTimeMillis()
        val excessive = 8_640_000_000_000_001L
        val realtime = OfflineRealtime()
        assertTrue(realtime.accept(snapshot(now + 30_000, "cancelled", ""), "source", now))
        assertFalse(realtime.accept(snapshot(now, "scheduled", ""), "source", now))
        assertFalse(realtime.accept(snapshot(now - 120_000, "scheduled", "", expiresAt = now + 86_400_000), "source", now))
        assertFalse(realtime.accept(snapshot(now + 300_001, "scheduled", ""), "source", now))
        assertThrows(IllegalArgumentException::class.java) {
            realtime.accept(snapshot(now, "scheduled", "{\"stopId\":\"A-stop\",\"scheduleRelationship\":\"invalid\"}"), "source", now)
        }
        assertThrows(IllegalArgumentException::class.java) {
            realtime.accept(snapshot(now, "scheduled", "").replaceFirst(Regex("\"headerTimestamp\":\"[^\"]+\""), "\"headerTimestamp\":$excessive"), "source", now)
        }
        assertThrows(IllegalArgumentException::class.java) {
            realtime.accept(snapshot(now, "scheduled", "{\"stopId\":\"A-stop\",\"arrivalMs\":$excessive}"), "source", now)
        }
    }

    private fun snapshot(
        header: Long,
        status: String,
        stops: String,
        expiresAt: Long = header + 90_000,
        source: String = "source",
        tripId: String = "trip",
        delaySeconds: Int = 60,
    ): String {
        val stopArray = if (stops.isBlank()) "[]" else "[$stops]"
        return """{
          "schemaVersion":1,"source":"$source",
          "headerTimestamp":"${Instant.ofEpochMilli(header)}",
          "generatedAt":"${Instant.ofEpochMilli(header + 1_000)}",
          "expiresAt":"${Instant.ofEpochMilli(expiresAt)}",
          "updates":[{"tripId":"$tripId","serviceDate":"20260907","status":"$status","delaySeconds":$delaySeconds,"stopUpdates":$stopArray}]
        }"""
    }

    private fun connection(now: Long) = ScheduledConnection(
        source = "source", tripId = "trip", serviceDate = "20260907", fromSequence = 1, toSequence = 2,
        fromStopId = "A-stop", toStopId = "B-stop", fromStationId = "A", toStationId = "B",
        fromStation = from, toStation = to, departure = now + 10 * 60_000, arrival = now + 19 * 60_000,
        pickupType = 0, dropOffType = 0, fromPlatform = "1", toPlatform = "2", line = "T1", mode = "train", headsign = "Bravo",
    )

    private val ScheduledConnection.asLeg: Leg
        get() = Leg(
            line, mode, headsign, checkNotNull(fromStation), checkNotNull(toStation), departure, arrival,
            fromPlatform = fromPlatform, toPlatform = toPlatform,
            identity = TripIdentity(source, tripId, serviceDate, fromStopId, toStopId, fromSequence, toSequence),
        )
}
