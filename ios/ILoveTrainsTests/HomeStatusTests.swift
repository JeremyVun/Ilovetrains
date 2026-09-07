import XCTest
@testable import ILoveTrains

final class HomeStatusTests: XCTestCase {
    func testFuturePinnedSavedTripReadsPinned() {
        let now: Millis = 1_000_000
        let focus = makeFocus(now: now)

        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Pinned")
    }

    func testExceptionalStatusesOutrankFuturePin() {
        let now: Millis = 1_000_000
        var cancelled = makeFocus(now: now)
        cancelled.journey.legs[0].cancelled = true
        XCTAssertEqual(savedTripFocusStatus(cancelled, now: now, complete: false), "Cancelled · Pinned")

        XCTAssertEqual(savedTripFocusStatus(makeFocus(now: now), now: now, complete: true), "Trip over · Pinned")
    }

    func testHeaderAndSavedRowUseTheSameLiveLateStatus() {
        let now: Millis = 1_000_000
        var focus = makeFocus(now: now)
        focus.journey.legs[0].estimatedDeparture = focus.journey.departure + 120_000
        focus.board.journeys = [focus.journey]

        XCTAssertEqual(focusStatus(focus, now: now, complete: false), "Running late")
        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Running late · Pinned")

        focus.board.serverStale = true
        XCTAssertEqual(focusStatus(focus, now: now, complete: false), "Running late")
        XCTAssertEqual(savedTripFocusStatus(focus, now: now, complete: false), "Running late · Pinned")

        var unavailable = focus
        unavailable.board.offline = true
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.board.source = "schedule"
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.board.generatedAt = now - 90_001
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
        unavailable = focus
        unavailable.journey.retained = true
        XCTAssertEqual(focusStatus(unavailable, now: now, complete: false), "Pinned")
    }

    func testEveryLegMustBeEnabledForSuggestions() {
        let now: Millis = 1_000_000
        let from = Station(id: "from", name: "From")
        let change = Station(id: "change", name: "Change")
        let to = Station(id: "to", name: "To")
        let mixed = Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "Change", from: from, to: change, departure: now, arrival: now + 60_000),
            Leg(line: "F1", mode: "ferry", headsign: "To", from: change, to: to, departure: now + 120_000, arrival: now + 300_000)
        ])

        XCTAssertFalse(journeyAllowed(mixed, modes: ["train"]))
        XCTAssertTrue(journeyAllowed(mixed, modes: ["train", "ferry"]))
    }

    func testDepartedUnfocusedRetainedHeaderReadsLastShown() {
        let now: Millis = 1_000_000
        var focus = makeFocus(now: now)
        focus.journey.legs[0].departure = now - 300_000
        focus.journey.legs[0].estimatedDeparture = now - 240_000
        focus.journey.retained = true
        focus.board.offline = true

        XCTAssertEqual(
            retainedHeaderStatus(board: focus.board, journey: focus.journey, hasFocus: false, now: now),
            "Last shown"
        )
        XCTAssertNil(retainedHeaderStatus(board: focus.board, journey: focus.journey, hasFocus: true, now: now))
    }

    private func makeFocus(now: Millis) -> FocusedJourney {
        let from = Station(id: "from", name: "From")
        let to = Station(id: "to", name: "To")
        let journey = Journey(legs: [Leg(
            line: "T1",
            mode: "train",
            headsign: "To",
            from: from,
            to: to,
            departure: now + 300_000,
            arrival: now + 1_200_000
        )])
        let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: now, source: "live")
        return FocusedJourney(tripId: "trip", reverse: false, journey: journey, board: board)
    }
}
