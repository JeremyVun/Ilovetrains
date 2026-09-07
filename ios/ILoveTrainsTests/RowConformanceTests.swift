import Foundation
import XCTest
@testable import ILoveTrains

final class RowConformanceTests: XCTestCase {
    func testDepartureFiguresMatchWebReference() throws {
        let url = try XCTUnwrap(Bundle(for: RowConformanceTests.self).url(forResource: "rows", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let cases = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])

        for fixture in cases {
            let name = try XCTUnwrap(fixture["name"] as? String)
            let now = try XCTUnwrap((fixture["now"] as? NSNumber)?.doubleValue)
            let body = try XCTUnwrap(fixture["body"] as? [String: Any])
            let expected = try XCTUnwrap(fixture["expected"] as? [String: Any])
            let delta = fixture["syntheticDelta"] as? [String: Any] ?? [:]
            var board = try TransitWire.board(JSONSerialization.data(withJSONObject: body))
            board.offline = delta["offline"] as? Bool ?? false
            let journey = try XCTUnwrap(board.journeys.first, name)
            let figure = figureFor(journey, board: board, now: now)
            let rendered = figure.value + (figure.unit == "H" ? "H" : "")

            XCTAssertEqual(rendered, expected["figure"] as? String, name)
            XCTAssertEqual(figure.provenance.uppercased(), expected["provenance"] as? String, name)
            XCTAssertEqual(figure.past, expected["past"] as? Bool, name)
            XCTAssertEqual(clockTime(journey.effectiveDeparture), expected["depTime"] as? String, name)
            XCTAssertEqual(clockTime(journey.effectiveArrival), expected["arrTime"] as? String, name)
        }
    }

    func testPlatformLabelsKeepFerrySidesAndRailPrefixes() {
        XCTAssertEqual(platformText("Wharf 4, Side B", mode: "ferry"), "4B")
        XCTAssertEqual(platformText("Wharf 4, Side B", mode: "ferry", full: true), "Wharf 4, Side B")
        XCTAssertEqual(platformText("Pyrmont Bay Wharf", mode: "ferry"), "Wharf")
        XCTAssertEqual(platformText("Platform 12", mode: "train"), "12")
        XCTAssertEqual(platformText("Platform 12", mode: "train", full: true), "Platform 12")
    }
}
