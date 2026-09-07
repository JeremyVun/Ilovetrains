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
