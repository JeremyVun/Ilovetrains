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
