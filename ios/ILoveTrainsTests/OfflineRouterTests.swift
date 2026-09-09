import XCTest
@testable import ILoveTrains

final class OfflineRouterTests: XCTestCase {
    private let alpha = Station(id: "A", name: "Alpha Station")
    private let bravo = Station(id: "B", name: "Bravo Station")
    private let central = Station(id: "C", name: "Central Station")

    func testDirectServicesPreserveDepartureOrderAndExactIdentity() {
        let connections = [
            connection("later", from: alpha, to: bravo, departure: 20, arrival: 30),
            connection("first", from: alpha, to: bravo, departure: 10, arrival: 18)
        ].sorted { $0.departure < $1.departure }

        let journeys = OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: connections, limit: 12)

        XCTAssertEqual(journeys.map(\.departure), [10, 20])
        XCTAssertEqual(journeys.first?.legs.first?.identity?.tripId, "first")
        XCTAssertEqual(journeys.first?.legs.first?.identity?.fromStopId, "A-stop")
        XCTAssertEqual(journeys.first?.legs.first?.identity?.toStopId, "B-stop")
    }

    func testSafeTransferBoardingPermissionsAndCancellation() {
        let first = connection("one", from: alpha, to: central, departure: 10, arrival: 20)
        let tooTight = connection("tight", from: central, to: bravo, departure: 20 + 299_999, arrival: 500_000)
        let safe = connection("safe", from: central, to: bravo, departure: 20 + 300_000, arrival: 500_001)
        let forbidden = connection("forbidden", from: alpha, to: bravo, departure: 11, arrival: 19, pickupType: 1)
        let cancelled = connection("cancelled", from: alpha, to: bravo, departure: 12, arrival: 22, cancelled: true)
        let values = [first, forbidden, cancelled, tooTight, safe].sorted { $0.departure < $1.departure }

        let journeys = OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: values, limit: 12)

        XCTAssertEqual(journeys.count, 1)
        XCTAssertEqual(journeys.first?.legs.compactMap { $0.identity?.tripId }, ["one", "safe"])
        XCTAssertFalse(journeys.contains { $0.cancelled })
    }

    func testCrossModeAndCircularQuayTransferFloors() {
        let train = connection("train", from: alpha, to: central, departure: 10, arrival: 20, mode: "train")
        let shortMetro = connection("short", from: central, to: bravo, departure: 20 + 7 * 60_000, arrival: 600_000, mode: "metro")
        let safeMetro = connection("safe", from: central, to: bravo, departure: 20 + 8 * 60_000, arrival: 600_001, mode: "metro")
        var values = [train, shortMetro, safeMetro].sorted { $0.departure < $1.departure }
        XCTAssertEqual(
            OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: values, limit: 12).first?.legs.last?.identity?.tripId,
            "safe"
        )

        let quay = Station(id: "200020", name: "Circular Quay", modes: ["train", "ferry"])
        let rail = connection("rail", from: alpha, to: quay, departure: 10, arrival: 20, mode: "train")
        let shortFerry = connection("short-ferry", from: quay, to: bravo, departure: 20 + 9 * 60_000, arrival: 700_000, mode: "ferry")
        let safeFerry = connection("safe-ferry", from: quay, to: bravo, departure: 20 + 10 * 60_000, arrival: 700_001, mode: "ferry")
        values = [rail, shortFerry, safeFerry].sorted { $0.departure < $1.departure }
        XCTAssertEqual(
            OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: values, limit: 12).first?.legs.last?.identity?.tripId,
            "safe-ferry"
        )
    }

    func testConditionalLongWaitDominanceAndIncomingModeState() {
        let first = connection("first", from: alpha, to: central, departure: 10, arrival: 20)
        let later = connection("later", from: alpha, to: bravo, departure: 30 * 60_000, arrival: 60 * 60_000)
        let longConnection = connection("connection", from: central, to: bravo, departure: 2 * 60 * 60_000, arrival: 130 * 60_000)
        let router = OfflineRouter()
        XCTAssertEqual(
            router.route(from: alpha, to: bravo, at: 0, connections: [first, later, longConnection], limit: 12)
                .compactMap { $0.legs.first?.identity?.tripId },
            ["later"]
        )
        XCTAssertEqual(
            router.route(from: alpha, to: bravo, at: 0, connections: [first, longConnection], limit: 12)
                .first?.legs.compactMap { $0.identity?.tripId },
            ["first", "connection"]
        )

        let papa = Station(id: "P", name: "Papa")
        let xray = Station(id: "X", name: "Xray")
        let stateConnections = [
            connection("seed", from: alpha, to: papa, departure: 0, arrival: 60_000, fromSequence: 1, toSequence: 2),
            connection("seed", from: papa, to: xray, departure: 2 * 60_000, arrival: 10 * 60_000, fromSequence: 2, toSequence: 3),
            connection("metro-in", from: papa, to: xray, departure: 9 * 60_000, arrival: 11 * 60_000, mode: "metro"),
            connection("metro-out", from: xray, to: bravo, departure: 16 * 60_000, arrival: 20 * 60_000, mode: "metro")
        ]
        XCTAssertEqual(
            router.route(from: alpha, to: bravo, at: 0, connections: stateConnections, limit: 12)
                .first?.legs.compactMap { $0.identity?.tripId },
            ["seed", "metro-in", "metro-out"]
        )
    }

    func testThreeChangeRouteAppearsOnlyWhenTheTransferBoundIsRaised() {
        let first = Station(id: "C1", name: "Change One")
        let second = Station(id: "C2", name: "Change Two")
        let third = Station(id: "C3", name: "Change Three")
        let wait = 300_000.0
        let values = [
            connection("one", from: alpha, to: first, departure: 0, arrival: 100),
            connection("two", from: first, to: second, departure: 100 + wait, arrival: 200 + wait),
            connection("three", from: second, to: third, departure: 200 + 2 * wait, arrival: 300 + 2 * wait),
            connection("four", from: third, to: bravo, departure: 300 + 3 * wait, arrival: 400 + 3 * wait)
        ].sorted { $0.departure < $1.departure }
        let router = OfflineRouter()

        XCTAssertTrue(router.route(from: alpha, to: bravo, at: 0, connections: values, limit: 12).isEmpty)
        XCTAssertTrue(router.route(from: alpha, to: bravo, at: 0, connections: values, limit: 12, maxTransfers: 2).isEmpty)

        let raised = router.route(from: alpha, to: bravo, at: 0, connections: values, limit: 12, maxTransfers: 4)

        XCTAssertEqual(raised.count, 1)
        XCTAssertEqual(raised.first?.legs.compactMap { $0.identity?.tripId }, ["one", "two", "three", "four"])
    }

    func testWeightedRecommendationKeepsSameSeedFallbackUntilLongWaitFiltering() throws {
        let x = Station(id: "X", name: "X")
        let c1 = Station(id: "C1", name: "C1")
        let c2 = Station(id: "C2", name: "C2")
        let c3 = Station(id: "C3", name: "C3")
        let c4 = Station(id: "C4", name: "C4")
        let minute = 60_000.0
        let values = [
            connection("seed", from: alpha, to: x, departure: 0, arrival: minute, fromSequence: 1, toSequence: 2),
            connection("seed", from: x, to: bravo, departure: minute, arrival: 85 * minute, fromSequence: 2, toSequence: 3),
            connection("long-wait", from: x, to: bravo, departure: 70 * minute, arrival: 75 * minute),
            connection("later-1", from: alpha, to: c1, departure: 2 * minute, arrival: 3 * minute),
            connection("later-2", from: c1, to: c2, departure: 8 * minute, arrival: 9 * minute),
            connection("later-3", from: c2, to: c3, departure: 14 * minute, arrival: 15 * minute),
            connection("later-4", from: c3, to: c4, departure: 20 * minute, arrival: 21 * minute),
            connection("later-5", from: c4, to: bravo, departure: 26 * minute, arrival: 69 * minute)
        ].sorted { $0.departure < $1.departure }

        let recommendation = try XCTUnwrap(OfflineRouter().recommendation(
            from: alpha,
            to: bravo,
            at: 0,
            connections: values,
            maxTransfers: 4
        ))

        XCTAssertEqual(recommendation.legs.compactMap { $0.identity?.tripId }, ["seed"])
        XCTAssertEqual(recommendation.effectiveArrival, 85 * minute)
    }

    func testDominancePreservesLabelsWithDifferentVisitedStations() {
        let papa = Station(id: "P", name: "P")
        let xray = Station(id: "X", name: "X")
        let yankee = Station(id: "Y", name: "Y")
        let minute = 60_000.0
        let values = [
            connection("seed", from: alpha, to: papa, departure: 0, arrival: minute),
            connection("loop", from: papa, to: yankee, departure: 6 * minute, arrival: 7 * minute, fromSequence: 1, toSequence: 2),
            connection("loop", from: yankee, to: xray, departure: 7 * minute, arrival: 8 * minute, fromSequence: 2, toSequence: 3),
            connection("direct", from: papa, to: xray, departure: 6 * minute, arrival: 9 * minute),
            connection("out", from: xray, to: yankee, departure: 14 * minute, arrival: 15 * minute, fromSequence: 1, toSequence: 2),
            connection("out", from: yankee, to: bravo, departure: 15 * minute, arrival: 16 * minute, fromSequence: 2, toSequence: 3)
        ].sorted { $0.departure < $1.departure }

        let journeys = OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: values, limit: 4)

        XCTAssertEqual(journeys.first?.legs.compactMap { $0.identity?.tripId }, ["seed", "direct", "out"])
    }

    func testInvalidOriginConnectionsDoNotConsumeRecommendationSeedBudget() {
        var values = (0..<72).map { index in
            connection(
                "invalid-\(index)",
                from: alpha,
                to: bravo,
                departure: Millis(index),
                arrival: Millis(index - 1)
            )
        }
        values.append(connection("valid", from: alpha, to: bravo, departure: 100, arrival: 200))

        XCTAssertEqual(
            OfflineRouter().recommendation(from: alpha, to: bravo, at: 0, connections: values)?
                .legs.first?.identity?.tripId,
            "valid"
        )
    }

    func testRouterCooperativelyCancelsLongScans() {
        let values = (0..<1_000).map { index in
            connection("trip-\(index)", from: alpha, to: bravo, departure: Millis(index), arrival: Millis(index + 100))
        }
        var checks = 0
        let result = OfflineRouter().recommendation(
            from: alpha,
            to: bravo,
            at: 0,
            connections: values,
            isCancelled: { checks += 1; return checks > 1 }
        )

        XCTAssertNil(result)
        XCTAssertLessThan(checks, 10)
    }

    func testStationDominanceKeepsDifferentLastTripsForReboarding() throws {
        let p = Station(id: "P", name: "P")
        let x = Station(id: "X", name: "X")
        let minute = 60_000.0
        let values = [
            connection("seed", from: alpha, to: p, departure: 0, arrival: minute),
            connection("loop", from: p, to: x, departure: 6 * minute, arrival: 7 * minute),
            connection("other", from: p, to: x, departure: 6 * minute, arrival: 8 * minute),
            connection("loop", from: x, to: bravo, departure: 14 * minute, arrival: 15 * minute, fromSequence: 9, toSequence: 10)
        ]
        let result = try XCTUnwrap(OfflineRouter().recommendation(from: alpha, to: bravo, at: 0, connections: values))
        XCTAssertEqual(result.legs.compactMap { $0.identity?.tripId }, ["seed", "other", "loop"])
    }

    func testWeightedSearchContinuesBeyondFirstTerminalArrivalAndBoardPrefix() throws {
        let minute = 60_000.0
        let values = [
            connection("seed", from: alpha, to: central, departure: 0, arrival: minute, fromSequence: 1, toSequence: 2),
            connection("transfer", from: central, to: bravo, departure: 6 * minute, arrival: 20 * minute),
            connection("seed", from: central, to: bravo, departure: 21 * minute, arrival: 24 * minute, fromSequence: 2, toSequence: 3),
            connection("later", from: alpha, to: bravo, departure: 22 * minute, arrival: 23 * minute)
        ].sorted { $0.departure < $1.departure }
        let result = try XCTUnwrap(OfflineRouter().recommendation(from: alpha, to: bravo, at: 0, connections: values))
        XCTAssertEqual(result.legs.first?.identity?.tripId, "later")
        XCTAssertEqual(OfflineRouter().route(from: alpha, to: bravo, at: 0, connections: values, limit: 1).first?.legs.count, 2)
        XCTAssertEqual(OfflineRouter().recommendation(from: alpha, to: bravo, at: 0, connections: Array(values.dropLast()))?.legs.count, 1)
    }

    func testRecommendationChecksExactlySeventyTwoFutureSeeds() {
        let values = (0..<73).map { index in
            connection("trip-\(index)", from: alpha, to: bravo, departure: Millis(index + 1), arrival: Millis(1_000 - index))
        }
        XCTAssertEqual(OfflineRouter().recommendation(from: alpha, to: bravo, at: 0, connections: values)?.legs.first?.identity?.tripId, "trip-71")
        XCTAssertEqual(OfflineRouter().recommendation(from: alpha, to: bravo, at: 2, connections: values)?.legs.first?.identity?.tripId, "trip-72")
    }

    func testGTFSUsesSydneyCivilTimeAcrossDSTAndAfterMidnight() {
        XCTAssertEqual(
            OfflinePlanner.gtfsEpochMillis(serviceDate: "20261004", seconds: 3 * 3_600 + 30 * 60),
            ISO8601DateFormatter().date(from: "2026-10-03T16:30:00Z")!.timeIntervalSince1970 * 1_000
        )
        XCTAssertEqual(
            OfflinePlanner.gtfsEpochMillis(serviceDate: "20261003", seconds: 25 * 3_600 + 10 * 60),
            ISO8601DateFormatter().date(from: "2026-10-03T15:10:00Z")!.timeIntervalSince1970 * 1_000
        )
    }

    func testJourneyKeyUsesIntegralMillisecondsAcrossCodableRoundTrip() throws {
        let journey = Journey(legs: [Leg(
            line: "T1",
            mode: "train",
            headsign: "Bravo",
            from: alpha,
            to: bravo,
            departure: 1_788_653_461_000.6,
            arrival: 1_788_655_380_000.4
        )])
        let decoded = try JSONDecoder().decode(Journey.self, from: JSONEncoder().encode(journey))

        XCTAssertEqual(journey.key, "T1:1788653461001")
        XCTAssertEqual(decoded.key, journey.key)
    }

    private func connection(
        _ trip: String,
        from: Station,
        to: Station,
        departure: Millis,
        arrival: Millis,
        pickupType: Int = 0,
        mode: String = "train",
        cancelled: Bool = false,
        fromSequence: Int = 1,
        toSequence: Int = 2
    ) -> ScheduledConnection {
        ScheduledConnection(
            source: "source",
            tripId: trip,
            serviceDate: "20260906",
            fromSequence: fromSequence,
            toSequence: toSequence,
            fromStopId: "\(from.id)-stop",
            toStopId: "\(to.id)-stop",
            fromStationId: from.id,
            toStationId: to.id,
            fromStation: from,
            toStation: to,
            departure: departure,
            arrival: arrival,
            pickupType: pickupType,
            dropOffType: 0,
            fromPlatform: "1",
            toPlatform: "2",
            line: "T1",
            mode: mode,
            headsign: to.name,
            cancelled: cancelled
        )
    }
}
