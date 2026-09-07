import XCTest
@testable import ILoveTrains

final class JourneyAxisLayoutTests: XCTestCase {
    private func journey(_ times: [(Double, Double)]) -> Journey {
        let station = Station(id: "station", name: "Central Station")
        return Journey(legs: times.map { start, end in
            Leg(line: "T9", mode: "train", headsign: "Epping", from: station, to: station,
                departure: start, arrival: end)
        })
    }

    func testOriginCapAndRideShareOneCenterOnHomeAndBoard() {
        for large in [true, false] {
            let layout = JourneyAxisGeometry(journey: journey([(0, 1000)]), large: large,
                progress: nil, width: 358, items: [.cap, .ride(0)],
                sizes: [CGSize(width: 112, height: large ? 24 : 22), .zero])
            XCTAssertEqual(layout.frames[0].midY, layout.frames[1].midY)
            XCTAssertEqual(layout.frames[0].maxX, layout.frames[1].minX)
            XCTAssertEqual(layout.frames[1].maxX, 358)
        }
    }

    func testTwoChangesKeepMarkersSeparateWithoutMovingServiceTimes() {
        let items: [AxisItem] = [.cap, .ride(0), .dwell(0), .ride(1), .dwell(1), .ride(2),
                                 .alight(0), .board(0), .board(1)]
        let sizes = [CGSize(width: 108, height: 22)] + Array(repeating: CGSize.zero, count: 5)
            + [CGSize(width: 24, height: 22), CGSize(width: 24, height: 22), CGSize(width: 32, height: 22)]
        let route = journey([(0, 700), (720, 800), (810, 1000)])
        let layout = JourneyAxisGeometry(journey: route, large: false, progress: nil,
            width: 272, items: items, sizes: sizes)
        let pins = Array(layout.frames.suffix(3))
        for pin in pins {
            XCTAssertGreaterThanOrEqual(pin.minX, 108)
            XCTAssertLessThanOrEqual(pin.maxX, 272)
            XCTAssertEqual(pin.midY, layout.frames[1].midY)
        }
        for (a, b) in zip(pins, pins.dropFirst()) { XCTAssertGreaterThanOrEqual(b.minX - a.maxX, 3) }
        XCTAssertEqual(layout.frames[1].width, (272 - 108) * 0.7, accuracy: 0.001)
        XCTAssertEqual(layout.frames[2].maxX, layout.frames[3].minX, accuracy: 0.001)
        XCTAssertEqual(layout.frames[4].maxX, layout.frames[5].minX, accuracy: 0.001)
    }

    func testLongTransferNamesWrapAndStackInsideDeviceWithoutChangingAxis() {
        let layout = JourneyAxisGeometry(journey: journey([(0, 500), (600, 700), (800, 1000)]),
            large: false, progress: nil, width: 272,
            items: [.ride(0), .station(0), .station(1)],
            sizes: [.zero, CGSize(width: 240, height: 24), CGSize(width: 240, height: 24)])
        let first = layout.frames[1], second = layout.frames[2]
        XCTAssertGreaterThanOrEqual(first.minX, 0)
        XCTAssertLessThanOrEqual(second.maxX, 272)
        XCTAssertGreaterThanOrEqual(second.minY - first.maxY, 6)
        XCTAssertGreaterThanOrEqual(layout.size.height, second.maxY)
        XCTAssertEqual(layout.frames[0].width, 136)
    }
}
