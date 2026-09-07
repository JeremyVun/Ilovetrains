import Foundation
import XCTest
@testable import ILoveTrains

final class RowConformanceTests: XCTestCase {
    func testPastFiguresKeepElapsedTimeWhenObservationsAreRetainedOrOffline() {
        let now: Millis = 9_000_000
        let from = Station(id: "a", name: "A"), to = Station(id: "b", name: "B")
        for elapsed in [5, 119] {
            for offline in [false, true] {
                let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: from, to: to,
                    departure: now - Double(elapsed) * 60_000, arrival: now + 60_000)], retained: offline)
                let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: now - 120_000,
                                      source: "live", offline: offline)
                let figure = figureFor(journey, board: board, now: now)
                XCTAssertEqual(figure.value, elapsed > 99 ? "2" : "5")
                XCTAssertEqual(figure.unit, elapsed > 99 ? "H" : "min")
                XCTAssertEqual(figure.provenance, "Ago")
                XCTAssertTrue(figure.past)
            }
        }
    }

    func testFutureFiguresRemainVisibleAcrossEverySourceState() {
        let now: Millis = 9_000_000
        let from = Station(id: "a", name: "A"), to = Station(id: "b", name: "B")
        for minutes in [0, 34, 119] {
            let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: from, to: to,
                departure: now + Double(minutes) * 60_000, arrival: now + Double(minutes + 30) * 60_000)])
            let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: now, source: "live")
            var offline = board; offline.offline = true
            var aged = board; aged.generatedAt = now - 120_000
            var scheduled = board; scheduled.source = "schedule"
            for source in [nil, board, offline, aged, scheduled] as [BoardData?] {
                for retained in [false, true] {
                    var candidate = journey; candidate.retained = retained
                    let figure = figureFor(candidate, board: source, now: now)
                    XCTAssertEqual(figure.value, minutes == 0 ? "Now" : (minutes == 119 ? "2" : "34"))
                    XCTAssertEqual(figure.unit, minutes == 0 ? "" : (minutes == 119 ? "H" : "min"))
                    XCTAssertEqual(figure.provenance, "Scheduled")
                    XCTAssertFalse(figure.past)
                }
            }
        }
    }

    func testDirectionFiguresTargetTheNextDepartureDuringATransferDwell() {
        let a = Station(id: "a", name: "A"), b = Station(id: "b", name: "B"), c = Station(id: "c", name: "C")
        let journey = Journey(legs: [
            Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: 0, arrival: 10 * 60_000),
            Leg(line: "T2", mode: "train", headsign: "C", from: b, to: c, departure: 15 * 60_000, arrival: 30 * 60_000)
        ], retained: true)
        for (minute, expected, label) in [(5, "5", "To change"), (12, "3", "To change"), (18, "12", "To go")] {
            let figure = directionFigureFor(journey, now: Double(minute) * 60_000)
            XCTAssertEqual(figure?.value, expected)
            XCTAssertEqual(figure?.unit, "min")
            XCTAssertEqual(figure?.provenance, label)
        }
        XCTAssertNil(directionFigureFor(journey, now: 30 * 60_000))
    }

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
        XCTAssertEqual(departurePlatformText("Wharf 4, Side B", mode: "ferry"), "Wharf 4, Side B")
        XCTAssertEqual(departurePlatformText("Side A", mode: "ferry"), "Side A")
        XCTAssertEqual(departurePlatformText("Pyrmont Bay Wharf", mode: "ferry"), "Wharf")
        XCTAssertEqual(departurePlatformText("Platform 12", mode: "train"), "Platform 12")
        XCTAssertEqual(transferPlatformText("Wharf 4, Side B", mode: "ferry"), "4B")
        XCTAssertEqual(transferPlatformText("Side A", mode: "ferry"), "A")
        XCTAssertEqual(transferPlatformText("Balmain Wharf", mode: "ferry"), "—")
    }

    func testFigureWidthUsesTheRenderedTokenWithoutMinuteSuffix() {
        XCTAssertTrue(figureUsesCompactType(Figure(value: "Now")))
        XCTAssertTrue(figureUsesCompactType(Figure(value: "10", unit: "H")))
        XCTAssertTrue(figureUsesCompactType(Figure(value: "100", unit: "min")))
        XCTAssertFalse(figureUsesCompactType(Figure(value: "2", unit: "H")))
        XCTAssertFalse(figureUsesCompactType(Figure(value: "3", unit: "min")))
    }

    func testNextServiceFigureSharesRoundingAcrossSourceStates() {
        let now: Millis = 1_000_000
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let journey = Journey(legs: [Leg(
            line: "T1", mode: "train", headsign: "B", from: from, to: to,
            departure: now + 119 * 60_000, arrival: now + 150 * 60_000
        )])
        let scheduled = BoardData(from: from, to: to, journeys: [journey], generatedAt: now, source: "live")
        XCTAssertEqual(nextServiceFigure(journey, board: scheduled, now: now), "2H")

        var degraded = scheduled
        degraded.serverStale = true
        XCTAssertEqual(nextServiceFigure(journey, board: degraded, now: now), "2H")
        var stale = scheduled
        stale.generatedAt = now - 90_001
        XCTAssertEqual(nextServiceFigure(journey, board: stale, now: now), "2H")
        var offline = scheduled
        offline.offline = true
        XCTAssertEqual(nextServiceFigure(journey, board: offline, now: now), "2H")
    }

    func testContextualModeWordsAndDistanceRoundingMatchWeb() {
        XCTAssertEqual(genericModeName("metro"), "train")
        XCTAssertEqual(genericModeName("ferry"), "ferry")
        XCTAssertEqual(serviceModeName("metro"), "metro")
        XCTAssertEqual(serviceModeName("bus"), "service")
        XCTAssertEqual(distanceText(1), "10 m")
        XCTAssertEqual(distanceText(16), "20 m")
        XCTAssertEqual(distanceText(1_499), "1.5 km")
        XCTAssertEqual(distanceText(19_600), "20 km")
    }

    func testSavedLineCodesKeepTravelOrder() {
        let a = Station(id: "a", name: "A")
        let b = Station(id: "b", name: "B")
        let c = Station(id: "c", name: "C")
        let journey = Journey(legs: [
            Leg(line: "T9", mode: "train", headsign: "B", from: a, to: b, departure: 10_000, arrival: 20_000),
            Leg(line: "F1", mode: "ferry", headsign: "C", from: b, to: c, departure: 30_000, arrival: 40_000),
            Leg(line: "T9", mode: "train", headsign: "C", from: c, to: c, departure: 50_000, arrival: 60_000)
        ])

        XCTAssertEqual(orderedLineCodes(journey), ["T9", "F1"])
    }

    func testWireDatesUseTheWebCompatibleSafetyBound() {
        XCTAssertEqual(TransitWire.epoch(maximumTransitMillis), maximumTransitMillis)
        XCTAssertEqual(TransitWire.epoch(-maximumTransitMillis), -maximumTransitMillis)
        XCTAssertNil(TransitWire.epoch(1e20))
    }
}
