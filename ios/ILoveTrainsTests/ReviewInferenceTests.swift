import XCTest
@testable import ILoveTrains

/// Adversarial probes for commute-reliability rules 3, 5 and 6 on the pure iOS logic. Each test states what
/// design.md and client-storage.md require; a failure is a defect or a contract contradiction (REVIEW.md).
final class ReviewInferenceTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station", lat: -33.83053, lon: 151.087032)
    private let townHall = Station(id: "200070", name: "Town Hall Station", lat: -33.873596, lon: 151.206899)
    private var trip: SavedTrip { SavedTrip(id: "rt", from: rhodes, to: townHall) }
    private let eight: Millis = 1_790_805_600_000
    private let minute: Millis = 60_000
    private var onTheWay: Fix { Fix(lat: -33.87181, lon: 151.094427, at: 0, speed: 14, accuracyMetres: 10, course: 90) }

    private func t9(_ departure: Millis, _ arrival: Millis) -> Journey {
        Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Hornsby via Strathfield", from: rhodes, to: townHall,
                           departure: departure, arrival: arrival, estimatedDeparture: departure, estimatedArrival: arrival,
                           fromPlatform: "1", toPlatform: "3")])
    }

    private func record(_ journey: Journey, at: Millis, station: Station? = nil) -> LastAnswer {
        LastAnswer(tripId: trip.id, reverse: false, at: at, stationId: (station ?? rhodes).id,
                   board: BoardData(from: rhodes, to: townHall, journeys: [journey], generatedAt: at), journey: journey)
    }

    /// Lead suspect 1: a same-origin sighting 60 s after departure means the rider did not board, so the open's snapshot must not enter that train either.
    func testAPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo() throws {
        let departed = record(t9(eight, eight + 27 * minute), at: eight - 2 * minute)
        var snapshot: LastAnswer? = departed
        var data = UserData(trips: [trip], lastAnswer: departed, useLocation: true)
        let sightingAt = eight + 70_000
        let next = record(t9(eight + 8 * minute, eight + 35 * minute), at: sightingAt)
        // The controller's write step: the same sighting retires the snapshot before the hold rule writes.
        if retiresSnapshot(data: data, snapshot: snapshot, incoming: next, sightingAt: sightingAt) { snapshot = nil }
        XCTAssertTrue(replacesLastAnswer(data: data, incoming: next, now: sightingAt, sightingAt: sightingAt),
                      "the hold rule replaces the stored record with the next train")
        data.lastAnswer = next

        let now = eight + 12 * minute
        var fix = onTheWay; fix.at = now
        let entered = try XCTUnwrap(inferFromRecords(data: data, snapshot: snapshot, fix: fix, now: now), "the moving fix enters trip mode")
        XCTAssertEqual(entered.journey.key, next.journey.key,
                       "entered the departed train instead of the one the rider could have boarded")
    }

    private struct Probe {
        var data: UserData
        var now: Millis
        var fix: Fix
        var journey: Journey
        var boards: [String: BoardData] {
            [onBoardKey(tripId: "rt", reverse: false): BoardData(from: journey.legs[0].from, to: journey.legs[0].to, journeys: [journey], generatedAt: now, source: "live")]
        }
        func enter() -> FocusedJourney? { inferOnBoard(data: data, now: now, fix: fix, previousFix: nil, boards: boards) }
    }

    /// A running service whose time progress sits `gap` from the fix's position progress on a 30 minute ride.
    private func onBoardAt(_ gap: Double, now: Millis? = nil) -> Probe {
        let now = now ?? eight + 10 * minute
        var fix = onTheWay; fix.at = now
        let fromOrigin = distanceMetres(fix, rhodes)
        let position = fromOrigin / (fromOrigin + distanceMetres(fix, townHall))
        let ride = 30 * minute
        let departure = ((now - (position + gap) * ride) / 1_000).rounded() * 1_000
        return Probe(data: UserData(trips: [trip], useLocation: true), now: now, fix: fix, journey: t9(departure, departure + ride))
    }

    func testAServicePointTwoFourOffThePositionProgressStillMatches() {
        let probe = onBoardAt(0.24)
        XCTAssertEqual(probe.enter()?.journey.key, probe.journey.key)
    }

    func testAServicePointTwoSixOffThePositionProgressIsNotAMatch() {
        XCTAssertNil(onBoardAt(0.26).enter())
        XCTAssertEqual(progressWindow, 0.25)
    }

    func testAServicePointTwoFourNineOffStillMatchesBecauseTheWindowIsInclusive() {
        let probe = onBoardAt(0.249)
        XCTAssertEqual(probe.enter()?.journey.key, probe.journey.key)
    }

    /// Fixture gap 1: no shared case is held by the decline's hour alone.
    func testTheDeclineHourAloneHoldsEntryOnceTheDeclinedArrivalPlusThirtyHasPassed() {
        var probe = onBoardAt(0.02)
        let earlier = t9(eight - 70 * minute, eight - 43 * minute)
        probe.data.inferenceDeclined = InferenceDecline(tripId: trip.id, reverse: false, at: probe.now - 59 * minute,
                                                        departure: earlier.departureKey, arrival: probe.now - 40 * minute)
        XCTAssertTrue(inferenceDeclined(probe.data, tripId: trip.id, now: probe.now))
        XCTAssertNil(probe.enter())
        probe.data.inferenceDeclined?.at = probe.now - 60 * minute
        XCTAssertFalse(inferenceDeclined(probe.data, tripId: trip.id, now: probe.now), "the hour lapses exactly 60 min after the stop")
        XCTAssertEqual(probe.enter()?.journey.key, probe.journey.key)
    }
}
