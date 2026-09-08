import XCTest
@testable import ILoveTrains

final class OfflineRealtimeTests: XCTestCase {
    private let from = Station(id: "A", name: "Alpha")
    private let to = Station(id: "B", name: "Bravo")

    func testExactUpdateAppliesNoDataAndAssignedPlatform() throws {
        var realtime = OfflineRealtime()
        let now = 1_800_000_000_000.0
        let arrival = now + 20 * 60_000
        try realtime.accept(json: snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"noData"},
          {"stopId":"B-stop","stopSequence":2,"assignedStopId":"B-new","arrivalMs":\(arrival),"scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)

        let result = realtime.overlay([connection(now)], now: now) { _, stop in
            stop == "B-new" ? StopAssignment(platform: "9", stationId: "B") : nil
        }.first!

        XCTAssertNil(result.estimatedDeparture)
        XCTAssertEqual(result.estimatedArrival, arrival)
        XCTAssertEqual(result.toPlatform, "9")

        let journey = OfflineRouter().route(
            from: from,
            to: to,
            at: now,
            connections: [result],
            limit: 1
        ).first
        XCTAssertEqual(journey?.legs.first?.toPlatform, "9")
        XCTAssertEqual(journey?.scheduledOnly().legs.first?.fromPlatform, "1")
        XCTAssertEqual(journey?.scheduledOnly().legs.first?.toPlatform, "2")
    }

    func testScheduledDowngradeRestoresTrueNilStaticPlatform() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        try realtime.accept(json: snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"assignedStopId":"A-new","scheduleRelationship":"scheduled"},
          {"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)
        var staticConnection = connection(now)
        staticConnection.fromPlatform = nil
        staticConnection.scheduledFromPlatform = nil
        let overlaid = realtime.overlay([staticConnection], now: now) { _, stop in
            stop == "A-new" ? StopAssignment(platform: "9", stationId: "A") : nil
        }
        let journey = OfflineRouter().route(from: from, to: to, at: now, connections: overlaid, limit: 1).first

        XCTAssertEqual(journey?.legs.first?.fromPlatform, "9")
        XCTAssertNil(journey?.scheduledOnly().legs.first?.fromPlatform)
    }

    func testReplacementCancellationExpiryAndCrossHubAssignment() throws {
        let now = 1_800_000_000_000.0
        var replacement = OfflineRealtime()
        try replacement.accept(json: snapshot(now, status: "replacement", stops: """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)
        XCTAssertTrue(replacement.overlay([connection(now)], now: now) { _, _ in nil }.first!.cancelled)

        var assigned = OfflineRealtime()
        try assigned.accept(json: snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"assignedStopId":"other","scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)
        XCTAssertTrue(assigned.overlay([connection(now)], now: now) { _, _ in
            StopAssignment(platform: "4", stationId: "OTHER")
        }.first!.cancelled)

        var expired = OfflineRealtime()
        XCTAssertFalse(try expired.accept(
            json: snapshot(now - 180_000, status: "scheduled", stops: ""),
            expectedSource: "source",
            now: now
        ))
        var focused = connection(now).asLeg
        focused.estimatedDeparture = focused.departure + 60_000
        focused.estimatedArrival = focused.arrival + 60_000
        let result = expired.overlay(Journey(legs: [focused]), now: now) { _, _ in nil }
        XCTAssertFalse(result.matched)
        XCTAssertTrue(result.matchedLegIndices.isEmpty)
        XCTAssertNil(result.value.legs.first?.estimatedDeparture)
        XCTAssertNil(result.value.legs.first?.estimatedArrival)
        let planned = expired.overlay([connection(now)], now: now) { _, _ in nil }.first
        XCTAssertEqual(planned?.effectiveDeparture, connection(now).departure)
        XCTAssertFalse(planned?.cancelled ?? true)
    }

    func testFocusedPartialSourceRefreshRetainsUnmatchedObservationsUntilEveryLegIsFresh() throws {
        let now = 1_800_000_000_000.0
        let middle = Station(id: "B", name: "Bravo")
        let destination = Station(id: "C", name: "Charlie")
        var first = connection(now).asLeg
        first.line = "T8"
        first.identity = TripIdentity(
            source: "sydneytrains", tripId: "rail", serviceDate: "20260907",
            fromStopId: "A-stop", toStopId: "B-stop", fromSequence: 1, toSequence: 2
        )
        first.estimatedDeparture = first.departure + 60_000
        first.estimatedArrival = first.arrival + 120_000
        first.fromPlatform = "21"
        first.toPlatform = "16"
        let second = Leg(
            line: "M1", mode: "metro", headsign: "Charlie", from: middle, to: destination,
            departure: now + 24 * 60_000, arrival: now + 40 * 60_000,
            estimatedDeparture: now + 29 * 60_000, estimatedArrival: now + 45 * 60_000,
            fromPlatform: "9", toPlatform: "8", cancelled: true,
            identity: TripIdentity(
                source: "metro", tripId: "metro-trip", serviceDate: "20260907",
                fromStopId: "B-stop", toStopId: "C-stop", fromSequence: 1, toSequence: 2
            )
        )
        let priorJourney = Journey(legs: [first, second])
        let priorGeneratedAt = now - 30_000
        let firstObservedAt = now - 60_000
        let focus = FocusedJourney(
            tripId: "mixed", reverse: false, journey: priorJourney,
            board: BoardData(
                from: from, to: destination, journeys: [priorJourney], generatedAt: priorGeneratedAt,
                source: "live", serverStale: true
            )
        )
        var realtime = OfflineRealtime()
        try realtime.accept(
            json: snapshot(
                firstObservedAt, status: "scheduled", stops: "", source: "sydneytrains", tripId: "rail",
                delaySeconds: 120
            ),
            expectedSource: "sydneytrains",
            now: now
        )

        let firstBaseline = OfflinePlanner.scheduledFocusBaseline(priorJourney) { _, stop in
            ["A-stop": "1", "B-stop": "2", "C-stop": "3"][stop]
        }
        let firstOverlay = realtime.overlay(firstBaseline, now: now) { _, _ in nil }
        let partial = focusAfterRefresh(
            focus,
            update: FocusUpdate(
                journey: firstOverlay.value,
                observedAt: firstOverlay.observedAt,
                live: false,
                matchedLegIndices: firstOverlay.matchedLegIndices
            ),
            alternatives: nil
        )

        XCTAssertEqual(firstOverlay.matchedLegIndices, Set([0]))
        XCTAssertEqual(firstOverlay.value.legs[1].effectiveDeparture, second.departure)
        XCTAssertFalse(firstOverlay.value.legs[1].cancelled)
        XCTAssertEqual(partial.journey.legs[0].estimatedDeparture, first.departure + 120_000)
        XCTAssertEqual(partial.journey.legs[1].estimatedDeparture, second.estimatedDeparture)
        XCTAssertEqual(partial.journey.legs[1].estimatedArrival, second.estimatedArrival)
        XCTAssertEqual(partial.journey.legs[1].fromPlatform, "9")
        XCTAssertEqual(partial.journey.legs[1].toPlatform, "8")
        XCTAssertTrue(partial.journey.legs[1].cancelled)
        XCTAssertEqual(partial.journey.retained, true)
        XCTAssertTrue(partial.board.offline)
        XCTAssertEqual(partial.board.source, "live")
        XCTAssertTrue(partial.board.serverStale)
        XCTAssertEqual(partial.board.generatedAt, firstObservedAt)
        var olderPrior = focus
        olderPrior.board.generatedAt = now - 120_000
        let retainedOlderClock = focusAfterRefresh(
            olderPrior,
            update: FocusUpdate(
                journey: firstOverlay.value,
                observedAt: firstOverlay.observedAt,
                live: false,
                matchedLegIndices: firstOverlay.matchedLegIndices
            ),
            alternatives: nil
        )
        XCTAssertEqual(retainedOlderClock.board.generatedAt, now - 120_000)

        try realtime.accept(
            json: snapshot(
                now - 15_000, status: "scheduled", stops: "", source: "metro", tripId: "metro-trip",
                delaySeconds: 180
            ),
            expectedSource: "metro",
            now: now
        )
        let secondBaseline = OfflinePlanner.scheduledFocusBaseline(partial.journey) { _, stop in
            ["A-stop": "1", "B-stop": "2", "C-stop": "3"][stop]
        }
        let secondOverlay = realtime.overlay(secondBaseline, now: now) { _, _ in nil }
        let restored = focusAfterRefresh(
            partial,
            update: FocusUpdate(
                journey: secondOverlay.value,
                observedAt: secondOverlay.observedAt,
                live: secondBaseline.legs.indices.allSatisfy(secondOverlay.matchedLegIndices.contains),
                matchedLegIndices: secondOverlay.matchedLegIndices
            ),
            alternatives: nil
        )

        XCTAssertEqual(secondOverlay.matchedLegIndices, Set([0, 1]))
        XCTAssertEqual(restored.journey.legs[1].estimatedDeparture, second.departure + 180_000)
        XCTAssertEqual(restored.journey.legs[1].estimatedArrival, second.arrival + 180_000)
        XCTAssertEqual(restored.journey.legs[1].fromPlatform, "2")
        XCTAssertEqual(restored.journey.legs[1].toPlatform, "3")
        XCTAssertFalse(restored.journey.legs[1].cancelled)
        XCTAssertNotEqual(restored.journey.retained, true)
        XCTAssertFalse(restored.board.offline)
        XCTAssertEqual(restored.board.source, "live")
        XCTAssertFalse(restored.board.serverStale)
        XCTAssertEqual(restored.board.generatedAt, firstObservedAt)
    }

    func testSparseDelayCarriesButNoDataSuppressesThatStop() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        let json = snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"departureDelaySeconds":300,"scheduleRelationship":"scheduled"},
          {"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"noData"}
        """).replacingOccurrences(of: "\"delaySeconds\":60,", with: "")
        try realtime.accept(json: json, expectedSource: "source", now: now)
        let first = connection(now)
        let third = Station(id: "C", name: "Charlie")
        var second = first
        second.fromSequence = 2
        second.toSequence = 3
        second.fromStopId = "B-stop"
        second.toStopId = "C-stop"
        second.fromStationId = "B"
        second.toStationId = "C"
        second.fromStation = to
        second.toStation = third
        second.departure = first.arrival + 60_000
        second.arrival = first.arrival + 10 * 60_000

        let result = realtime.overlay([first, second], now: now) { _, _ in nil }

        XCTAssertEqual(result[0].estimatedDeparture, first.departure + 300_000)
        XCTAssertNil(result[0].estimatedArrival)
        XCTAssertNil(result[1].estimatedDeparture)
        XCTAssertEqual(result[1].estimatedArrival, second.arrival + 300_000)
    }

    func testLoopTripMatchesRepeatedStopBySequenceAndBaselineClearsLiveState() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        try realtime.accept(json: snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"departureDelaySeconds":60,"scheduleRelationship":"scheduled"},
          {"stopId":"A-stop","stopSequence":3,"arrivalDelaySeconds":300,"scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)
        var leg = Leg(
            line: "T1",
            mode: "train",
            headsign: "Alpha",
            from: from,
            to: from,
            departure: now + 10 * 60_000,
            arrival: now + 30 * 60_000,
            fromPlatform: "9",
            toPlatform: "8",
            cancelled: true,
            identity: TripIdentity(
                source: "source",
                tripId: "trip",
                serviceDate: "20260907",
                fromStopId: "A-stop",
                toStopId: "A-stop",
                fromSequence: 1,
                toSequence: 3
            )
        )
        let overlaid = realtime.overlay(Journey(legs: [leg]), now: now) { _, _ in nil }
        XCTAssertEqual(overlaid.value.legs.first?.estimatedDeparture, leg.departure + 60_000)
        XCTAssertEqual(overlaid.value.legs.first?.estimatedArrival, leg.arrival + 300_000)

        leg.estimatedDeparture = leg.departure + 60_000
        leg.estimatedArrival = leg.arrival + 300_000
        let baseline = OfflinePlanner.scheduledFocusBaseline(Journey(legs: [leg])) { _, stop in
            stop == "A-stop" ? "1" : "2"
        }
        XCTAssertNil(baseline.legs.first?.estimatedDeparture)
        XCTAssertNil(baseline.legs.first?.estimatedArrival)
        XCTAssertEqual(baseline.legs.first?.fromPlatform, "1")
        XCTAssertFalse(baseline.legs.first?.cancelled ?? true)
    }

    func testDuplicateTripIdentityAndInvalidRelationshipAreRejected() {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        let duplicate = snapshot(now, status: "scheduled", stops: "").replacingOccurrences(
            of: "]}",
            with: "]},{\"tripId\":\"trip\",\"serviceDate\":\"20260907\",\"status\":\"scheduled\",\"stopUpdates\":[]}]}",
            options: .backwards
        )
        XCTAssertThrowsError(try realtime.accept(json: duplicate, expectedSource: "source", now: now))
        XCTAssertThrowsError(try realtime.accept(
            json: snapshot(now, status: "scheduled", stops: "{\"stopId\":\"A-stop\",\"scheduleRelationship\":\"unknown\"}"),
            expectedSource: "source",
            now: now
        ))
    }

    func testOlderSnapshotCannotReplaceNewerAcceptedSourceState() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        try realtime.accept(
            json: snapshot(now + 30_000, status: "cancelled", stops: ""),
            expectedSource: "source",
            now: now
        )
        XCTAssertFalse(try realtime.accept(
            json: snapshot(now, status: "scheduled", stops: ""),
            expectedSource: "source",
            now: now
        ))
        XCTAssertTrue(realtime.overlay([connection(now)], now: now) { _, _ in nil }.first!.cancelled)
    }

    func testCapsExpiryAtHeaderAgeAndRejectsFutureHeaders() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        XCTAssertFalse(try realtime.accept(
            json: snapshot(now - 120_000, status: "scheduled", stops: "", expiresAt: now + 86_400_000),
            expectedSource: "source",
            now: now
        ))
        XCTAssertFalse(try realtime.accept(
            json: snapshot(now + 300_001, status: "scheduled", stops: ""),
            expectedSource: "source",
            now: now
        ))
        XCTAssertThrowsError(try realtime.accept(
            json: snapshot(now, status: "scheduled", stops: "", headerTimestamp: maximumTransitMillis + 1),
            expectedSource: "source",
            now: now
        ))
        XCTAssertThrowsError(try realtime.accept(
            json: snapshot(now, status: "scheduled", stops: "{\"stopId\":\"A-stop\",\"arrivalMs\":\(maximumTransitMillis + 1)}"),
            expectedSource: "source",
            now: now
        ))
    }

    func testSkippedStopBlocksBoardingAndAlightingButAllowsThroughTravel() throws {
        let now = 1_800_000_000_000.0
        var realtime = OfflineRealtime()
        try realtime.accept(json: snapshot(now, status: "scheduled", stops: """
          {"stopId":"A-stop","stopSequence":1,"scheduleRelationship":"scheduled"},
          {"stopId":"B-stop","stopSequence":2,"scheduleRelationship":"skipped"},
          {"stopId":"C-stop","stopSequence":3,"scheduleRelationship":"scheduled"}
        """), expectedSource: "source", now: now)
        let first = connection(now)
        let charlie = Station(id: "C", name: "Charlie")
        var second = first
        second.fromSequence = 2
        second.toSequence = 3
        second.fromStopId = "B-stop"
        second.toStopId = "C-stop"
        second.fromStationId = "B"
        second.toStationId = "C"
        second.fromStation = to
        second.toStation = charlie
        second.departure = first.arrival + 60_000
        second.arrival = second.departure + 10 * 60_000
        let connections = realtime.overlay([first, second], now: now) { _, _ in nil }
        let router = OfflineRouter()

        XCTAssertEqual(router.route(from: from, to: charlie, at: now, connections: connections, limit: 4).count, 1)
        XCTAssertTrue(router.route(from: from, to: to, at: now, connections: connections, limit: 4).isEmpty)
        XCTAssertTrue(router.route(from: to, to: charlie, at: now, connections: connections, limit: 4).isEmpty)
        XCTAssertTrue(realtime.overlay(Journey(legs: [first.asLeg]), now: now) { _, _ in nil }.value.legs.first!.cancelled)
    }

    private func snapshot(
        _ header: Millis,
        status: String,
        stops: String,
        expiresAt: Millis? = nil,
        headerTimestamp: Millis? = nil,
        source: String = "source",
        tripId: String = "trip",
        delaySeconds: Int = 60
    ) -> String {
        let stopArray = stops.isEmpty ? "[]" : "[\(stops)]"
        let expiry = expiresAt ?? header + 90_000
        let timestamp = headerTimestamp ?? header
        return """
        {"schemaVersion":1,"source":"\(source)","headerTimestamp":\(timestamp),"generatedAt":\(header + 1_000),"expiresAt":\(expiry),"updates":[{"tripId":"\(tripId)","serviceDate":"20260907","status":"\(status)","delaySeconds":\(delaySeconds),"stopUpdates":\(stopArray)}]}
        """
    }

    private func connection(_ now: Millis) -> ScheduledConnection {
        ScheduledConnection(
            source: "source",
            tripId: "trip",
            serviceDate: "20260907",
            fromSequence: 1,
            toSequence: 2,
            fromStopId: "A-stop",
            toStopId: "B-stop",
            fromStationId: "A",
            toStationId: "B",
            fromStation: from,
            toStation: to,
            departure: now + 10 * 60_000,
            arrival: now + 19 * 60_000,
            pickupType: 0,
            dropOffType: 0,
            fromPlatform: "1",
            toPlatform: "2",
            line: "T1",
            mode: "train",
            headsign: "Bravo"
        )
    }
}

private extension ScheduledConnection {
    var asLeg: Leg {
        Leg(
            line: line,
            mode: mode,
            headsign: headsign,
            from: fromStation!,
            to: toStation!,
            departure: departure,
            arrival: arrival,
            fromPlatform: fromPlatform,
            toPlatform: toPlatform,
            identity: TripIdentity(
                source: source,
                tripId: tripId,
                serviceDate: serviceDate,
                fromStopId: fromStopId,
                toStopId: toStopId,
                fromSequence: fromSequence,
                toSequence: toSequence
            )
        )
    }
}
